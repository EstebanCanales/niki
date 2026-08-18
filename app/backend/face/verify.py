#!/usr/bin/env python3
"""Huella de cara: worker persistente para saber si quien está frente a la cámara es Esteban.

Hermano de speaker/verify.py, a propósito: mismo protocolo (una petición JSON por línea en
stdin, una respuesta por línea en stdout), mismos nombres de operación, mismo formato de
perfil, y la misma regla de oro — **sin perfil registrado, acepta siempre**. Un worker
caído o una cámara tapada no pueden dejar a Niki sin funcionar.

Modelos, los dos de OpenCV Zoo y los mismos que usa Mugshot (el proyecto que sirvió de
referencia, MIT):

    YuNet   detecta dónde está la cara      227 KB
    SFace   la convierte en 128 números      37 MB

Vienen soportados dentro de opencv-python (`cv2.FaceDetectorYN`, `cv2.FaceRecognizerSF`),
así que no hace falta compilar OpenCV para Swift ni el módulo PAM ni el demonio de
Mugshot — eso es para desbloquear `sudo`, que no es lo que hacemos acá.

**Esto no es un control de seguridad.** Una webcam 2D se engaña con una foto en un
teléfono. Sirve para saber quién sos y personalizar; no para autorizar nada, y por eso
falla abierta. Si algún día alguien quiere usarlo para dejar gente afuera, hay que
rehacerlo con otra cosa (profundidad, infrarrojo, o directamente Touch ID).

Peticiones:
    {"op": "enroll", "userId": "...", "frames": ["<jpeg en base64>", ...]}
    {"op": "verify", "userId": "...", "frame": "<jpeg en base64>"}
    {"op": "status", "userId": "..."}
"""

import base64
import json
import os
import sys
from typing import Optional

BASE = os.path.dirname(os.path.abspath(__file__))
PERFILES = os.path.join(BASE, "profiles")
MODELOS = os.path.join(BASE, "modelo")
# Dónde quedan las tomas de un registro que falló, para poder mirarlas. Solo se escriben
# cuando falla: si el registro sale bien, no hay motivo para dejar fotos de nadie en
# disco. Ver .gitignore — esto no se versiona nunca.
DIAGNOSTICO = os.path.join(BASE, "diagnostico")

# Cuántas caras hacen falta para registrar. Menos de cuatro y el umbral sale de una sola
# pose: cualquier giro de cabeza después queda afuera.
MINIMO_TOMAS = 4

# Margen bajo el umbral aprendido, por el mismo motivo que en la voz: las tomas del
# registro son todas del mismo momento y la misma luz, así que su dispersión subestima la
# del uso real. Acá el margen es más grande porque la cara varía más que la voz —
# anteojos, barba, la luz de la ventana a las seis de la tarde.
MARGEN_UMBRAL = 0.12
# SFace trabaja con similitud coseno; su umbral sugerido para "misma persona" es 0.363.
# El suelo no baja de ahí: por debajo, empieza a decir que sí a cualquiera.
#
# El techo es 0.60 y no más alto por lo medido con fotos de verdad: la misma persona da
# 0.88 y otra distinta 0.15 — cuatro veces de diferencia. Un techo de 0.75 quedaba pegado
# al puntaje del dueño, y con la luz de una webcam a las siete de la tarde eso es rechazar
# a Esteban. Con 0.60 sigue habiendo distancia de sobra con un impostor.
UMBRAL_MIN, UMBRAL_MAX = 0.363, 0.60

# Confianza mínima para creerle a YuNet que eso es una cara. Por debajo suele ser un
# reflejo o un cuadro en la pared.
CONFIANZA_MINIMA = 0.85

_detector = None
_reconocedor = None


def detector(ancho: int, alto: int):
    global _detector
    if _detector is None:
        import cv2

        _detector = cv2.FaceDetectorYN.create(
            os.path.join(MODELOS, "yunet.onnx"), "", (ancho, alto),
            score_threshold=CONFIANZA_MINIMA,
        )
    # El tamaño se fija por cuadro: la cámara puede cambiar de resolución entre llamadas.
    _detector.setInputSize((ancho, alto))
    return _detector


def reconocedor():
    global _reconocedor
    if _reconocedor is None:
        import cv2

        _reconocedor = cv2.FaceRecognizerSF.create(os.path.join(MODELOS, "sface.onnx"), "")
    return _reconocedor


