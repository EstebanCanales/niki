#!/bin/bash
# Criterio de selección de micrófono, contra los dispositivos reales de esta máquina.
#   ./app/Niki/Tests/microfono/correr.sh
set -e
cd "$(dirname "$0")"
swiftc -O -o /tmp/niki-micsel main.swift
/tmp/niki-micsel
