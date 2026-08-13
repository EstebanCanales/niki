#!/bin/bash
# Lógica de armado de turnos: órdenes de parar, retomar, unir fragmentos y pulido.
#   ./app/Niki/Tests/turnos/correr.sh
set -e
cd "$(dirname "$0")"
swiftc -O -o /tmp/niki-turnos main.swift ../../Sources/Desktop/Core/NikiTurnAssembler.swift
/tmp/niki-turnos