def descodificar(jpeg_b64: str):
    import cv2
    import numpy as np

    datos = np.frombuffer(base64.b64decode(jpeg_b64), dtype=np.uint8)
    imagen = cv2.imdecode(datos, cv2.IMREAD_COLOR)
    if imagen is None:
        raise ValueError("no se pudo leer la imagen")
    return imagen


def buscar_cara(imagen):
    """La cara más grande de la imagen, probando las cuatro orientaciones.

    YuNet solo encuentra caras derechas: una imagen rotada noventa grados no le dice nada.
    Y por dónde salga orientado un cuadro de la cámara depende del pipeline que lo generó
    —CoreImage, la orientación del sensor, cómo se codificó a JPEG—, cosa que no se puede
    dar por sentada desde acá.

    Probar cuatro rotaciones cuesta milisegundos con un modelo de 227 KB, y convierte "no
    encontré ninguna cara" en "no hay nadie", que es lo que uno quiere que signifique.

    Se queda con la orientación de MAYOR confianza, no con la primera que dé algo. Medido:
    con la cara girada noventa grados, YuNet igual "encuentra" una cara en la orientación
    equivocada, y el recorte que sale de ahí da un puntaje de 0.12 contra el 0.96 de la
    buena. Quedarse con la primera convertía una foto perfectamente válida en un rechazo.
    """
    import cv2

    rotaciones = [
        None,
        cv2.ROTATE_90_CLOCKWISE,
        cv2.ROTATE_180,
        cv2.ROTATE_90_COUNTERCLOCKWISE,
    ]
    mejor = (0.0, None, None)
    for giro in rotaciones:
        vista = imagen if giro is None else cv2.rotate(imagen, giro)
        alto, ancho = vista.shape[:2]
        _, caras = detector(ancho, alto).detect(vista)
        if caras is None or len(caras) == 0:
            continue
        # La última columna de cada detección es la confianza de YuNet.
        cara = max(caras, key=lambda c: float(c[-1]))
        confianza = float(cara[-1])
        if confianza > mejor[0]:
            mejor = (confianza, vista, cara)
    return mejor[1], mejor[2]


def embedding(jpeg_b64: str):
    """Los 128 números que representan la cara más grande del cuadro.

    Se queda con la más grande y no con la primera: si hay alguien de fondo, el que está
    usando la máquina es el que ocupa más pantalla.
    """
    import numpy as np

    imagen = descodificar(jpeg_b64)
    imagen, mayor = buscar_cara(imagen)
    if mayor is None:
        return None
    alineada = reconocedor().alignCrop(imagen, mayor)
    emb = reconocedor().feature(alineada)
    vector = np.asarray(emb).flatten().astype(np.float64)
    norma = np.linalg.norm(vector)
    if norma == 0:
        return None
    return vector / norma


def guardar_para_mirar(frames: list) -> str:
    """Deja en disco las tomas que no pasaron, para poder abrirlas y ver qué llegó.

    Sin esto, "no encontró caras" puede ser cualquier cosa —cuadros negros, la imagen
    dada vuelta, la cámara apuntando al techo— y desde el servidor no hay forma de
    distinguirlas. Con las fotos delante se ve en dos segundos.
    """
    try:
        os.makedirs(DIAGNOSTICO, exist_ok=True)
        # Se pisan las anteriores: interesa el último intento, no juntar fotos de alguien.
        for viejo in os.listdir(DIAGNOSTICO):
            if viejo.endswith(".jpg"):
                os.remove(os.path.join(DIAGNOSTICO, viejo))
        for i, f in enumerate(frames):
            with open(os.path.join(DIAGNOSTICO, f"toma-{i + 1}.jpg"), "wb") as fh:
                fh.write(base64.b64decode(f))
        return DIAGNOSTICO
    except Exception as error:
        return f"(no se pudieron guardar: {error})"


def ruta_perfil(user_id: str) -> str:
    seguro = "".join(c for c in user_id if c.isalnum() or c in "-_") or "anon"
    return os.path.join(PERFILES, f"{seguro}.json")


def cargar_perfil(user_id: str) -> Optional[dict]:
    try:
        with open(ruta_perfil(user_id)) as fh:
            return json.load(fh)
    except Exception:
        return None


