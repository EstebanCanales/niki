import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Huella de voz: decide si quien habló es el dueño de la cuenta.
 *
 * Corre en paralelo con la transcripción, no antes. La app ya sube el audio una vez y
 * Groq tarda ~1.1 s, así que verificar quién habló no agrega latencia percibida.
 *
 * Worker Python persistente (mismo patrón que Qwen3-TTS) porque cargar ECAPA cuesta y no
 * se puede pagar en cada turno.
 */

export type SpeakerVerdict = {
  /** Hay un perfil registrado para este usuario. */
  enrolled: boolean;
  /** Si la voz coincide. **Siempre true cuando no hay perfil** — ver `verify`. */
  match: boolean;
  score: number | null;
  threshold?: number;
};

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const BACKEND = path.join(REPO_ROOT, "app", "backend");
const SCRIPT = path.join(BACKEND, "speaker", "verify.py");

/** El worker puede tardar en la primera petición: carga el modelo. */
const TIMEOUT_MS = 120_000;

@Injectable()
export class SpeakerService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeakerService.name);
  private worker?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending?: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  private queue: Promise<unknown> = Promise.resolve();

  onModuleDestroy() {
    this.worker?.kill();
    this.worker = undefined;
  }

  private pythonPath(): string | null {
    const venv = path.join(BACKEND, "venv-qwen3-tts", "bin", "python3");
    return fs.existsSync(venv) && fs.existsSync(SCRIPT) ? venv : null;
  }

  get available(): boolean {
    return this.pythonPath() !== null;
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker && !this.worker.killed) return this.worker;
    const python = this.pythonPath();
    if (!python) throw new Error("La huella de voz no está instalada (falta venv o script).");

    const worker = spawn(python, [SCRIPT], { cwd: BACKEND, stdio: ["pipe", "pipe", "pipe"] });
    this.worker = worker;
    this.buffer = "";

    worker.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim() || !this.pending) continue;
        const pending = this.pending;
        this.pending = undefined;
        try {
          pending.resolve(JSON.parse(line));
        } catch (error) {
          pending.reject(new Error(`Respuesta inválida de la huella de voz: ${String(error)}`));
        }
      }
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.logger.log(`[huella] ${text.slice(0, 200)}`);
    });
    const morir = (motivo: string) => {
      this.pending?.reject(new Error(motivo));
      this.pending = undefined;
      this.worker = undefined;
    };
    worker.on("error", (e) => morir(`No se pudo iniciar la huella de voz: ${e.message}`));
    worker.on("close", (code) => morir(`La huella de voz terminó (código ${code ?? "?"}).`));
    return worker;
  }

  /** Una petición por vez: el worker responde en orden por stdout. */
  private send<T>(payload: Record<string, unknown>): Promise<T> {
    const run = async (): Promise<T> => {
      const worker = this.ensureWorker();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = undefined;
          reject(new Error("La huella de voz no respondió a tiempo."));
        }, TIMEOUT_MS);
        this.pending = {
          resolve: (v) => { clearTimeout(timer); resolve(v as T); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        };
        worker.stdin.write(JSON.stringify(payload) + "\n");
      });
    };
    this.queue = this.queue.then(run, run);
    return this.queue as Promise<T>;
  }

  async enroll(userId: string, samples: Buffer[]) {
    return this.send<{ ok: boolean; error?: string; threshold?: number; samples?: number }>({
      op: "enroll",
      userId,
      samples: samples.map((s) => s.toString("base64")),
    });
  }

  async status(userId: string) {
    return this.send<{ ok: boolean; enrolled: boolean; threshold?: number; samples?: number }>({
      op: "status",
      userId,
    });
  }

  /**
   * ¿Habló el dueño?
   *
   * **Falla en abierto, siempre.** Sin perfil, con el worker caído o con un error
   * inesperado, devuelve `match: true`. La alternativa —fallar cerrado— convierte
   * cualquier problema de esta pieza en "Niki no me escucha", que es mucho peor que
   * responderle alguna vez a otra persona.
   */
  async verify(userId: string, audio: Buffer): Promise<SpeakerVerdict> {
    if (!this.available) return { enrolled: false, match: true, score: null };
    try {
      const r = await this.send<SpeakerVerdict & { ok: boolean }>({
        op: "verify",
        userId,
        audio: audio.toString("base64"),
      });
      return { enrolled: !!r.enrolled, match: r.match !== false, score: r.score ?? null, threshold: r.threshold };
    } catch (error) {
      this.logger.warn(`[huella] verificación falló, se acepta el turno: ${String(error)}`);
      return { enrolled: false, match: true, score: null };
    }
  }
}
