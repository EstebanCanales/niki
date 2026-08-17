import { Logger } from "@nestjs/common";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
export const BACKEND = path.join(REPO_ROOT, "app", "backend");

/**
 * Un worker de Python que habla JSON por línea.
 *
 * Los modelos que usa Niki —la voz de Qwen3, la huella de voz de SpeechBrain, la huella de
 * cara de OpenCV— tardan segundos en cargar, así que arrancar un proceso por petición no
 * es una opción. El patrón es siempre el mismo: un proceso vivo, una petición JSON por
 * línea en stdin, una respuesta por línea en stdout, una por vez.
 *
 * Esto existe para no tener ese patrón escrito tres veces. La parte delicada —la cola, el
 * tiempo límite, qué pasa cuando el proceso se muere con una petición en vuelo— es la que
 * uno no quiere mantener por triplicado y en la que las copias se desincronizan.
 */
export class WorkerJson {
  private worker?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending?: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param nombre        Cómo se llama en los logs.
   * @param script        Ruta al .py.
   * @param tiempoLimite  Cuánto se espera una respuesta. La primera petición carga el
   *                      modelo y puede tardar de verdad.
   */
  constructor(
    private readonly nombre: string,
    private readonly script: string,
    private readonly logger: Logger,
    private readonly tiempoLimite = 120_000,
  ) {}

  private pythonPath(): string | null {
    // El mismo venv para todos los workers: tener uno por modelo multiplica los
    // gigabytes de torch sin que ninguno gane nada.
    const venv = path.join(BACKEND, "venv-qwen3-tts", "bin", "python3");
    return fs.existsSync(venv) && fs.existsSync(this.script) ? venv : null;
  }

  get available(): boolean {
    return this.pythonPath() !== null;
  }

  detener() {
    this.worker?.kill();
    this.worker = undefined;
  }

  private asegurarWorker(): ChildProcessWithoutNullStreams {
    if (this.worker && !this.worker.killed) return this.worker;
    const python = this.pythonPath();
    if (!python) throw new Error(`${this.nombre} no está instalado (falta venv o script).`);

    const worker = spawn(python, [this.script], { cwd: BACKEND, stdio: ["pipe", "pipe", "pipe"] });
    this.worker = worker;
    this.buffer = "";

    worker.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lineas = this.buffer.split("\n");
      this.buffer = lineas.pop() ?? "";
      for (const linea of lineas) {
        if (!linea.trim() || !this.pending) continue;
        const pendiente = this.pending;
        this.pending = undefined;
        try {
          pendiente.resolve(JSON.parse(linea));
        } catch (error) {
          pendiente.reject(new Error(`Respuesta inválida de ${this.nombre}: ${String(error)}`));
        }
      }
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      const texto = chunk.toString().trim();
      if (texto) this.logger.log(`[${this.nombre}] ${texto.slice(0, 200)}`);
    });

    const morir = (motivo: string) => {
      // Sin esto, una petición en vuelo cuando el proceso muere queda colgada para
      // siempre y el llamador nunca se entera.
      this.pending?.reject(new Error(motivo));
      this.pending = undefined;
      this.worker = undefined;
    };
    worker.on("error", (e) => morir(`No se pudo iniciar ${this.nombre}: ${e.message}`));
    worker.on("close", (code) => morir(`${this.nombre} terminó (código ${code ?? "?"}).`));
    return worker;
  }

  /** Una petición por vez: el worker responde en orden por stdout. */
  enviar<T>(payload: Record<string, unknown>): Promise<T> {
    const correr = async (): Promise<T> => {
      const worker = this.asegurarWorker();
      return new Promise<T>((resolve, reject) => {
        const reloj = setTimeout(() => {
          this.pending = undefined;
          reject(new Error(`${this.nombre} no respondió a tiempo.`));
        }, this.tiempoLimite);
        this.pending = {
          resolve: (v) => { clearTimeout(reloj); resolve(v as T); },
          reject: (e) => { clearTimeout(reloj); reject(e); },
        };
        worker.stdin.write(JSON.stringify(payload) + "\n");
      });
    };
    // `then(correr, correr)` y no `then(correr)`: si una petición falla, la siguiente
    // tiene que correr igual en vez de heredar el rechazo y caerse en cadena.
    this.queue = this.queue.then(correr, correr);
    return this.queue as Promise<T>;
  }
}