def enroll(user_id: str, frames: list) -> dict:
    import numpy as np

    if len(frames) < MINIMO_TOMAS:
        return {"ok": False, "error": f"Hacen falta al menos {MINIMO_TOMAS} tomas para registrar la cara."}

    embs = [e for e in (embedding(f) for f in frames) if e is not None]
    if len(embs) < MINIMO_TOMAS:
        # El tamaño de las imágenes va en el mensaje a propósito: distingue "la cámara
        # mandó cuadros negros o vacíos" de "mandó fotos buenas pero no había cara".
        pesos = ", ".join(str(len(f) * 3 // 4) for f in frames)
        guardadas = guardar_para_mirar(frames)
        return {
            "ok": False,
            "error": (
                f"Se vio una cara en {len(embs)} de {len(frames)} tomas. "
                f"Probá con más luz y de frente."
            ),
            "carasPorToma": len(embs),
            "bytesPorToma": pesos,
            "guardadasEn": guardadas,
        }

    centro = np.mean(embs, axis=0)
    centro = centro / np.linalg.norm(centro)

    # Igual que en la voz: la toma que MENOS se parece al centro marca cuánto varía tu
    # propia cara entre poses. Una constante inventada sería estricta con unos y laxa
    # con otros.
    # El umbral se calcula con la MISMA métrica que después usa la verificación: cuánto
    # se parece una toma a la que mejor le calce de las otras. Antes se medía contra el
    # promedio y se verificaba contra el máximo, dos escalas distintas, y el umbral
    # quedaba más laxo de lo que decía.
    #
    # Dejar una afuera y compararla con el resto es justo lo que va a pasar en el uso
    # real: una foto nueva contra las guardadas.
    similitudes = []
    for i, e in enumerate(embs):
        otras = [o for j, o in enumerate(embs) if j != i]
        similitudes.append(max(float(np.dot(e, o)) for o in otras))
    peor = min(similitudes)
    umbral = max(UMBRAL_MIN, min(UMBRAL_MAX, peor - MARGEN_UMBRAL))

    os.makedirs(PERFILES, exist_ok=True)
    perfil = {
        "userId": user_id,
        "centroid": centro.tolist(),
        # Todas las tomas, no solo su promedio. Es lo que hace FaceUnlock (guarda hasta
        # treinta y cinco) y tiene un motivo: el promedio de "de frente", "de perfil" y
        # "mirando abajo" es una cara que no existe, y se parece poco a las tres. Al
        # verificar se compara contra la que MÁS se parezca, así cada pose se defiende
        # sola. El centro se conserva igual, como respaldo y para poder comparar.
        "vistas": [e.tolist() for e in embs],
        "threshold": umbral,
        "samples": len(embs),
        "selfSimilarity": {"min": peor, "mean": sum(similitudes) / len(similitudes)},
    }
    with open(ruta_perfil(user_id), "w") as fh:
        json.dump(perfil, fh)
    return {"ok": True, "enrolled": True, "threshold": umbral, "samples": len(embs),
            "selfSimilarity": perfil["selfSimilarity"]}


def verify(user_id: str, frame_b64: str) -> dict:
    import numpy as np

    perfil = cargar_perfil(user_id)
    # Sin perfil se acepta SIEMPRE, igual que en la voz. Es la regla más importante de
    # acá: esto sirve para saber quién sos, no para dejar a nadie afuera.
    if not perfil:
        return {"ok": True, "enrolled": False, "match": True, "score": None, "faceFound": None}

    emb = embedding(frame_b64)
    if emb is None:
        # Cámara tapada, de espaldas, a oscuras. No es "no sos vos": es "no vi a nadie".
        return {"ok": True, "enrolled": True, "match": True, "score": None, "faceFound": False}

    # Contra la vista que más se parezca, no contra el promedio. Los perfiles viejos no
    # tienen "vistas", así que se cae al centro y siguen funcionando.
    vistas = perfil.get("vistas")
    if vistas:
        score = max(float(np.dot(emb, np.array(v))) for v in vistas)
    else:
        score = float(np.dot(emb, np.array(perfil["centroid"])))
    return {
        "ok": True,
        "enrolled": True,
        "faceFound": True,
        "match": score >= perfil["threshold"],
        "score": score,
        "threshold": perfil["threshold"],
    }


def manejar(pedido: dict) -> dict:
    op = pedido.get("op")
    user_id = str(pedido.get("userId") or "anon")
    if op == "enroll":
        return enroll(user_id, pedido.get("frames") or [])
    if op == "verify":
        return verify(user_id, pedido.get("frame") or "")
    if op == "status":
        perfil = cargar_perfil(user_id)
        return {"ok": True, "enrolled": bool(perfil),
                "threshold": perfil.get("threshold") if perfil else None,
                "samples": perfil.get("samples") if perfil else 0}
    if op == "forget":
        try:
            os.remove(ruta_perfil(user_id))
        except FileNotFoundError:
            pass
        return {"ok": True, "enrolled": False, "samples": 0}
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
