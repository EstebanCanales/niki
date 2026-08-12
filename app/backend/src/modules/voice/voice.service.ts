import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const WHISPER_SERVER_URL = "http://127.0.0.1:8090";
/// Ventana de ventaja que le damos a Groq (mejor calidad) antes de conformarnos con el
/// whisper local (más rápido, peor texto). Groq normalmente entra en ~1s.
/** Ventana de ventaja para Groq antes de conformarnos con el whisper local.
 *
 *  Medido en esta máquina, en tres tandas: Groq resuelve entre 1100 y 1500ms. Con la
 *  ventana en 900, 1200 y 1500ms lo cortábamos justo en su latencia típica y entraba el
 *  modelo `base` local, que devuelve cosas como "Hola, Nicunés" o "Hola, ni aquí me
 *  escuches". Una transcripción mala no cuesta un segundo: cuesta el turno entero,
 *  porque Niki responde en serio a algo que nadie dijo.
 *
 *  Por eso la ventana ya no intenta ganarle unos ms a Groq. Es una red de seguridad para
 *  cuando Groq de verdad se atasca; el local está listo a los ~900ms y espera ahí. Si
 *  algún día Groq baja de forma estable, este número puede bajar con él — pero midiendo
 *  primero, que es lo que hizo falta las tres veces anteriores. */
const GROQ_GRACE_MS = 2_500;
/** Techo de la ventana: más allá de esto, esperar deja de compensar. */
const GROQ_GRACE_MAX_MS = 4_500;
/** Cuánto se estira la ventana por cada segundo de audio. */
const GROQ_GRACE_PER_SECOND_MS = 250;

/**
 * Duración aproximada de un WAV PCM16 mono. Si no parece un WAV nuestro, devuelve 0 y
 * la ventana se queda en la base — mejor subestimar que esperar de más.
 */
function wavSeconds(buffer: Buffer) {
  if (buffer.length < 44 || buffer.subarray(0, 4).toString("ascii") !== "RIFF") return 0;
  const sampleRate = buffer.readUInt32LE(24);
  const byteRate = buffer.readUInt32LE(28);
  if (!sampleRate || !byteRate) return 0;
  return (buffer.length - 44) / byteRate;
}

function graceForAudio(buffer: Buffer) {
  const seconds = wavSeconds(buffer);
  return Math.min(GROQ_GRACE_MAX_MS, GROQ_GRACE_MS + Math.round(seconds * GROQ_GRACE_PER_SECOND_MS));
}
/** Cuánto espera el corredor local antes de arrancar, para no quemar CPU en una
 *  carrera que Groq casi siempre gana. */
const LOCAL_RACER_DELAY_MS = 350;

function detectAudioFormat(buffer: Buffer): { ext: string; mime: string } {
  if (buffer.length < 12) return { ext: "webm", mime: "audio/webm" };
  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff === "RIFF" && wave === "WAVE") return { ext: "wav", mime: "audio/wav" };
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)
    return { ext: "webm", mime: "audio/webm" };
  if (riff === "ID3") return { ext: "mp3", mime: "audio/mpeg" };
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return { ext: "mp3", mime: "audio/mpeg" };
  const ftyp = buffer.toString("ascii", 4, 8);
  if (ftyp === "ftyp" || ftyp === "moov") return { ext: "m4a", mime: "audio/m4a" };
  return { ext: "webm", mime: "audio/webm" };
}

// Alucinaciones comunes de Whisper en silencio
const WHISPER_HALLUCINATIONS = new Set([
  ".", "..", "...", "♪", "♫", "[música]", "[music]", "[silencio]", "[silence]",
  "subtítulos realizados por la comunidad de amara.org",
  "subtitles by the amara.org community",
]);

function isHallucination(text: string): boolean {
  return WHISPER_HALLUCINATIONS.has(text.toLowerCase().trim());
}

type SttResult = { ok: boolean; text: string; language: string; duration: number; provider?: string };
type TtsResult = { ok: boolean; audio?: string; format?: string; mime?: string; error?: string; duration: number; provider?: string };

type QwenWorkerResponse = Omit<TtsResult, "duration">;

