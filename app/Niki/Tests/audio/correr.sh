#!/bin/bash
# Banco de audio de la captura. Señales con propiedades conocidas en vez de pruebas a
# oído — que es como no probar.
#
#   ./app/Niki/Tests/audio/correr.sh
set -e
cd "$(dirname "$0")"
C=../../Sources/Desktop/Core
swiftc -O -o /tmp/niki-banco-audio senales.swift main.swift "$C/NikiBiquad.swift" "$C/NikiVoiceCapture.swift"
/tmp/niki-banco-audio
