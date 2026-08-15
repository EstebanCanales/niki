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

/**
 * Cuánto contexto lleva una sesión. `tokens` incluye el prompt de sistema, los mensajes y
 * el esquema de las herramientas — que con cincuenta herramientas pesan más que la
 * conversación entera.
 */
export type AgentContextoSesion = {
  ok: boolean;
  sessionId: string;
  existe: boolean;
  tokens: number;
  modelo?: string;
  mensajes?: number;
  herramientas?: number;
  contexto?: number;
  /** A partir de acá compacta. Tiene un piso de 64.000 que no baja por configuración. */
  umbral?: number;
  compactaHabilitada?: boolean;
};

/** URL y código que hay que abrir para completar el inicio de sesión. */
export type ProviderLogin = {
  url: string;
  code: string | null;
  waiting: boolean;
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

  /**
   * Cuánto contexto lleva usado una sesión y a partir de qué número se compacta.
   *
   * El cálculo lo hace el propio runtime (ver scripts/medir-contexto.py): es la misma
   * función que decide cuándo compactar, así que el indicador y el comportamiento no
   * pueden desincronizarse. Cuesta un proceso de Python, así que se pide cuando se mira,
   * no en cada turno.
   */
  async contextoDeSesion(sessionId: string): Promise<AgentContextoSesion> {
    const vacio: AgentContextoSesion = { ok: false, sessionId, existe: false, tokens: 0 };
    const python = this.pythonPath();
    if (!python) return vacio;
    const script = path.join(REPO_ROOT, "app", "backend", "scripts", "medir-contexto.py");
    try {
      const out = await this.runPython(python, [script, sessionId]);
      return JSON.parse(out) as AgentContextoSesion;
    } catch (error) {
      this.logger.warn(`[agente] no se pudo medir el contexto: ${String(error)}`);
      return vacio;
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

  /**
   * Arranca el inicio de sesión de un proveedor por suscripción y devuelve la URL y el
   * código para mostrarlos en la app.
   *
   * Antes esto abría una Terminal, que era mandar al usuario a otro lado a hacer algo
   * que la app puede mostrar. Los flujos son de código de dispositivo: el runtime
   * imprime una URL y un código y se queda esperando la aprobación. El puente los
   * captura y deja el proceso vivo; cuando aprobás, guarda la credencial solo.
   */
  async startProviderLogin(providerId: string): Promise<ProviderLogin> {
    const python = this.pythonPath();
    if (!python) throw new Error("El runtime del agente no está instalado.");
    const script = path.join(REPO_ROOT, "app", "backend", "scripts", "login-proveedor.py");
    const out = await this.runPython("python3", [script, providerId]);
    const parsed = JSON.parse(out) as ProviderLogin & { ok: boolean; error?: string };
    if (!parsed.ok) throw new Error(parsed.error || "No se pudo iniciar sesión.");
    return parsed;
  }

  /** ¿Ya está la sesión de ese proveedor? */
  async providerLoginStatus(providerId: string): Promise<{ loggedIn: boolean; detail?: string }> {
    const python = this.pythonPath();
    if (!python) return { loggedIn: false };
    const script = path.join(REPO_ROOT, "app", "backend", "scripts", "login-proveedor.py");
    try {
      const out = await this.runPython("python3", [script, providerId, "--estado"]);
      const parsed = JSON.parse(out) as { loggedIn?: boolean; detail?: string };
      return { loggedIn: !!parsed.loggedIn, detail: parsed.detail };
    } catch {
      return { loggedIn: false };
    }
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
    // `--replace` no es opcional: el gateway deja un lock con su pid en HERMES_HOME y se
    // niega a arrancar ("Gateway already running") si lo encuentra. Tras un kill -9 el
    // lock queda huérfano y cada reintento moría con código 1 — un bucle de reinicios
    // cada 20s que igual respondía, porque una instancia sí había llegado a levantar.
    const proc = spawn(python, ["-m", "hermes_cli.main", "gateway", "run", "--replace"], {
      // El agente trabaja desde la raíz del proyecto, no desde el fuente del fork.
      // Con cwd en app/agent-runtime, "leé package.json" contestaba que no existe
      // porque estaba parado dentro del código de Hermes. El paquete está instalado
      // en modo editable, así que resuelve igual desde cualquier directorio.
      cwd: process.env.NIKI_AGENT_CWD || REPO_ROOT,
      env: {
        ...process.env,
        // Todo el estado del agente vive dentro del proyecto. Es la línea que hace
        // cierto el "nada externo": sin esto volvería a escribir en ~/.hermes.
        HERMES_HOME: AGENT_HOME,
        API_SERVER_ENABLED: "true",
        API_SERVER_HOST: "127.0.0.1",
        API_SERVER_PORT: String(this.port),
        // Destraba la herramienta `cronjob`, que está condicionada a esta variable
        // (tools/cronjob_tools.py:665) y sin ella no se publica: Niki no podía crear
        // sus propias rutinas. Es semánticamente correcto — lo que levantamos ES la
        // sesión del gateway, y el planificador lo tickea este mismo proceso.
        HERMES_GATEWAY_SESSION: "1",
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
