#!/bin/bash
# Baja los dos modelos que necesita la huella de cara.
#
# No se versionan: SFace pesa 37 MB y no tiene sentido en un repo de código. Son los
# mismos que usa Mugshot (el proyecto que sirvió de referencia), los dos de OpenCV Zoo y
# con licencia Apache 2.0.
#
#   YuNet   encuentra dónde está la cara       227 KB
#   SFace   la convierte en 128 números         37 MB
#
# Uso:  bash app/backend/face/bajar-modelos.sh
set -euo pipefail

DESTINO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/modelo"
ZOO="https://github.com/opencv/opencv_zoo/raw/main/models"

mkdir -p "$DESTINO"

bajar() {
  local url="$1" archivo="$2"
  if [ -s "$DESTINO/$archivo" ]; then
    echo "  $archivo ya está"
    return
  fi
  echo "  bajando $archivo…"
  curl -sL --fail -o "$DESTINO/$archivo" "$url"
}

echo "Modelos de la huella de cara:"
bajar "$ZOO/face_detection_yunet/face_detection_yunet_2023mar.onnx" yunet.onnx
bajar "$ZOO/face_recognition_sface/face_recognition_sface_2021dec.onnx" sface.onnx

echo
echo "Falta opencv en el venv (si no está):"
echo "  app/backend/venv-qwen3-tts/bin/python3 -m pip install opencv-python-headless"
echo
echo "Para probar que anda:"
echo "  app/backend/venv-qwen3-tts/bin/python3 app/backend/face/probar.py"
