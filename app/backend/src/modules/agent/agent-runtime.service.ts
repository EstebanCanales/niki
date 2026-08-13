import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ChildProcessByStdio, spawn } from "child_process";
import type { Readable } from "stream";
import * as fs from "fs";
import * as path from "path";

/**
 * Ciclo de vida del runtime del agente — el fork de Hermes que vive en
 * `app/agent-runtime/`.
 *
 * Antes esto era un proceso que Esteban levantaba a mano en `127.0.0.1:8642`, con su
 * estado en `~/.hermes`. Cuando se caía, Niki se quedaba muda sin decir por qué: el
 * síntoma era "no me responde" y la causa estaba a tres capas de distancia. Ahora el
 * proceso es de Niki — arranca con el backend, muere con él, se reinicia solo, y su
 * estado vive dentro del proyecto.
 *
 * El Hermes personal de Esteban sigue en 8642 con su propio `HERMES_HOME`. Son dos
 * instalaciones separadas y no se pisan.
 */

export type AgentRuntimeState =
  | "disabled"
  | "starting"
  | "ready"
  | "restarting"
  | "failed";

/** Un proveedor de inferencia que el runtime sabe usar. */
export type AgentProvider = {
  id: string;
  name: string;
  authType: string;
  baseUrl: string;
  apiKeyEnvVars: string[];
  baseUrlEnvVar: string;
  /** Si hay credencial en el entorno — nunca se expone el valor. */
  credentialReady: boolean;
  credentialFrom: string | null;
};

export type AgentRuntimeStatus = {
  state: AgentRuntimeState;
  baseUrl: string;
  pid?: number;
  restarts: number;
  /** Motivo del último fallo, para poder decirlo en la UI en vez de callarlo. */
  lastError?: string;
};

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const RUNTIME_DIR = path.join(REPO_ROOT, "app", "agent-runtime");
const AGENT_HOME = path.join(REPO_ROOT, "app", "backend", "agent-home");

/** Puerto propio. 8642 es el Hermes personal de Esteban y no lo tocamos. */
const DEFAULT_PORT = 8643;

/** Cuánto se espera a que conteste `/v1/health` antes de darlo por fallido. */
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

/** Backoff entre reintentos: sube, pero no tanto como para que parezca colgado. */
const RESTART_BACKOFF_MS = [1_000, 3_000, 8_000, 20_000];

