#!/usr/bin/env python3
"""Persistent Qwen3-TTS worker.

Reads one JSON request per line from stdin and writes one JSON response per
line to stdout. The model is loaded once so voice turns do not pay the model
startup cost repeatedly.
"""

import base64
import contextlib
import io
import json
import os
import sys
from typing import Any


MODEL_ID = os.environ.get(
    "QWEN3_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
)
DEFAULT_SPEAKER = os.environ.get("QWEN3_TTS_SPEAKER", "Serena")
DEFAULT_INSTRUCT = os.environ.get(
    "QWEN3_TTS_INSTRUCT",
    "Habla en español latino con un tono cálido, natural, claro y conversacional. "
    "Mantén un ritmo sereno, como una asistente personal atenta.",
)


def choose_device(torch: Any) -> str:
    configured = os.environ.get("QWEN3_TTS_DEVICE", "auto").strip().lower()
    if configured != "auto":
        return configured
    if torch.cuda.is_available():
        return "cuda:0"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def language_name(language: str | None) -> str:
    normalized = (language or "Spanish").strip().lower()
    if normalized.startswith(("es", "spa", "spanish", "español")):
        return "Spanish"
    if normalized.startswith(("en", "eng", "english")):
        return "English"
    if normalized.startswith(("pt", "por", "portuguese", "português")):
        return "Portuguese"
    return "Auto"


def speaker_name(voice: str | None) -> str:
    # Keep old Niki voice IDs working while moving the actual synthesis to
    # Qwen's built-in voices.
    aliases = {
        "es_AR-daniela": "Serena",
        "es_ES-davefx": "Serena",
        "es_ES-sharvard": "Serena",
    }
    requested = (voice or "").strip()
    return aliases.get(requested, requested or DEFAULT_SPEAKER)


def make_wav_bytes(wav: Any, sample_rate: int, soundfile: Any) -> bytes:
    output = io.BytesIO()
    soundfile.write(output, wav, sample_rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


def main() -> None:
    protocol_stdout = sys.stdout
    try:
        # Some Qwen dependencies print banners to stdout during import. Keep
        # stdout reserved for the line-delimited JSON worker protocol.
        with contextlib.redirect_stdout(sys.stderr):
            import soundfile as sf
            import torch
            from qwen_tts import Qwen3TTSModel
    except Exception as exc:
        print(
            json.dumps({"ok": False, "error": f"Qwen3-TTS no está instalado: {exc}"}),
            file=protocol_stdout,
            flush=True,
        )
        sys.exit(1)

    device = choose_device(torch)
    # float16 generation can produce NaNs in PyTorch MPS sampling. CUDA uses
    # float16; CPU and Apple Silicon use the stable float32 path.
    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    print(f"[qwen3-tts] loading {MODEL_ID} on {device}", file=sys.stderr, flush=True)
    with contextlib.redirect_stdout(sys.stderr):
        model = Qwen3TTSModel.from_pretrained(
            MODEL_ID,
            device_map=device,
            dtype=dtype,
        )
    print("[qwen3-tts] ready", file=sys.stderr, flush=True)

    for line in sys.stdin:
        try:
            request = json.loads(line)
            text = str(request.get("text", "")).strip()
            if not text:
                raise ValueError("No text provided")

            instruct = str(request.get("instruct") or DEFAULT_INSTRUCT).strip()
            with contextlib.redirect_stdout(sys.stderr):
                wavs, sample_rate = model.generate_custom_voice(
                    text=text,
                    language=language_name(request.get("language")),
                    speaker=speaker_name(request.get("voice")),
                    instruct=instruct,
                )
            audio = make_wav_bytes(wavs[0], sample_rate, sf)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "audio": base64.b64encode(audio).decode("ascii"),
                        "format": "wav",
                        "mime": "audio/wav",
                        "voice": speaker_name(request.get("voice")),
                        "provider": "qwen3-tts",
                    }
                ),
                file=protocol_stdout,
                flush=True,
            )
        except Exception as exc:
            print(
                json.dumps({"ok": False, "error": str(exc)}),
                file=protocol_stdout,
                flush=True,
            )


if __name__ == "__main__":
    main()
