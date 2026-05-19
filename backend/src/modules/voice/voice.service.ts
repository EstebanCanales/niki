import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function detectAudioFormat(buffer: Buffer): { ext: string; mime: string } {
  if (buffer.length < 12) return { ext: "webm", mime: "audio/webm" };

  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff === "RIFF" && wave === "WAVE") {
    return { ext: "wav", mime: "audio/wav" };
  }

  // WebM / Matroska EBML header
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { ext: "webm", mime: "audio/webm" };
  }

  // MP3 with ID3 tag
  if (riff === "ID3") {
    return { ext: "mp3", mime: "audio/mpeg" };
  }

  // MP3 without ID3
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { ext: "mp3", mime: "audio/mpeg" };
  }

  // M4A / MP4 (ftyp or moov)
  const ftyp = buffer.toString("ascii", 4, 8);
  if (ftyp === "ftyp" || ftyp === "moov") {
    return { ext: "m4a", mime: "audio/m4a" };
  }

  return { ext: "webm", mime: "audio/webm" };
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly modelPath: string;
  private readonly whisperCli: string;

  constructor() {
    // Look for whisper-cli in PATH or common locations
    const candidates = [
      "whisper-cli",
      "/opt/homebrew/bin/whisper-cli",
      "/usr/local/bin/whisper-cli",
    ];
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

    // Look for model in project whisper dir or common locations
    const modelDir = path.join(process.cwd(), "whisper", "models");
    const modelCandidates = [
      path.join(modelDir, "ggml-base.bin"),
      path.join(modelDir, "ggml-tiny.bin"),
      "/opt/homebrew/share/whisper-cpp/ggml-base.bin",
      "/opt/homebrew/share/whisper-cpp/ggml-tiny.bin",
    ];
    this.modelPath = modelCandidates.find((p) => fs.existsSync(p)) ?? "";
  }

  isEnabled() {
    return Boolean(this.modelPath);
  }

  isTtsEnabled() {
    const scriptPath = path.join(process.cwd(), "piper", "synthesize.py");
    const venvPython = path.join(process.cwd(), "venv-piper", "bin", "python3");
    return fs.existsSync(scriptPath) && fs.existsSync(venvPython);
  }

  async transcribe(
    audioBuffer: Buffer,
    language?: string,
    prompt?: string,
  ): Promise<{ ok: boolean; text: string; language: string; duration: number }> {
    if (!this.modelPath) {
      throw new Error("whisper.cpp model not found. Download a GGML model to backend/whisper/models/");
    }

    const startedAt = performance.now();
    const lang = (language ?? "es").trim() || "es";

    // Save audio to temp file
    const format = detectAudioFormat(audioBuffer);
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `niki-stt-${Date.now()}.${format.ext}`);
    fs.writeFileSync(tmpFile, audioBuffer);

    try {
      const text = await this.runWhisper(tmpFile, lang, prompt);
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger.log(`[voice] transcribed ${durationMs}ms lang=${lang} chars=${text.length}`);
      return { ok: true, text, language: lang, duration: durationMs };
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private runWhisper(audioPath: string, language: string, prompt?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-m", this.modelPath,
        "-f", audioPath,
        "-l", language,
        "--no-timestamps",
        "-np", // no prints except result
      ];
      if (prompt) {
        args.push("--prompt", prompt);
      }

      this.logger.log(`[whisper] spawning: ${this.whisperCli} ${args.join(" ")}`);
      const proc = spawn(this.whisperCli, args, { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          this.logger.error(`[whisper] exited ${code}: ${stderr}`);
          reject(new Error(`whisper.cpp failed (code ${code})`));
          return;
        }

        // Extract transcription from stdout
        // whisper-cli prints the result as plain text lines after the processing header
        const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
        // Skip header lines that contain technical info
        const resultLines = lines.filter(
          (l) =>
            !l.startsWith("whisper_") &&
            !l.startsWith("system_info:") &&
            !l.startsWith("main: processing") &&
            !l.startsWith("ggml_") &&
            !l.includes("time =") &&
            !l.includes("fallbacks"),
        );
        const text = resultLines.join(" ").trim();
        resolve(text);
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
      });
    });
  }

  async synthesize(
    text: string,
    language?: string,
    voice?: string,
  ): Promise<{ ok: boolean; audio?: string; format?: string; mime?: string; error?: string; duration: number }> {
    const startedAt = performance.now();
    const scriptPath = path.join(process.cwd(), "piper", "synthesize.py");
    const venvPython = path.join(process.cwd(), "venv-piper", "bin", "python3");

    if (!fs.existsSync(scriptPath)) {
      throw new Error("Piper synthesizer script not found");
    }
    if (!fs.existsSync(venvPython)) {
      throw new Error("Piper virtual environment not found");
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(venvPython, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const durationMs = Math.round(performance.now() - startedAt);
        if (code !== 0) {
          this.logger.error(`[piper] exited ${code}: ${stderr}`);
          reject(new Error(`Piper TTS failed (code ${code})`));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          this.logger.log(`[voice] synthesized ${durationMs}ms chars=${text.length} audio=${result.audio?.length ?? 0}`);
          resolve({ ...result, duration: durationMs });
        } catch {
          reject(new Error("Invalid JSON from piper synthesizer"));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn piper: ${err.message}`));
      });

      proc.stdin.write(JSON.stringify({ text, language, voice }));
      proc.stdin.end();
    });
  }
}
