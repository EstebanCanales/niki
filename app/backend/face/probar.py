#!/usr/bin/env python3
"""Prueba la huella de cara con fotos de verdad.

No es un test de `npm test`: necesita el venv con opencv, los dos modelos ONNX y fotos de
dos personas distintas, así que se corre a mano cuando se toca verify.py.

Las fotos salen del repo de `face_recognition` (obama/biden), que las publica justo para
esto. Se bajan a /tmp y no se versionan.

Uso:
    venv-qwen3-tts/bin/python3 face/probar.py
"""

import base64
import json
import os
import subprocess
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(BASE)
FOTOS = "/tmp/caras-niki"
FUENTE = "https://raw.githubusercontent.com/ageitgey/face_recognition/master"

# Cuatro de una persona para registrar, una quinta suya para verificar, y una de otra
# persona para comprobar que no da falso positivo.
ARCHIVOS = {
    "a1.jpg": f"{FUENTE}/examples/obama.jpg",
    "a2.jpg": f"{FUENTE}/examples/obama2.jpg",
    "a3.jpg": f"{FUENTE}/tests/test_images/obama3.jpg",
    "a4.jpg": f"{FUENTE}/tests/test_images/obama.jpg",
    "a5.jpg": f"{FUENTE}/tests/test_images/obama2.jpg",
    "b1.jpg": f"{FUENTE}/examples/biden.jpg",
    "dos.jpg": f"{FUENTE}/examples/two_people.jpg",
}


def bajar():
    os.makedirs(FOTOS, exist_ok=True)
    for nombre, url in ARCHIVOS.items():
        destino = os.path.join(FOTOS, nombre)
        if os.path.exists(destino):
            continue
        try:
            urllib.request.urlretrieve(url, destino)
        except Exception as error:
            print(f"no se pudo bajar {nombre}: {error}", file=sys.stderr)
            return False
    return True


def b64(nombre):
    with open(os.path.join(FOTOS, nombre), "rb") as fh:
        return base64.b64encode(fh.read()).decode()


def main():
    if not bajar():
        return 1

    # Una imagen gris sin ninguna cara, para el caso de la cámara tapada.
    import cv2
    import numpy as np

    cv2.imwrite(os.path.join(FOTOS, "nada.jpg"), np.full((480, 640, 3), 40, np.uint8))

    worker = subprocess.Popen(
        [sys.executable, os.path.join(BASE, "verify.py")],
        cwd=BACKEND, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True,
    )

    def pedir(peticion):
        worker.stdin.write(json.dumps(peticion) + "\n")
        worker.stdin.flush()
        return json.loads(worker.stdout.readline())

    usuario = "prueba-cara"
    fallas = []

    def revisar(titulo, condicion, detalle):
        estado = "ok  " if condicion else "FALLA"
        print(f"  [{estado}] {titulo}: {detalle}")
        if not condicion:
            fallas.append(titulo)

    print("Huella de cara")

    r = pedir({"op": "verify", "userId": usuario, "frame": b64("a1.jpg")})
    revisar("sin registrar acepta igual", r.get("match") is True and r.get("enrolled") is False, r)

    r = pedir({"op": "enroll", "userId": usuario,
               "frames": [b64(f"a{i}.jpg") for i in (1, 2, 3, 4)]})
    revisar("registra con cuatro tomas", r.get("ok") is True, f"umbral {r.get('threshold')}")

    r = pedir({"op": "verify", "userId": usuario, "frame": b64("a5.jpg")})
    revisar("reconoce a la misma persona", r.get("match") is True, f"puntaje {r.get('score'):.3f}")
    propio = r.get("score") or 0

    r = pedir({"op": "verify", "userId": usuario, "frame": b64("b1.jpg")})
    revisar("rechaza a otra persona", r.get("match") is False, f"puntaje {r.get('score'):.3f}")
    ajeno = r.get("score") or 0

    revisar("hay margen entre las dos", propio > ajeno * 2, f"{propio:.3f} contra {ajeno:.3f}")

    r = pedir({"op": "verify", "userId": usuario, "frame": b64("nada.jpg")})
    revisar("cámara tapada no es 'no sos vos'",
            r.get("match") is True and r.get("faceFound") is False, r)

    r = pedir({"op": "verify", "userId": usuario, "frame": "no-es-una-imagen"})
    revisar("una imagen rota no tumba el worker", r.get("ok") is False, r.get("error", "")[:60])

    r = pedir({"op": "status", "userId": usuario})
    revisar("el estado dice que está registrado", r.get("enrolled") is True, r)

    r = pedir({"op": "forget", "userId": usuario})
    revisar("olvidar borra el perfil", r.get("enrolled") is False, r)

    worker.stdin.close()
    print(f"\n{len(ARCHIVOS)} fotos, {len(fallas)} fallas")
    return 1 if fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