@Injectable()
export class AgentRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentRuntimeService.name);
  /** stdin cerrado: el runtime no espera nada por entrada estándar. */
  private proc?: ChildProcessByStdio<null, Readable, Readable>;
  private state: AgentRuntimeState = "starting";
  private restarts = 0;
  private lastError?: string;
  private stopping = false;
  private restartTimer?: NodeJS.Timeout;

  get port(): number {
    const raw = Number(process.env.NIKI_AGENT_PORT ?? DEFAULT_PORT);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PORT;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Apagable por config: si el fork no está instalado, Niki sigue andando sin él. */
  get enabled(): boolean {
    return String(process.env.NIKI_AGENT_RUNTIME ?? "on").toLowerCase() !== "off";
  }

  status(): AgentRuntimeStatus {
    return {
      state: this.state,
      baseUrl: this.baseUrl,
      pid: this.proc?.pid,
      restarts: this.restarts,
      lastError: this.lastError,
    };
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.state = "disabled";
      this.logger.log("[agente] runtime interno apagado por configuración");
      return;
    }
    const python = this.pythonPath();
    if (!python) {
      this.state = "failed";
      this.lastError =
        `No hay entorno en ${RUNTIME_DIR}/venv. Crearlo con: ` +
        `cd app/agent-runtime && python3 -m venv venv && ./venv/bin/pip install -e . aiohttp`;
      this.logger.error(`[agente] ${this.lastError}`);
      return;
    }
    this.start();
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.kill();
  }

  // ── Proveedores y modelo ──────────────────────────────────────────────────
  //
  // El fork trae 38 proveedores (openrouter, anthropic, gemini, kimi, minimax, bedrock,
  // el openai-compatible que agregamos…). Esto los expone para poder elegir con cuál
  // piensa Niki sin editar YAML a mano.

  async listProviders(): Promise<AgentProvider[]> {
    const python = this.pythonPath();
    if (!python) return [];
    const script = path.join(REPO_ROOT, "app", "backend", "scripts", "listar-proveedores.py");
    try {
      const out = await this.runPython(python, [script]);
      const parsed = JSON.parse(out) as { ok?: boolean; providers?: AgentProvider[] };
      return parsed.providers ?? [];
    } catch (error) {
      this.logger.warn(`[agente] no se pudieron listar proveedores: ${String(error)}`);
      return [];
    }
  }

  /** Proveedor y modelo activos, leídos de la config del runtime. */
  currentModel(): { provider: string; model: string; baseUrl: string } {
    const cfg = this.readConfig();
    const model = (cfg.model ?? {}) as Record<string, string>;
    return {
      provider: String(model.provider ?? ""),
      model: String(model.default ?? ""),
      baseUrl: String(model.base_url ?? ""),
    };
  }

  /**
   * Cambia proveedor y modelo, y reinicia el runtime para que tome el cambio.
   *
   * Se reescribe solo el bloque `model` y se deja el resto del YAML como está: el
   * archivo tiene comentarios que explican el recorte de herramientas y por qué Groq no
   * sirve para el bucle de agente, y reescribirlo entero los borraría.
   */
  async setModel(provider: string, model: string, baseUrl?: string): Promise<void> {
    const cfg = this.readConfig();
    cfg.model = {
      ...(cfg.model as Record<string, unknown> | undefined),
      provider,
      default: model,
      ...(baseUrl ? { base_url: baseUrl } : {}),
    };
    this.writeConfigModelBlock(cfg.model as Record<string, unknown>);
    this.logger.log(`[agente] proveedor → ${provider} / ${model}; reiniciando runtime`);
    this.restarts = 0;
    this.kill();
    // El kill es asíncrono; se deja respirar antes de levantarlo de nuevo.
    await new Promise((r) => setTimeout(r, 1_500));
    this.start();
  }

  private configPath(): string {
    return path.join(AGENT_HOME, "config.yaml");
  }

  /** Lectura mínima del YAML: solo se necesita el bloque `model`, que es plano. */
  private readConfig(): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(this.configPath(), "utf8");
      const model: Record<string, string> = {};
      let inModel = false;
      for (const line of raw.split("\n")) {
        if (/^model:\s*$/.test(line)) { inModel = true; continue; }
        if (inModel && /^\S/.test(line)) break;
        if (!inModel) continue;
        const m = line.match(/^\s+([a-z_]+):\s*(.+?)\s*$/);
        if (m) model[m[1]] = m[2];
      }
      return { model };
    } catch {
      return { model: {} };
    }
  }

  private writeConfigModelBlock(model: Record<string, unknown>) {
    const raw = fs.readFileSync(this.configPath(), "utf8");
    const lines = raw.split("\n");
    const start = lines.findIndex((l) => /^model:\s*$/.test(l));
    if (start < 0) throw new Error("config.yaml sin bloque model");
    let end = start + 1;
    while (end < lines.length && (lines[end].startsWith(" ") || lines[end].trim() === "")) end += 1;
    const block = ["model:", ...Object.entries(model).map(([k, v]) => `  ${k}: ${String(v)}`)];
    fs.writeFileSync(this.configPath(), [...lines.slice(0, start), ...block, ...lines.slice(end)].join("\n"));
  }

  private runPython(python: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(python, args, { cwd: REPO_ROOT, env: process.env });
      let out = "";
      let err = "";
      proc.stdout.on("data", (c: Buffer) => (out += c.toString()));
      proc.stderr.on("data", (c: Buffer) => (err += c.toString()));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(err.slice(0, 300) || `código ${code}`)),
      );
    });
  }

  private pythonPath(): string | null {
    const venv = path.join(RUNTIME_DIR, "venv", "bin", "python");
    return fs.existsSync(venv) ? venv : null;
  }

  private kill() {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc?.pid || proc.killed) return;

    // Se mata el GRUPO, no el proceso. El gateway se re-lanza a sí mismo, así que
    // matar solo al hijo directo deja nietos vivos ocupando el puerto — se vio pasar.
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-proc.pid!, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
          /* ya no está */
        }
      }
    };

    // SIGTERM primero: el gateway limpia su lock y su pid al salir.
    signalGroup("SIGTERM");
    setTimeout(() => signalGroup("SIGKILL"), 5_000).unref();
  }

  private start() {
    const python = this.pythonPath();
    if (!python || this.stopping) return;

    fs.mkdirSync(AGENT_HOME, { recursive: true });

    this.state = this.restarts > 0 ? "restarting" : "starting";
    const proc = spawn(python, ["-m", "hermes_cli.main", "gateway", "run"], {
      cwd: RUNTIME_DIR,
      env: {
        ...process.env,
        // Todo el estado del agente vive dentro del proyecto. Es la línea que hace
        // cierto el "nada externo": sin esto volvería a escribir en ~/.hermes.
        HERMES_HOME: AGENT_HOME,
        API_SERVER_ENABLED: "true",
        API_SERVER_HOST: "127.0.0.1",
        API_SERVER_PORT: String(this.port),
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Grupo de procesos propio, para poder matarlo entero (ver `kill`).
      detached: true,
    });
    this.proc = proc;

    proc.stdout.on("data", (chunk: Buffer) => this.log(chunk));
    proc.stderr.on("data", (chunk: Buffer) => this.log(chunk));

    proc.on("error", (error) => {
      this.lastError = error.message;
      this.logger.error(`[agente] no se pudo lanzar el runtime: ${error.message}`);
      this.scheduleRestart();
    });

    proc.on("exit", (code, signal) => {
      if (this.stopping) return;
      this.lastError = `el runtime terminó (código ${code ?? "?"}${signal ? `, señal ${signal}` : ""})`;
      this.logger.warn(`[agente] ${this.lastError}`);
      this.scheduleRestart();
    });

    void this.waitUntilReady();
  }

  /** El gateway es ruidoso; solo se sube lo que sirve para diagnosticar. */
  private log(chunk: Buffer) {
    const text = chunk.toString().trim();
    if (!text) return;
    for (const line of text.split("\n")) {
      if (/error|traceback|critical/i.test(line)) this.logger.error(`[agente] ${line}`);
      else if (/warn/i.test(line)) this.logger.warn(`[agente] ${line}`);
    }
  }

  private async waitUntilReady() {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && !this.stopping) {
      if (await this.probe()) {
        this.state = "ready";
        this.lastError = undefined;
        this.logger.log(`[agente] runtime interno listo en ${this.baseUrl} (home: agent-home/)`);
        return;
      }
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
    if (this.stopping) return;
    this.state = "failed";
    this.lastError = `el runtime no respondió en ${READY_TIMEOUT_MS / 1000}s`;
    this.logger.error(`[agente] ${this.lastError}`);
  }

  private async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private scheduleRestart() {
    if (this.stopping) return;
    const delay = RESTART_BACKOFF_MS[Math.min(this.restarts, RESTART_BACKOFF_MS.length - 1)];
    this.restarts += 1;
    this.state = "restarting";
    this.logger.warn(`[agente] reintentando en ${delay}ms (intento ${this.restarts})`);
    this.restartTimer = setTimeout(() => this.start(), delay);
    this.restartTimer.unref?.();
  }
}
