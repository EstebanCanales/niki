#!/usr/bin/env python3
"""Huella de voz: worker persistente para saber si quien habló es Esteban.

Mismo patrón que qwen3-tts/synthesize.py — una petición JSON por línea en stdin, una
respuesta por línea en stdout — porque el modelo tarda en cargar y no se puede pagar eso
en cada turno.

Corre en PARALELO con la transcripción, no antes: la app ya sube el audio una vez y Groq
tarda ~1.1 s, así que verificar quién habló sale gratis en tiempo de reloj.

Modelo: ECAPA-TDNN de SpeechBrain (spkrec-ecapa-voxceleb), el estándar para verificación
de locutor. Decenas de ms por clip en CPU.

Peticiones:
    {"op": "enroll", "userId": "...", "samples": ["<wav en base64>", ...]}
    {"op": "verify", "userId": "...", "audio": "<wav en base64>"}
    {"op": "status", "userId": "..."}
"""

import base64
import io
import json
import os
import sys
from typing import Any, Optional

PERFILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles")

# Margen bajo el umbral aprendido. Las tomas del registro son todas en las mismas
# condiciones (misma sala, mismo micrófono, mismo momento), así que su dispersión
# subestima la del uso real: sin margen, hablar más lejos o más cansado te deja afuera.
MARGEN_UMBRAL = 0.08
# Suelo y techo del umbral. Por debajo del suelo verifica cualquier cosa; por encima del
# techo no pasa ni el dueño.
UMBRAL_MIN, UMBRAL_MAX = 0.25, 0.65

_modelo = None


def modelo():
    global _modelo
    if _modelo is None:
        from speechbrain.inference.speaker import EncoderClassifier

        _modelo = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=os.path.join(os.path.dirname(os.path.abspath(__file__)), "modelo"),
            run_opts={"device": "cpu"},
        )
    return _modelo


def embedding(wav_b64: str):
    import numpy as np
    import torch
    import torchaudio
    import wave

    # Se lee con el módulo `wave` en vez de torchaudio.load: desde torchaudio 2.11 esa
    # función exige TorchCodec, una dependencia pesada más. El WAV lo genera nuestra
    # propia captura (PCM16 mono 16 kHz), así que el formato está bajo control.
    datos = base64.b64decode(wav_b64)
    with wave.open(io.BytesIO(datos)) as w:
        canales, ancho, sr = w.getnchannels(), w.getsampwidth(), w.getframerate()
        crudo = w.readframes(w.getnframes())
    if ancho != 2:
        raise ValueError(f"se esperaba PCM de 16 bits, llegó de {ancho * 8}")

    muestras = np.frombuffer(crudo, dtype="<i2").astype(np.float32) / 32768.0
    if canales > 1:
        muestras = muestras.reshape(-1, canales).mean(axis=1)

    señal = torch.from_numpy(muestras.copy()).unsqueeze(0)
    if sr != 16_000:
        señal = torchaudio.functional.resample(señal, sr, 16_000)
    with torch.no_grad():
        emb = modelo().encode_batch(señal).squeeze()
    return emb / emb.norm()


def ruta_perfil(user_id: str) -> str:
    seguro = "".join(c for c in user_id if c.isalnum() or c in "-_") or "anon"
    return os.path.join(PERFILES, f"{seguro}.json")


def cargar_perfil(user_id: str) -> Optional[dict]:
    try:
        with open(ruta_perfil(user_id)) as fh:
            return json.load(fh)
    except Exception:
        return None


def enroll(user_id: str, samples: list) -> dict:
    import torch

    if len(samples) < 3:
        return {"ok": False, "error": "Hacen falta al menos 3 tomas para registrar la voz."}

    embs = [embedding(s) for s in samples]
    centro = torch.stack(embs).mean(dim=0)
    centro = centro / centro.norm()

    # Umbral personalizado: la toma que MENOS se parece al centro marca cuánto varía tu
    # propia voz entre repeticiones. Una constante inventada sería más estricta con unos
    # y más laxa con otros.
    similitudes = [float(torch.dot(e, centro)) for e in embs]
    peor = min(similitudes)
    umbral = max(UMBRAL_MIN, min(UMBRAL_MAX, peor - MARGEN_UMBRAL))

    os.makedirs(PERFILES, exist_ok=True)
    perfil = {
        "userId": user_id,
        "centroid": centro.tolist(),
        "threshold": umbral,
        "samples": len(samples),
        "selfSimilarity": {"min": peor, "mean": sum(similitudes) / len(similitudes)},
    }
    with open(ruta_perfil(user_id), "w") as fh:
        json.dump(perfil, fh)
    return {"ok": True, "enrolled": True, "threshold": umbral, "samples": len(samples),
            "selfSimilarity": perfil["selfSimilarity"]}


def verify(user_id: str, audio_b64: str) -> dict:
    import torch

    perfil = cargar_perfil(user_id)
    # Sin perfil se acepta SIEMPRE. Es la regla más importante de acá: si esto fallara
    # cerrado, un worker caído o un usuario sin registrar dejaría a Niki sorda.
    if not perfil:
        return {"ok": True, "enrolled": False, "match": True, "score": None}

    centro = torch.tensor(perfil["centroid"])
    score = float(torch.dot(embedding(audio_b64), centro))
    return {
        "ok": True,
        "enrolled": True,
        "match": score >= perfil["threshold"],
        "score": score,
        "threshold": perfil["threshold"],
    }


def manejar(pedido: dict) -> dict:
    op = pedido.get("op")
    user_id = str(pedido.get("userId") or "anon")
    if op == "enroll":
        return enroll(user_id, pedido.get("samples") or [])
    if op == "verify":
        return verify(user_id, pedido.get("audio") or "")
    if op == "status":
        perfil = cargar_perfil(user_id)
        return {"ok": True, "enrolled": bool(perfil),
                "threshold": perfil.get("threshold") if perfil else None,
                "samples": perfil.get("samples") if perfil else 0}
    return {"ok": False, "error": f"operación desconocida: {op}"}


def main() -> int:
    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            respuesta = manejar(json.loads(linea))
        except Exception as error:  # nunca morir por una petición mala
            respuesta = {"ok": False, "error": str(error)}
        sys.stdout.write(json.dumps(respuesta) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
