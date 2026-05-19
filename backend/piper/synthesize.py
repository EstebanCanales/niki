#!/usr/bin/env python3
"""Piper TTS synthesizer — reads JSON from stdin, writes base64 WAV to stdout."""

import base64
import io
import json
import os
import struct
import sys

# Path to piper virtual env and models
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")

VENV_SITE_PACKAGES = os.path.join(SCRIPT_DIR, "..", "venv-piper", "lib", "python3.14", "site-packages")
if os.path.isdir(VENV_SITE_PACKAGES):
    sys.path.insert(0, VENV_SITE_PACKAGES)

# Also try other python versions
for pyver in ["python3.13", "python3.12", "python3.11", "python3.10", "python3.9"]:
    sp = os.path.join(SCRIPT_DIR, "..", "venv-piper", "lib", pyver, "site-packages")
    if os.path.isdir(sp):
        sys.path.insert(0, sp)

try:
    from piper.voice import PiperVoice
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"piper-tts not installed: {e}"}), file=sys.stderr)
    sys.exit(1)

# Voice registry: id -> (model_path, config_path)
VOICE_REGISTRY = {
    "es_AR-daniela": (
        os.path.join(MODELS_DIR, "es_AR-daniela-high.onnx"),
        os.path.join(MODELS_DIR, "es_AR-daniela-high.onnx.json"),
    ),
    "es_ES-davefx": (
        os.path.join(MODELS_DIR, "es_ES-davefx-medium.onnx"),
        os.path.join(MODELS_DIR, "es_ES-davefx-medium.onnx.json"),
    ),
    "es_ES-mls_10246": (
        os.path.join(MODELS_DIR, "es_ES-mls_10246-low.onnx"),
        os.path.join(MODELS_DIR, "es_ES-mls_10246-low.onnx.json"),
    ),
    "es_ES-mls_9972": (
        os.path.join(MODELS_DIR, "es_ES-mls_9972-low.onnx"),
        os.path.join(MODELS_DIR, "es_ES-mls_9972-low.onnx.json"),
    ),
    "es_ES-sharvard": (
        os.path.join(MODELS_DIR, "es_ES-sharvard-medium.onnx"),
        os.path.join(MODELS_DIR, "es_ES-sharvard-medium.onnx.json"),
    ),
    "en_US-amy": (
        os.path.join(MODELS_DIR, "en_US-amy-medium.onnx"),
        os.path.join(MODELS_DIR, "en_US-amy-medium.onnx.json"),
    ),
    "en_GB-aru": (
        os.path.join(MODELS_DIR, "en_GB-aru-medium.onnx"),
        os.path.join(MODELS_DIR, "en_GB-aru-medium.onnx.json"),
    ),
    "en_GB-cori": (
        os.path.join(MODELS_DIR, "en_GB-cori-medium.onnx"),
        os.path.join(MODELS_DIR, "en_GB-cori-medium.onnx.json"),
    ),
    "en_GB-semaine": (
        os.path.join(MODELS_DIR, "en_GB-semaine-medium.onnx"),
        os.path.join(MODELS_DIR, "en_GB-semaine-medium.onnx.json"),
    ),
}

DEFAULT_VOICE = "es_AR-daniela"


def write_wav_header(f, num_channels, sample_rate, bits_per_sample, data_size):
    """Write a minimal RIFF WAV header."""
    f.write(b"RIFF")
    f.write(struct.pack("<I", 36 + data_size))
    f.write(b"WAVE")
    f.write(b"fmt ")
    f.write(struct.pack("<I", 16))  # Subchunk1Size
    f.write(struct.pack("<H", 1))   # AudioFormat (PCM)
    f.write(struct.pack("<H", num_channels))
    f.write(struct.pack("<I", sample_rate))
    f.write(struct.pack("<I", sample_rate * num_channels * bits_per_sample // 8))  # ByteRate
    f.write(struct.pack("<H", num_channels * bits_per_sample // 8))  # BlockAlign
    f.write(struct.pack("<H", bits_per_sample))
    f.write(b"data")
    f.write(struct.pack("<I", data_size))


def synthesize(text: str, model_path: str, config_path: str):
    voice = PiperVoice.load(model_path, config_path)
    chunks = list(voice.synthesize(text))

    if not chunks:
        return b""

    audio_bytes = b"".join(c.audio_int16_bytes for c in chunks)
    sample_rate = chunks[0].sample_rate
    sample_width = chunks[0].sample_width
    channels = chunks[0].sample_channels

    buf = io.BytesIO()
    write_wav_header(buf, channels, sample_rate, sample_width * 8, len(audio_bytes))
    buf.write(audio_bytes)
    return buf.getvalue()


def main():
    raw = sys.stdin.read()
    if not raw:
        print(json.dumps({"ok": False, "error": "No input"}))
        sys.exit(1)

    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    text = req.get("text", "").strip()
    if not text:
        print(json.dumps({"ok": False, "error": "No text provided"}))
        sys.exit(1)

    voice_id = req.get("voice", DEFAULT_VOICE)
    model_path, config_path = VOICE_REGISTRY.get(voice_id, VOICE_REGISTRY[DEFAULT_VOICE])

    if not os.path.isfile(model_path):
        print(json.dumps({"ok": False, "error": f"Model not found: {model_path}"}))
        sys.exit(1)

    try:
        wav_bytes = synthesize(text, model_path, config_path)
        b64 = base64.b64encode(wav_bytes).decode("ascii")
        print(json.dumps({"ok": True, "audio": b64, "format": "wav", "mime": "audio/wav", "voice": voice_id}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