@Injectable()
export class VoiceService implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceService.name);
  private readonly modelPath: string;
  private readonly whisperCli: string;
  private qwenWorker?: ChildProcessWithoutNullStreams;
  private qwenWorkerBuffer = "";
  private qwenPending?: { resolve: (value: QwenWorkerResponse) => void; reject: (reason?: unknown) => void };
  private qwenQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    const candidates = ["whisper-cli", "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"];
    this.whisperCli = candidates.find((c) => {
      try {
        if (c === "whisper-cli") {
          require("child_process").execSync("which whisper-cli", { stdio: "ignore" });
          return true;
        }
        fs.accessSync(c, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? "whisper-cli";

    const modelDir = path.join(process.cwd(), "whisper", "models");
    const modelCandidates = [
      path.join(modelDir, "ggml-base.bin"),
      path.join(modelDir, "ggml-tiny.bin"),
      "/opt/homebrew/share/whisper-cpp/ggml-base.bin",
      "/opt/homebrew/share/whisper-cpp/ggml-tiny.bin",
    ];
    this.modelPath = modelCandidates.find((p) => fs.existsSync(p)) ?? "";
  }

  onModuleDestroy() {
    this.qwenPending?.reject(new Error("Qwen3-TTS se cerró."));
    this.qwenPending = undefined;
    this.qwenWorker?.kill();
    this.qwenWorker = undefined;
  }

  isEnabled() {
    return Boolean(this.groqApiKey()) || Boolean(this.modelPath);
  }

  isTtsEnabled() {
    const scriptPath = path.join(process.cwd(), "qwen3-tts", "synthesize.py");
    const venvPython = process.env.QWEN3_TTS_PYTHON || path.join(process.cwd(), "venv-qwen3-tts", "bin", "python3");
    return fs.existsSync(scriptPath) && fs.existsSync(venvPython);
  }

  /**
   * Orden de prioridad, pensado para conversación en vivo (nunca dejar al usuario
   * sin transcripción, y nunca tardar 30s "teniendo éxito"):
   * 1. Groq Whisper API (whisper-large-v3-turbo, ~1s, la mejor calidad de texto)
   * 2. whisper-server local (~250ms, modelo base — peor calidad pero SIEMPRE responde:
   *    es la red de seguridad cuando Groq falla, se pasa de rate limit o hace timeout)
   * 3. whisper-cli local (carga el modelo en frío, ~30s — último recurso)
   *
   * Groq va primero por calidad: una transcripción mala manda basura al LLM y arruina
   * la respuesta, lo que se siente peor que ~1s extra de espera.
   */
  async transcribe(audioBuffer: Buffer, language?: string, prompt?: string): Promise<SttResult> {
    const startedAt = performance.now();
    const lang = (language ?? "es").trim() || "es";
    const failures: string[] = [];

    // 1+2. Groq y whisper local CORREN EN PARALELO y compiten.
    //
    // Groq transcribe mejor (~1s) y el whisper local es mucho más rápido (~250ms) pero
    // con un modelo `base` que se come acentos y nombres. En una conversación en vivo
    // no queremos elegir de antemano: lanzamos los dos y le damos a Groq una ventana
    // corta de ventaja. Si contesta dentro de esa ventana, usamos su texto; si se
    // demora o falla, ya tenemos el local listo y seguimos sin dejar huecos de silencio.
    // La ventana escala con la duración del audio: Groq tarda más con clips largos, y
    // una ventana fija descalificaba justo las frases largas — las que más importa
    // transcribir bien. Medido: 7s de audio necesitaron 2512ms.
    const graceMs = graceForAudio(audioBuffer);

    const key = this.groqApiKey();
    const runLocal = () =>
      this.transcribeWithLocalServer(audioBuffer, lang).then(
        (text) => ({ ok: true as const, text }),
        (err) => ({ ok: false as const, err }),
      );

    if (key) {
      const groqPromise = this.transcribeWithGroq(audioBuffer, lang, key).then(
        (text) => ({ ok: true as const, text }),
        (err) => ({ ok: false as const, err }),
      );

      // El corredor local no arranca de inmediato. Groq resuelve en 400-800ms en el caso
      // común, y whisper corre en la MISMA máquina que renderiza el orbe y captura el
      // audio: gastar esa CPU para perder la carrera se paga en la app. Si Groq ya
      // contestó bien cuando vence el retardo, el local ni se lanza; si sigue pendiente
      // o falló, sale igual y llega a tiempo para la ventana de gracia.
      let groqSucceeded = false;
      void groqPromise.then((r) => {
        groqSucceeded = r.ok;
      });
      const localPromise = (async () => {
        await new Promise((r) => setTimeout(r, LOCAL_RACER_DELAY_MS));
        if (groqSucceeded) return { ok: false as const, err: new Error("groq ya había contestado") };
        return runLocal();
      })();

      // Ventana de ventaja para Groq: lo que tarde el local + un margen.
      const grace = new Promise<"grace">((r) => setTimeout(() => r("grace"), graceMs));
      const winner = await Promise.race([groqPromise, grace]);

      if (winner !== "grace" && winner.ok) {
        const durationMs = Math.round(performance.now() - startedAt);
        this.logger.log(`[voice] groq-stt ${durationMs}ms lang=${lang} chars=${winner.text.length}`);
        return { ok: true, text: winner.text, language: lang, duration: durationMs, provider: "groq" };
      }

      const local = await localPromise;
      if (local.ok && local.text.trim()) {
        const durationMs = Math.round(performance.now() - startedAt);
        const why = winner === "grace" ? "groq lento" : "groq falló";
        this.logger.log(`[voice] whisper-local ${durationMs}ms lang=${lang} chars=${local.text.length} (${why})`);
        return { ok: true, text: local.text, language: lang, duration: durationMs, provider: "whisper-local" };
      }
      // El local no sirvió: esperamos a Groq aunque se haya pasado de la ventana.
      const groq = await groqPromise;
      if (groq.ok) {
        const durationMs = Math.round(performance.now() - startedAt);
        this.logger.log(`[voice] groq-stt ${durationMs}ms lang=${lang} chars=${groq.text.length} (tarde)`);
        return { ok: true, text: groq.text, language: lang, duration: durationMs, provider: "groq" };
      }
      failures.push(`groq: ${String(groq.err)}`);
      if (!local.ok) failures.push(`whisper-server: ${String(local.err)}`);
    } else {
      const local = await runLocal();
      if (local.ok) {
        const durationMs = Math.round(performance.now() - startedAt);
        this.logger.log(`[voice] whisper-local ${durationMs}ms lang=${lang} chars=${local.text.length}`);
        return { ok: true, text: local.text, language: lang, duration: durationMs, provider: "whisper-local" };
      }
      failures.push(`whisper-server: ${String(local.err)}`);
    }

    // 3. whisper-cli local (carga modelo cada llamada — lento, último recurso)
    if (!this.modelPath) {
      throw new Error(`STT no disponible (${failures.join(" | ")})`);
    }
    const format = detectAudioFormat(audioBuffer);
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `niki-stt-${Date.now()}.${format.ext}`);
    fs.writeFileSync(tmpFile, audioBuffer);
    try {
      const text = await this.runWhisperCli(tmpFile, lang, prompt);
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.log(`[voice] whisper-cli ${durationMs}ms lang=${lang} chars=${text.length}`);
      return { ok: true, text, language: lang, duration: durationMs, provider: "whisper-cli" };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  async synthesize(text: string, language?: string, voice?: string): Promise<TtsResult> {
    const startedAt = performance.now();
    if (!this.isTtsEnabled()) {
      throw new Error("Qwen3-TTS no está configurado. Crea venv-qwen3-tts e instala qwen-tts.");
    }

    // Queue requests so a single loaded model remains safe and predictable.
    const result = await new Promise<QwenWorkerResponse>((resolve, reject) => {
      this.qwenQueue = this.qwenQueue.then(async () => {
        try {
          resolve(await this.synthesizeWithQwen(text, language, voice));
        } catch (error) {
          reject(error);
        }
      });
    });
    const durationMs = Math.round(performance.now() - startedAt);
    this.logger.log(`[voice] qwen3-tts ${durationMs}ms chars=${text.length}`);
    return { ...result, duration: durationMs };
  }

  private async synthesizeWithQwen(text: string, language?: string, voice?: string): Promise<QwenWorkerResponse> {
    const worker = this.ensureQwenWorker();
    return new Promise((resolve, reject) => {
      this.qwenPending = { resolve, reject };
      worker.stdin.write(`${JSON.stringify({ text, language, voice })}\n`);
    });
  }

  private ensureQwenWorker(): ChildProcessWithoutNullStreams {
    if (this.qwenWorker && !this.qwenWorker.killed) return this.qwenWorker;

    const scriptPath = path.join(process.cwd(), "qwen3-tts", "synthesize.py");
    const venvPython = process.env.QWEN3_TTS_PYTHON || path.join(process.cwd(), "venv-qwen3-tts", "bin", "python3");
    const worker = spawn(venvPython, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env },
    });
    this.qwenWorker = worker;
    this.qwenWorkerBuffer = "";

    worker.stdout.on("data", (chunk: Buffer) => {
      this.qwenWorkerBuffer += chunk.toString();
      const lines = this.qwenWorkerBuffer.split("\n");
      this.qwenWorkerBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim() || !this.qwenPending) continue;
        try {
          const response = JSON.parse(line) as QwenWorkerResponse;
          const pending = this.qwenPending;
          this.qwenPending = undefined;
          pending.resolve(response);
        } catch (error) {
          const pending = this.qwenPending;
          this.qwenPending = undefined;
          pending?.reject(new Error(`Respuesta inválida de Qwen3-TTS: ${String(error)}`));
        }
      }
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      this.logger.log(`[qwen3-tts] ${chunk.toString().trim()}`);
    });
    worker.on("error", (error) => {
      this.qwenPending?.reject(new Error(`No se pudo iniciar Qwen3-TTS: ${error.message}`));
      this.qwenPending = undefined;
      this.qwenWorker = undefined;
    });
    worker.on("close", (code) => {
      this.qwenPending?.reject(new Error(`Qwen3-TTS terminó inesperadamente (código ${code ?? "desconocido"}).`));
      this.qwenPending = undefined;
      this.qwenWorker = undefined;
    });
    return worker;
  }

  // ---------------------------------------------------------------------------

  private groqApiKey(): string {
    return String(process.env.GROQ_API_KEY ?? "").trim();
  }

  /** Llama al whisper-server local en :8090 — modelo siempre cargado en RAM */
  private async transcribeWithLocalServer(audioBuffer: Buffer, lang: string): Promise<string> {
    const format = detectAudioFormat(audioBuffer);
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ) as ArrayBuffer;

    const formData = new FormData();
    formData.append("file", new Blob([arrayBuffer], { type: format.mime }), `audio.${format.ext}`);
    formData.append("language", lang);
    formData.append("response_format", "json");

    const res = await fetch(`${WHISPER_SERVER_URL}/inference`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) throw new Error(`whisper-server ${res.status}`);

    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return isHallucination(text) ? "" : text;
  }

  private async transcribeWithGroq(audioBuffer: Buffer, lang: string, apiKey: string): Promise<string> {
    const format = detectAudioFormat(audioBuffer);
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ) as ArrayBuffer;

    const formData = new FormData();
    formData.append("file", new Blob([arrayBuffer], { type: format.mime }), `audio.${format.ext}`);
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("language", lang);
    formData.append("response_format", "verbose_json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => String(res.status));
      throw new Error(`Groq STT ${res.status}: ${body.slice(0, 200)}`);
    }

    type VerboseSegment = { no_speech_prob?: number; text?: string };
    type VerboseResponse = { text?: string; segments?: VerboseSegment[] };
    const data = (await res.json()) as VerboseResponse;

    if (data.segments && data.segments.length > 0) {
      const voiced = data.segments.filter((s) => (s.no_speech_prob ?? 0) < 0.6);
      if (voiced.length === 0) return "";
      const text = voiced.map((s) => (s.text ?? "").trim()).join(" ").trim();
      return isHallucination(text) ? "" : text;
    }

    const text = (data.text ?? "").trim();
    return isHallucination(text) ? "" : text;
  }

  private runWhisperCli(audioPath: string, language: string, prompt?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["-m", this.modelPath, "-f", audioPath, "-l", language, "--no-timestamps", "-np"];
      if (prompt) args.push("--prompt", prompt);

      const proc = spawn(this.whisperCli, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;

      // whisper-cli carga el modelo en frío en cada llamada (sin timeout, un proceso
      // colgado dejaría el request de NestJS esperando indefinidamente).
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error("whisper-cli timed out after 20s"));
      }, 20_000);

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`whisper-cli failed (code ${code})`));
          return;
        }
        const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        const text = lines.filter(
          (l) =>
            !l.startsWith("whisper_") &&
            !l.startsWith("system_info:") &&
            !l.startsWith("main: processing") &&
            !l.startsWith("ggml_") &&
            !l.includes("time =") &&
            !l.includes("fallbacks"),
        ).join(" ").trim();
        resolve(isHallucination(text) ? "" : text);
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
      });
    });
  }
}
