#!/usr/bin/env python3
"""Arranca el inicio de sesión de un proveedor y devuelve la URL y el código.

Existe para que Niki no tenga que mandarte a una Terminal. Los flujos de suscripción son
de código de dispositivo: el runtime imprime una URL y un código, y después se queda
esperando a que apruebes en el navegador. Este puente captura esas dos cosas apenas
aparecen, las devuelve como JSON, y deja el proceso vivo esperando la aprobación.

Vive en app/backend/scripts y no dentro del fork a propósito: es un consumidor, no una
modificación (ver app/agent-runtime/UPSTREAM.md).

Uso:
    login-proveedor.py <proveedor>          # arranca y devuelve {url, code}
    login-proveedor.py <proveedor> --estado # solo consulta si ya está logueado
"""

import json
import os
import re
import subprocess
import sys
import threading
import time

RUNTIME = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "agent-runtime",
)
PYTHON = os.path.join(RUNTIME, "venv", "bin", "python")
HOME = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent-home"
)

# Cuánto se espera a que el runtime imprima la URL y el código antes de rendirse.
ESPERA_DATOS = 45

ANSI = re.compile(r"\033\[[0-9;]*m")
URL = re.compile(r"https?://[^\s]+")
# El código de dispositivo: bloque corto en mayúsculas, con o sin guion.
CODIGO = re.compile(r"\b([A-Z0-9]{4,6}-?[A-Z0-9]{4,6})\b")


def estado(proveedor: str) -> dict:
    out = subprocess.run(
        [PYTHON, "-m", "hermes_cli.main", "auth", "status", proveedor],
        cwd=RUNTIME,
        env={**os.environ, "HERMES_HOME": HOME},
        capture_output=True,
        text=True,
        timeout=60,
    )
    texto = ANSI.sub("", out.stdout + out.stderr).strip()
    return {"ok": True, "loggedIn": "logged in" in texto.lower(), "detail": texto[:300]}


def login(proveedor: str) -> dict:
    proc = subprocess.Popen(
        # --type oauth es obligatorio: sin él, `auth add` asume clave de API y sale sin
        # imprimir nada. -u desactiva el buffer, si no la URL no aparece hasta el final.
        [PYTHON, "-u", "-m", "hermes_cli.main", "auth", "add", proveedor,
         "--type", "oauth", "--no-browser"],
        cwd=RUNTIME,
        env={**os.environ, "HERMES_HOME": HOME, "TERM": "dumb"},
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    hallado = {"url": None, "code": None}
    lineas = []

    def leer():
        for linea in proc.stdout:
            limpia = ANSI.sub("", linea).strip()
            lineas.append(limpia)
            if not hallado["url"]:
                m = URL.search(limpia)
                # La URL de ayuda de la doc no sirve; la buena aparece sola en su línea.
                if m and "docs" not in m.group(0):
                    hallado["url"] = m.group(0)
            if not hallado["code"]:
                # El código va solo en su línea, sin otras palabras alrededor.
                if len(limpia) <= 20:
                    m = CODIGO.search(limpia)
                    if m:
                        hallado["code"] = m.group(1)

    hilo = threading.Thread(target=leer, daemon=True)
    hilo.start()

    inicio = time.monotonic()
    while time.monotonic() - inicio < ESPERA_DATOS:
        if hallado["url"] and hallado["code"]:
            break
        if proc.poll() is not None:
            break
        time.sleep(0.3)

    if hallado["url"]:
        # El proceso sigue vivo esperando que apruebes: no se mata. Cuando termine,
        # guarda la credencial en agent-home solo.
        return {
            "ok": True,
            "url": hallado["url"],
            "code": hallado["code"],
            "pid": proc.pid,
            "waiting": proc.poll() is None,
        }

    proc.terminate()
    return {
        "ok": False,
        "error": "El runtime no devolvió una URL de inicio de sesión.",
        "output": "\n".join(lineas)[-600:],
    }


def main() -> int:
    if len(sys.argv) < 2:
        json.dump({"ok": False, "error": "falta el proveedor"}, sys.stdout)
        return 1
    proveedor = sys.argv[1]
    try:
        salida = estado(proveedor) if "--estado" in sys.argv else login(proveedor)
    except Exception as error:
        salida = {"ok": False, "error": str(error)}
    json.dump(salida, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
