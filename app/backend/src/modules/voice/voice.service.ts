import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

type SttResult = { ok: boolean; text: string; language: string; duration: number; provider?: string };
type TtsResult = { ok: boolean; audio?: string; format?: string; mime?: string; error?: string; duration: number };

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly modelPath: string;
  private readonly whisperCli: string;

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

  /** STT habilitado si hay Groq API key o whisper local. */
  isEnabled() {
    return Boolean(this.groqApiKey()) || Boolean(this.modelPath);
  }

  /** TTS habilitado si existe el script piper + venv. */
  isTtsEnabled() {
    const scriptPath = path.join(process.cwd(), "piper", "synthesize.py");
    const venvPython = path.join(process.cwd(), "venv-piper", "bin", "python3");
    return fs.existsSync(scriptPath) && fs.existsSync(venvPython);
  }

  /** Transcripción: usa Groq Whisper si hay API key, si no cae a whisper-cli local. */
  async transcribe(audioBuffer: Buffer, language?: string, prompt?: string): Promise<SttResult> {
    const startedAt = performance.now();
    const lang = (language ?? "es").trim() || "es";

    // Primario: Groq Whisper API (rápido + preciso)
    const key = this.groqApiKey();
    if (key) {
      try {
        const result = await this.transcribeWithGroq(audioBuffer, lang, key);
        const durationMs = Math.round(performance.now() - startedAt);
        this.logger.log(`[voice] groq-stt ${durationMs}ms lang=${lang} chars=${result.length}`);
        return { ok: true, text: result, language: lang, duration: durationMs, provider: "groq" };
      } catch (err) {
        this.logger.warn(`[voice] groq-stt failed, falling back to local: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Fallback: whisper-cli local
    if (!this.modelPath) {
      throw new Error("STT not configured: no Groq API key and no local whisper model.");
    }
    const format = detectAudioFormat(audioBuffer);
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `niki-stt-${Date.now()}.${format.ext}`);
    fs.writeFileSync(tmpFile, audioBuffer);
    try {
      const text = await this.runWhisper(tmpFile, lang, prompt);
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.log(`[voice] whisper-local ${durationMs}ms lang=${lang} chars=${text.length}`);
      return { ok: true, text, language: lang, duration: durationMs, provider: "whisper-local" };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  async synthesize(text: string, language?: string, voice?: string): Promise<TtsResult> {
    const startedAt = performance.now();
    const scriptPath = path.join(process.cwd(), "piper", "synthesize.py");
    const venvPython = path.join(process.cwd(), "venv-piper", "bin", "python3");

    if (!fs.existsSync(scriptPath)) throw new Error("Piper synthesizer script not found");
    if (!fs.existsSync(venvPython)) throw new Error("Piper virtual environment not found");

    return new Promise((resolve, reject) => {
      const proc = spawn(venvPython, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        const durationMs = Math.round(performance.now() - startedAt);
        if (code !== 0) {
          this.logger.error(`[piper] exited ${code}: ${stderr}`);
          reject(new Error(`Piper TTS failed (code ${code}): ${stderr.slice(0, 200)}`));
          return;
        }
        try {
          const result = JSON.parse(stdout) as TtsResult;
          this.logger.log(`[voice] piper ${durationMs}ms chars=${text.length} audio=${result.audio?.length ?? 0}`);
          resolve({ ...result, duration: durationMs });
        } catch {
          reject(new Error(`Invalid JSON from piper: ${stdout.slice(0, 100)}`));
        }
      });

      proc.on("error", (err) => reject(new Error(`Failed to spawn piper: ${err.message}`)));

      proc.stdin.write(JSON.stringify({ text, language, voice }));
      proc.stdin.end();
    });
  }

  // ---------------------------------------------------------------------------

  private groqApiKey(): string {
    return String(process.env.GROQ_API_KEY ?? "").trim();
  }

  private async transcribeWithGroq(audioBuffer: Buffer, lang: string, apiKey: string): Promise<string> {
    const format = detectAudioFormat(audioBuffer);

    // Node 25: FormData global available
    const formData = new FormData();
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: format.mime });
    formData.append("file", blob, `audio.${format.ext}`);
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("language", lang);
    formData.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => String(res.status));
      throw new Error(`Groq STT ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  }

  private runWhisper(audioPath: string, language: string, prompt?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["-m", this.modelPath, "-f", audioPath, "-l", language, "--no-timestamps", "-np"];
      if (prompt) args.push("--prompt", prompt);

      const proc = spawn(this.whisperCli, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`whisper.cpp failed (code ${code})`));
          return;
        }
        const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        const resultLines = lines.filter(
          (l) =>
            !l.startsWith("whisper_") &&
            !l.startsWith("system_info:") &&
            !l.startsWith("main: processing") &&
            !l.startsWith("ggml_") &&
            !l.includes("time =") &&
            !l.includes("fallbacks"),
        );
        resolve(resultLines.join(" ").trim());
      });

      proc.on("error", (err) => reject(new Error(`Failed to spawn whisper-cli: ${err.message}`)));
    });
  }
}
