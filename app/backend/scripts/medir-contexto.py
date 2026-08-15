#!/usr/bin/env python3
"""Cuánto contexto lleva usado una sesión, y cuándo se va a compactar.

El número no se calcula acá: se le pregunta al propio runtime. `estimate_request_tokens_rough`
es la función que decide si toca compactar —la que imprime "Preflight compression: ~154,135
tokens >= 128,000 threshold"— y cuenta el prompt de sistema, los mensajes y el esquema de
las herramientas, que con cincuenta herramientas son veinte o treinta mil tokens por sí
solas.

Reimplementarla en TypeScript daría un número parecido pero distinto (usa la
representación de Python de cada mensaje, comillas simples incluidas), y un indicador que
no coincide con el momento en que compacta de verdad es peor que no tener indicador.

Vive en app/backend/scripts y no dentro del fork a propósito: es un consumidor, no una
modificación (ver app/agent-runtime/UPSTREAM.md).

Uso:
    medir-contexto.py <session_id>
"""

import json
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(os.path.dirname(BACKEND), "agent-runtime")
HOME = os.path.join(BACKEND, "agent-home")

os.environ.setdefault("HERMES_HOME", HOME)
sys.path.insert(0, RUNTIME)


def main() -> int:
    if len(sys.argv) < 2:
        json.dump({"ok": False, "error": "falta el session_id"}, sys.stdout)
        return 1
    session_id = sys.argv[1]

    ruta = os.path.join(HOME, "sessions", f"session_{session_id}.json")
    if not os.path.isfile(ruta):
        # Una sesión que todavía no habló no es un error: no usó nada de contexto.
        json.dump({"ok": True, "sessionId": session_id, "existe": False, "tokens": 0}, sys.stdout)
        return 0

    try:
        from agent.model_metadata import (
            MINIMUM_CONTEXT_LENGTH,
            estimate_request_tokens_rough,
            get_model_context_length,
        )
        from hermes_cli.config import load_config
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout)
        return 1

    with open(ruta, encoding="utf-8") as fh:
        sesion = json.load(fh)

    modelo = sesion.get("model") or ""
    tokens = estimate_request_tokens_rough(
        sesion.get("messages") or [],
        system_prompt=sesion.get("system_prompt") or "",
        tools=sesion.get("tools") or None,
    )

    cfg = load_config()
    modelo_cfg = cfg.get("model") or {}
    contexto = get_model_context_length(
        modelo,
        base_url=sesion.get("base_url") or modelo_cfg.get("base_url") or "",
        config_context_length=modelo_cfg.get("context_length"),
        provider=modelo_cfg.get("provider") or None,
    )

    # El mismo cálculo que hace el compresor, piso incluido: por debajo de 64.000 no
    # compacta aunque el porcentaje diga que sí.
    comp = cfg.get("compression") or {}
    porcentaje = float(comp.get("threshold", 0.50) or 0.50)
    umbral = max(int(contexto * porcentaje), MINIMUM_CONTEXT_LENGTH)

    json.dump(
        {
            "ok": True,
            "sessionId": session_id,
            "existe": True,
            "modelo": modelo,
            "mensajes": len(sesion.get("messages") or []),
            "herramientas": len(sesion.get("tools") or []),
            "tokens": tokens,
            "contexto": contexto,
            "umbral": umbral,
            "compactaHabilitada": bool(comp.get("enabled", True)),
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
