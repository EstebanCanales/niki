import { Inject, Injectable, Logger } from "@nestjs/common";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { RuntimeStateService } from "../common/runtime-state.service";

/** Modo de control de la computadora. */
export type ControlMode = "open" | "guarded" | "locked";

/** Nivel de riesgo de una capacidad. */
export type RiskLevel = "low" | "medium" | "high";

export type ActionResult = Record<string, unknown> & { ok: boolean };

export type ActionContext = {
  userId: string;
  sessionId?: string;
  correlationId?: string;
  source: "agent" | "api";
};

type ProcOutput = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type Capability = {
  name: string;
  description: string;
  risk: RiskLevel;
  /** Esquema de parámetros estilo JSON Schema para function-calling. */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  run: (params: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult>;
};

const MAX_OUTPUT_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;

// Speed-bump de seguridad contra comandos catastróficos. NO es un sandbox: un shell
// con sustitución de comandos puede evadir cualquier lista. Es defensa en profundidad
// contra accidentes y evasiones triviales (comillas, backslashes, variables). El límite
// real de seguridad es el modo `locked`, el bind a localhost y el guard de Origin.
const SHELL_DENYLIST: Array<{ re: RegExp; why: string }> = [
  { re: /\bmkfs\b/i, why: "format filesystem" },
  { re: /\bdd\b[^\n]*\bof=\/dev\/(disk|rdisk|sd|hd)/i, why: "raw write to disk device" },
  { re: />\s*\/dev\/(disk|rdisk|sd|hd)/i, why: "redirect to disk device" },
  { re: /\bdiskutil\s+(erase|reformat|partitiondisk|secureerase|zerodisk)/i, why: "disk erase" },
  { re: /\b(shutdown|reboot|halt)\b/i, why: "power off / reboot" },
  { re: /\bpmset\b[^\n]*\b(sleepnow|sleep)\b/i, why: "force sleep" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;\s*:/, why: "fork bomb" },
  { re: /\bkillall\s+-?9?\s*(kernel_task|launchd|windowserver|loginwindow)\b/i, why: "kill critical process" },
  { re: /\bcsrutil\s+disable\b/i, why: "disable SIP" },
  { re: /\bspctl\s+--master-disable\b/i, why: "disable Gatekeeper" },
];

/** Normaliza el comando para evadir trucos de comillas/backslashes/espacios. */
function normalizeCmd(cmd: string): string {
  return cmd.replace(/[\\'"`]/g, "").replace(/\s+/g, " ").trim();
}

/** Devuelve la razón si el comando es catastrófico, o null si pasa el speed-bump. */
function blockedShellReason(raw: string): string | null {
  const variants = [raw, normalizeCmd(raw)];
  for (const cmd of variants) {
    for (const { re, why } of SHELL_DENYLIST) {
      if (re.test(cmd)) return why;
    }
    const lc = cmd.toLowerCase();
    // Borrado recursivo de rutas críticas (rm -rf /, ~, $HOME, /*, /System, etc.).
    const hasRm = /\brm\b/.test(lc);
    const recursive = /(--recursive|-[a-z]*r[a-z]*\b|-rf|-fr|-r\b)/.test(lc);
    const dangerousTarget =
      /(^|[\s=])(\/|\/\*|~\/?|\$\{?home\}?|\$\{?user\}?|\/system|\/users|\/library|\/applications|\/bin|\/usr|\/etc|\/var)(\s|\/|\*|$)/.test(
        lc,
      ) || /\s\*(\s|$)/.test(lc);
    if (hasRm && recursive && dangerousTarget) return "recursive deletion of a critical path";
  }
  return null;
}

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
}

/** Escapa una cadena para incrustarla con seguridad dentro de comillas en AppleScript. */
function escapeAppleScript(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

function str(params: Record<string, unknown>, key: string, fallback = ""): string {
  const v = params[key];
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function bool(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true || params[key] === "true";
}

@Injectable()
export class ComputerControlService {
  private readonly logger = new Logger(ComputerControlService.name);
  private readonly backendRoot = path.resolve(__dirname, "..", "..", "..");
  private readonly inputBinary = path.join(this.backendRoot, "native", "bin", "niki-input");
  private readonly inputSource = path.join(this.backendRoot, "native", "niki-input", "main.swift");

  private mode: ControlMode = "guarded";
  private allowedRoots: string[];
  private readonly recent: Array<Record<string, unknown>> = [];
  private inputHelperReady = false;

  private readonly capabilities: Map<string, Capability> = new Map();

  constructor(
    @Inject(RuntimeStateService) private readonly runtimeState: RuntimeStateService,
  ) {
    const envMode = String(process.env.NIKI_COMPUTER_CONTROL_MODE ?? "").trim().toLowerCase();
    if (envMode === "open" || envMode === "guarded" || envMode === "locked") {
      this.mode = envMode;
    }
    this.allowedRoots = [os.homedir(), os.tmpdir(), this.backendRoot].map((p) =>
      path.resolve(p),
    );
    this.registerCapabilities();
  }

  // ---------------------------------------------------------------------------
  // Configuración / introspección
  // ---------------------------------------------------------------------------

  getConfig() {
    return {
      mode: this.mode,
      allowedRoots: this.allowedRoots,
      inputHelper: this.ensureInputHelper(),
      tools: this.capabilities.size,
      platform: process.platform,
    };
  }

  setConfig(input: { mode?: string; allowedRoots?: string[] }) {
    if (input.mode) {
      const m = input.mode.trim().toLowerCase();
      if (m === "open" || m === "guarded" || m === "locked") this.mode = m;
    }
    if (Array.isArray(input.allowedRoots) && input.allowedRoots.length > 0) {
      this.allowedRoots = input.allowedRoots
        .filter((r) => typeof r === "string" && r.trim())
        .map((r) => path.resolve(r));
    }
    return this.getConfig();
  }

  capabilitiesList() {
    return Array.from(this.capabilities.values()).map((c) => ({
      name: c.name,
      description: c.description,
      risk: c.risk,
      parameters: c.parameters,
    }));
  }

  recentActions(limit = 25) {
    return this.recent.slice(0, limit);
  }

  /** Esquemas de herramientas para function-calling de Groq. */
  getToolSchemas() {
    return this.capabilitiesList().map((c) => ({
      type: "function" as const,
      function: {
        name: c.name,
        description: `[risk:${c.risk}] ${c.description}`,
        parameters: c.parameters,
      },
    }));
  }

  /** Estado de permisos macOS (best-effort). */
  permissions() {
    const helper = this.ensureInputHelper();
    return {
      ok: true,
      accessibility: {
        required: true,
        note: "Otorga Accesibilidad a la app/terminal que ejecuta el backend para mouse/teclado.",
      },
      screenRecording: {
        required: true,
        note: "Otorga Grabación de pantalla para screen.capture.",
      },
      inputHelper: helper,
    };
  }

  // ---------------------------------------------------------------------------
  // Ejecución
  // ---------------------------------------------------------------------------

  async run(
    name: string,
    params: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    const capability = this.capabilities.get(name);
    if (!capability) {
      return { ok: false, error: `unknown capability: ${name}` };
    }

    const gate = this.checkGate(capability, params);
    if (!gate.ok) {
      this.audit(ctx, name, capability.risk, "warning", gate.error ?? "blocked");
      return { ok: false, error: gate.error, requiresConfirmation: gate.requiresConfirmation };
    }

    const startedAt = Date.now();
    try {
      const result = await capability.run(params, ctx);
      this.record(name, capability.risk, ctx, result.ok, Date.now() - startedAt);
      this.audit(
        ctx,
        name,
        capability.risk,
        result.ok ? "success" : "warning",
        result.ok ? "ok" : String(result.error ?? "failed"),
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(name, capability.risk, ctx, false, Date.now() - startedAt);
      this.audit(ctx, name, capability.risk, "error", message);
      return { ok: false, error: message };
    }
  }

  /** Variante para el agente: compacta salidas grandes (p. ej. base64). */
  async executeTool(
    name: string,
    params: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    const result = await this.run(name, params, { ...ctx, source: "agent" });
    if (result.ok && typeof result.imageBase64 === "string") {
      const { imageBase64, ...rest } = result;
      void imageBase64;
      return { ...rest, imageOmitted: true };
    }
    return result;
  }

  private checkGate(
    capability: Capability,
    params: Record<string, unknown>,
  ): { ok: boolean; error?: string; requiresConfirmation?: boolean } {
    if (this.mode === "locked" && capability.risk !== "low") {
      return { ok: false, error: `control mode is 'locked'; only read-only actions allowed` };
    }
    if (this.mode === "guarded" && capability.risk === "high" && !bool(params, "confirm")) {
      return {
        ok: false,
        error: `'${capability.name}' is high-risk; resend with confirm=true (mode: guarded)`,
        requiresConfirmation: true,
      };
    }
    return { ok: true };
  }

  private record(
    name: string,
    risk: RiskLevel,
    ctx: ActionContext,
    ok: boolean,
    durationMs: number,
  ) {
    this.recent.unshift({
      name,
      risk,
      ok,
      durationMs,
      source: ctx.source,
      userId: ctx.userId,
      at: new Date().toISOString(),
    });
    if (this.recent.length > 200) this.recent.length = 200;
  }

  private audit(
    ctx: ActionContext,
    name: string,
    risk: RiskLevel,
    status: "success" | "warning" | "error",
    detail: string,
  ) {
    try {
      this.runtimeState.audit(
        ctx.userId,
        `computer.${name}`,
        ctx.sessionId ?? "computer",
        ctx.correlationId ?? "computer",
        `[${risk}] ${detail}`.slice(0, 400),
        status,
      );
    } catch {
      // Auditoría best-effort; nunca debe romper la acción.
    }
  }

  // ---------------------------------------------------------------------------
  // Helper de procesos
  // ---------------------------------------------------------------------------

  private execProcess(
    command: string,
    args: string[],
    opts: { input?: string; timeoutMs?: number; cwd?: string } = {},
  ): Promise<ProcOutput> {
    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        settled = true;
        resolve({ code: null, stdout, stderr, timedOut: true });
      }, timeoutMs);

      child.stdout.on("data", (d) => {
        if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += d.toString();
      });
      child.on("error", (err) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        resolve({ code: null, stdout, stderr: stderr + String(err.message), timedOut: false });
      });
      child.on("close", (code) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        resolve({ code, stdout, stderr, timedOut: false });
      });

      if (opts.input !== undefined) {
        child.stdin.write(opts.input);
      }
      child.stdin.end();
    });
  }

  private ensureInputHelper(): { available: boolean; path?: string; reason?: string } {
    if (this.inputHelperReady && existsSync(this.inputBinary)) {
      return { available: true, path: this.inputBinary };
    }
    if (existsSync(this.inputBinary)) {
      this.inputHelperReady = true;
      return { available: true, path: this.inputBinary };
    }
    // Intentar compilar con swiftc si está disponible.
    const which = spawnSync("which", ["swiftc"], { encoding: "utf8" });
    if (which.status !== 0 || !existsSync(this.inputSource)) {
      return { available: false, reason: "swiftc or source not available" };
    }
    try {
      mkdirSync(path.dirname(this.inputBinary), { recursive: true });
      const build = spawnSync("swiftc", ["-O", this.inputSource, "-o", this.inputBinary], {
        encoding: "utf8",
        timeout: 60_000,
      });
      if (build.status === 0 && existsSync(this.inputBinary)) {
        this.inputHelperReady = true;
        this.logger.log("[computer] compiled niki-input helper");
        return { available: true, path: this.inputBinary };
      }
      return { available: false, reason: build.stderr?.slice(0, 200) || "compile failed" };
    } catch (err) {
      return { available: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  private async callInputHelper(command: Record<string, unknown>): Promise<ActionResult> {
    const helper = this.ensureInputHelper();
    if (!helper.available || !helper.path) {
      return { ok: false, error: `input helper unavailable: ${helper.reason ?? "unknown"}` };
    }
    const out = await this.execProcess(helper.path, [JSON.stringify(command)], { timeoutMs: 10_000 });
    if (out.timedOut) return { ok: false, error: "input helper timed out" };
    const raw = out.stdout.trim();
    try {
      const parsed = JSON.parse(raw) as ActionResult;
      if (!parsed.ok && !parsed.error && out.stderr) parsed.error = out.stderr.trim();
      return parsed;
    } catch {
      return {
        ok: out.code === 0,
        error: out.code === 0 ? undefined : out.stderr.trim() || "input helper error",
        raw,
      };
    }
  }

  private async runOsascript(script: string, jxa = false): Promise<ProcOutput> {
    const args = jxa ? ["-l", "JavaScript"] : [];
    return this.execProcess("/usr/bin/osascript", args, { input: script, timeoutMs: 30_000 });
  }

  private resolveSafePath(input: string): { ok: boolean; resolved?: string; error?: string } {
    if (!input) return { ok: false, error: "path is required" };
    const expanded = input.startsWith("~")
      ? path.join(os.homedir(), input.slice(1))
      : input;
    const resolved = path.resolve(expanded);
    return { ok: true, resolved };
  }

  private isWriteAllowed(resolved: string): boolean {
    return this.allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
  }

  // ---------------------------------------------------------------------------
  // Registro de capacidades
  // ---------------------------------------------------------------------------

  private register(cap: Capability) {
    this.capabilities.set(cap.name, cap);
  }

  private registerCapabilities() {
    // -- Shell --------------------------------------------------------------
    this.register({
      name: "shell_exec",
      description:
        "Run a shell command on the user's Mac (zsh). Use for files, processes, networking, apps via 'open', etc.",
      risk: "high",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
          cwd: { type: "string", description: "Optional working directory." },
          timeoutMs: { type: "number", description: "Timeout in ms (default 30000)." },
          confirm: { type: "boolean", description: "Set true to authorize in guarded mode." },
        },
        required: ["command"],
      },
      run: async (params) => {
        const command = str(params, "command");
        if (!command.trim()) return { ok: false, error: "command is required" };
        const blocked = blockedShellReason(command);
        if (blocked) {
          return { ok: false, error: `command blocked by safety denylist: ${blocked}` };
        }
        const cwd = str(params, "cwd") || undefined;
        const out = await this.execProcess("/bin/zsh", ["-lc", command], {
          timeoutMs: num(params, "timeoutMs", DEFAULT_TIMEOUT_MS),
          cwd,
        });
        return {
          ok: !out.timedOut && (out.code === 0 || out.stdout.length > 0),
          exitCode: out.code,
          timedOut: out.timedOut,
          stdout: clip(out.stdout),
          stderr: clip(out.stderr),
        };
      },
    });

    // -- AppleScript / JXA --------------------------------------------------
    this.register({
      name: "applescript_run",
      description:
        "Run an AppleScript (or JXA if jxa=true) to automate macOS apps and the UI. Powerful for app scripting.",
      risk: "high",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "The AppleScript/JXA source." },
          jxa: { type: "boolean", description: "Run as JavaScript for Automation." },
          confirm: { type: "boolean" },
        },
        required: ["script"],
      },
      run: async (params) => {
        const script = str(params, "script");
        if (!script.trim()) return { ok: false, error: "script is required" };
        // Evitar escalación silenciosa a root vía diálogo de administrador.
        if (/with\s+administrator\s+privileges/i.test(script)) {
          return { ok: false, error: "administrator privilege escalation is not allowed" };
        }
        const out = await this.runOsascript(script, bool(params, "jxa"));
        return {
          ok: !out.timedOut && out.code === 0,
          exitCode: out.code,
          timedOut: out.timedOut,
          result: clip(out.stdout.trim()),
          stderr: clip(out.stderr.trim()),
        };
      },
    });

    // -- Pantalla -----------------------------------------------------------
    this.register({
      name: "screen_capture",
      description:
        "Capture a screenshot. Returns base64 PNG (omitted in agent context) and saved file path. Optional region.",
      risk: "low",
      parameters: {
        type: "object",
        properties: {
          region: {
            type: "string",
            description: "Optional 'x,y,width,height' region. Omit for full screen.",
          },
          display: { type: "number", description: "Display index (default main)." },
        },
      },
      run: async (params) => {
        const tmp = path.join(os.tmpdir(), `niki-shot-${Date.now()}.png`);
        const args = ["-x"];
        const region = str(params, "region").trim();
        if (region && /^\d+,\d+,\d+,\d+$/.test(region)) {
          args.push("-R", region);
        }
        if (params.display !== undefined) args.push("-D", String(num(params, "display", 1)));
        args.push(tmp);
        const out = await this.execProcess("/usr/sbin/screencapture", args, { timeoutMs: 15_000 });
        if (out.code !== 0 || !existsSync(tmp)) {
          return { ok: false, error: out.stderr.trim() || "screencapture failed" };
        }
        const buf = await fs.readFile(tmp);
        return {
          ok: true,
          path: tmp,
          bytes: buf.length,
          imageBase64: buf.toString("base64"),
          mime: "image/png",
        };
      },
    });

    this.register({
      name: "screen_info",
      description: "Get the geometry of all displays (position, size, which is main).",
      risk: "low",
      parameters: { type: "object", properties: {} },
      run: async () => this.callInputHelper({ action: "screens" }),
    });

    // -- Mouse --------------------------------------------------------------
    this.register({
      name: "mouse_move",
      description: "Move the mouse cursor to absolute screen coordinates (top-left origin).",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
      run: async (params) =>
        this.callInputHelper({ action: "move", x: num(params, "x", 0), y: num(params, "y", 0) }),
    });

    this.register({
      name: "mouse_click",
      description:
        "Click the mouse. If x,y omitted clicks at current position. button=left|right|center, count for multi-click.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right", "center"] },
          count: { type: "number", description: "1=single, 2=double." },
        },
      },
      run: async (params) => {
        const cmd: Record<string, unknown> = {
          action: "click",
          button: str(params, "button", "left"),
          count: num(params, "count", 1),
        };
        if (params.x !== undefined) cmd.x = num(params, "x", 0);
        if (params.y !== undefined) cmd.y = num(params, "y", 0);
        return this.callInputHelper(cmd);
      },
    });

    this.register({
      name: "mouse_drag",
      description: "Drag from (x1,y1) to (x2,y2) with the mouse button held down.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
          button: { type: "string", enum: ["left", "right", "center"] },
        },
        required: ["x1", "y1", "x2", "y2"],
      },
      run: async (params) =>
        this.callInputHelper({
          action: "drag",
          x1: num(params, "x1", 0),
          y1: num(params, "y1", 0),
          x2: num(params, "x2", 0),
          y2: num(params, "y2", 0),
          button: str(params, "button", "left"),
        }),
    });

    this.register({
      name: "mouse_scroll",
      description: "Scroll the mouse wheel. dy>0 scrolls up, dy<0 down; dx for horizontal.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { dx: { type: "number" }, dy: { type: "number" } },
      },
      run: async (params) =>
        this.callInputHelper({ action: "scroll", dx: num(params, "dx", 0), dy: num(params, "dy", 0) }),
    });

    // -- Teclado ------------------------------------------------------------
    this.register({
      name: "keyboard_type",
      description: "Type arbitrary unicode text at the current focus, as if typed on the keyboard.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      run: async (params) => this.callInputHelper({ action: "type", text: str(params, "text") }),
    });

    this.register({
      name: "keyboard_key",
      description:
        "Press a single key, optionally with modifiers. key names: return,tab,space,escape,delete,arrows,f1-f12,letters. modifiers: cmd,shift,alt,ctrl,fn.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          modifiers: { type: "array", items: { type: "string" } },
        },
        required: ["key"],
      },
      run: async (params) => {
        const modifiers = Array.isArray(params.modifiers)
          ? (params.modifiers as unknown[]).map((m) => String(m))
          : [];
        return this.callInputHelper({ action: "key", key: str(params, "key"), modifiers });
      },
    });

    // -- Clipboard ----------------------------------------------------------
    this.register({
      name: "clipboard_read",
      description: "Read the current text contents of the macOS clipboard.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const out = await this.execProcess("/usr/bin/pbpaste", [], { timeoutMs: 5_000 });
        return { ok: out.code === 0, text: clip(out.stdout) };
      },
    });

    this.register({
      name: "clipboard_write",
      description: "Write text to the macOS clipboard.",
      risk: "low",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      run: async (params) => {
        const out = await this.execProcess("/usr/bin/pbcopy", [], {
          input: str(params, "text"),
          timeoutMs: 5_000,
        });
        return { ok: out.code === 0 };
      },
    });

    // -- Apps ---------------------------------------------------------------
    this.register({
      name: "app_launch",
      description: "Open/launch an application by name (e.g. 'Safari') or open a file/URL with the default app.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Application name." },
          target: { type: "string", description: "Optional file path or URL to open." },
        },
      },
      run: async (params) => {
        const name = str(params, "name");
        const target = str(params, "target");
        const args: string[] = [];
        if (name) args.push("-a", name);
        if (target) args.push(target);
        if (args.length === 0) return { ok: false, error: "name or target is required" };
        const out = await this.execProcess("/usr/bin/open", args, { timeoutMs: 10_000 });
        return { ok: out.code === 0, stderr: clip(out.stderr.trim()) };
      },
    });

    this.register({
      name: "app_activate",
      description: "Bring an application to the foreground by name.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      run: async (params) => {
        const name = escapeAppleScript(str(params, "name"));
        if (!name) return { ok: false, error: "name is required" };
        const out = await this.runOsascript(`tell application "${name}" to activate`);
        return { ok: out.code === 0, stderr: clip(out.stderr.trim()) };
      },
    });

    this.register({
      name: "app_quit",
      description: "Quit an application by name.",
      risk: "high",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, confirm: { type: "boolean" } },
        required: ["name"],
      },
      run: async (params) => {
        const name = escapeAppleScript(str(params, "name"));
        if (!name) return { ok: false, error: "name is required" };
        const out = await this.runOsascript(`tell application "${name}" to quit`);
        return { ok: out.code === 0, stderr: clip(out.stderr.trim()) };
      },
    });

    this.register({
      name: "app_list",
      description: "List the names of currently running visible applications.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const out = await this.runOsascript(
          'tell application "System Events" to get name of (every process whose background only is false)',
        );
        const apps = out.stdout
          .trim()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return { ok: out.code === 0, apps };
      },
    });

    // -- Filesystem ---------------------------------------------------------
    this.register({
      name: "fs_read",
      description: "Read a UTF-8 text file. Returns its contents (truncated if large).",
      risk: "low",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      run: async (params) => {
        const resolved = this.resolveSafePath(str(params, "path"));
        if (!resolved.ok || !resolved.resolved) return { ok: false, error: resolved.error };
        try {
          const content = await fs.readFile(resolved.resolved, "utf8");
          return { ok: true, path: resolved.resolved, content: clip(content) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });

    this.register({
      name: "fs_write",
      description:
        "Write a UTF-8 text file (creating parent dirs). Restricted to allowed roots (home, tmp, project).",
      risk: "high",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          append: { type: "boolean" },
          confirm: { type: "boolean" },
        },
        required: ["path", "content"],
      },
      run: async (params) => {
        const resolved = this.resolveSafePath(str(params, "path"));
        if (!resolved.ok || !resolved.resolved) return { ok: false, error: resolved.error };
        if (!this.isWriteAllowed(resolved.resolved)) {
          return { ok: false, error: `write path outside allowed roots: ${resolved.resolved}` };
        }
        try {
          await fs.mkdir(path.dirname(resolved.resolved), { recursive: true });
          const content = str(params, "content");
          if (bool(params, "append")) await fs.appendFile(resolved.resolved, content, "utf8");
          else await fs.writeFile(resolved.resolved, content, "utf8");
          return { ok: true, path: resolved.resolved, bytes: Buffer.byteLength(content) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });

    this.register({
      name: "fs_list",
      description: "List entries in a directory with type and size.",
      risk: "low",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      run: async (params) => {
        const resolved = this.resolveSafePath(str(params, "path") || "~");
        if (!resolved.ok || !resolved.resolved) return { ok: false, error: resolved.error };
        try {
          const entries = await fs.readdir(resolved.resolved, { withFileTypes: true });
          const items = await Promise.all(
            entries.slice(0, 500).map(async (e) => {
              let size = 0;
              try {
                if (e.isFile()) size = (await fs.stat(path.join(resolved.resolved!, e.name))).size;
              } catch {
                /* ignore */
              }
              return {
                name: e.name,
                type: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "link" : "file",
                size,
              };
            }),
          );
          return { ok: true, path: resolved.resolved, entries: items };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });

    // -- Sistema ------------------------------------------------------------
    this.register({
      name: "open_url",
      description: "Open a URL in the default browser.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      run: async (params) => {
        const url = str(params, "url");
        if (!/^https?:\/\//i.test(url) && !/^[a-z]+:\/\//i.test(url)) {
          return { ok: false, error: "invalid url" };
        }
        const out = await this.execProcess("/usr/bin/open", [url], { timeoutMs: 8_000 });
        return { ok: out.code === 0 };
      },
    });

    this.register({
      name: "notify",
      description: "Show a macOS notification.",
      risk: "low",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, message: { type: "string" } },
        required: ["message"],
      },
      run: async (params) => {
        const title = escapeAppleScript(str(params, "title", "Niki"));
        const message = escapeAppleScript(str(params, "message"));
        const out = await this.runOsascript(`display notification "${message}" with title "${title}"`);
        return { ok: out.code === 0 };
      },
    });

    this.register({
      name: "system_volume",
      description: "Set the system output volume (0-100).",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { level: { type: "number" } },
        required: ["level"],
      },
      run: async (params) => {
        const level = Math.max(0, Math.min(100, Math.round(num(params, "level", 50))));
        const out = await this.runOsascript(`set volume output volume ${level}`);
        return { ok: out.code === 0, level };
      },
    });

    this.register({
      name: "system_info",
      description: "Get host system info: OS version, hostname, CPU, memory, uptime, current user.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const sw = await this.execProcess("/usr/bin/sw_vers", [], { timeoutMs: 5_000 });
        return {
          ok: true,
          platform: process.platform,
          arch: process.arch,
          hostname: os.hostname(),
          user: os.userInfo().username,
          cpus: os.cpus().length,
          totalMemGB: Math.round((os.totalmem() / 1e9) * 10) / 10,
          freeMemGB: Math.round((os.freemem() / 1e9) * 10) / 10,
          uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
          osVersion: sw.stdout.trim().replace(/\n/g, " "),
        };
      },
    });

    // -- Correo (Apple Mail) --------------------------------------------------
    this.register({
      name: "mail_read",
      description:
        "Read recent emails from Apple Mail. Returns subject, sender, date and a preview of each message. Requires Mail to be configured on this Mac.",
      risk: "low",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max messages to return (default 10)." },
          mailbox: { type: "string", description: "Mailbox name (default 'INBOX')." },
          unreadOnly: { type: "boolean", description: "Only unread messages." },
        },
      },
      run: async (params) => {
        const limit = Math.max(1, Math.min(50, Math.round(num(params, "limit", 10))));
        const mailbox = escapeAppleScript(str(params, "mailbox", "INBOX"));
        const unreadOnly = bool(params, "unreadOnly");
        const unreadFilter = unreadOnly ? " whose read status is false" : "";

        const script = `
tell application "Mail"
  set theAccount to first account
  set theMailbox to mailbox "${mailbox}" of theAccount
  set theMsgs to (messages${unreadFilter} of theMailbox)
  set theTotal to count of theMsgs
  set theLimit to ${limit}
  if theTotal < theLimit then set theLimit to theTotal
  set resultList to {}
  repeat with i from 1 to theLimit
    set theMsg to item i of theMsgs
    set theSub to subject of theMsg
    set theSender to sender of theMsg
    set theDate to (date received of theMsg) as string
    set theRead to read status of theMsg
    set thePreview to ""
    try
      set theContent to content of theMsg
      if (count of theContent) > 300 then
        set thePreview to text 1 thru 300 of theContent
      else
        set thePreview to theContent
      end if
    end try
    set end of resultList to theSub & " || " & theSender & " || " & theDate & " || " & (theRead as string) & " || " & thePreview
  end repeat
  set AppleScript's text item delimiters to "\\n---\\n"
  set output to resultList as string
  set AppleScript's text item delimiters to ""
  return output & "\\nTOTAL:" & theTotal
end tell
`.trim();

        const out = await this.runOsascript(script);
        if (!out.stdout.trim() && out.code !== 0) {
          return { ok: false, error: out.stderr.trim() || "Mail not available or not configured" };
        }

        const raw = out.stdout.trim();
        const lines = raw.split("\n---\n");
        const totalLine = lines[lines.length - 1] ?? "";
        const totalMatch = totalLine.match(/TOTAL:(\d+)/);
        const total = totalMatch ? Number(totalMatch[1]) : null;
        const messageParts = lines.filter((l) => !l.startsWith("TOTAL:") && l.trim());

        const messages = messageParts.map((part) => {
          const [subject, sender, date, read, ...previewParts] = part.split(" || ");
          return {
            subject: (subject ?? "").trim(),
            sender: (sender ?? "").trim(),
            date: (date ?? "").trim(),
            read: (read ?? "").trim() === "true",
            preview: previewParts.join(" || ").trim().slice(0, 300),
          };
        });

        return { ok: true, messages, total, mailbox, unreadOnly };
      },
    });
  }
}
