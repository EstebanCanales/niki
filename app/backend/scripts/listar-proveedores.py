#!/usr/bin/env python3
"""Lista los proveedores del runtime del agente, en JSON, para que el backend los sirva.

Vive acá y no dentro del fork a propósito: es un consumidor del fork, no una
modificación suya. Cada archivo que tocamos de `app/agent-runtime` es un conflicto
futuro cuando traigamos upstream (ver app/agent-runtime/UPSTREAM.md).

Se ejecuta con el intérprete del venv del fork:
    app/agent-runtime/venv/bin/python app/backend/scripts/listar-proveedores.py
"""

import json
import os
import sys

RUNTIME_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "agent-runtime",
)


def main() -> int:
    sys.path.insert(0, RUNTIME_DIR)
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY
    except Exception as error:  # el fork no está instalado o el venv está roto
        json.dump({"ok": False, "error": str(error), "providers": []}, sys.stdout)
        return 1

    salida = []
    for pid, cfg in PROVIDER_REGISTRY.items():
        env_vars = tuple(getattr(cfg, "api_key_env_vars", ()) or ())
        # Qué variable de entorno resolvería la credencial, si hay alguna puesta. Sirve
        # para que la UI muestre qué proveedores están listos para usar sin pedir nada,
        # sin exponer nunca el valor.
        resuelta = next((v for v in env_vars if os.environ.get(v, "").strip()), None)
        salida.append(
            {
                "id": pid,
                "name": getattr(cfg, "name", pid),
                "authType": getattr(cfg, "auth_type", ""),
                "baseUrl": getattr(cfg, "inference_base_url", "") or "",
                "apiKeyEnvVars": list(env_vars),
                "baseUrlEnvVar": getattr(cfg, "base_url_env_var", "") or "",
                "credentialReady": bool(resuelta),
                "credentialFrom": resuelta,
            }
        )

    salida.sort(key=lambda p: (not p["credentialReady"], p["name"].lower()))
    json.dump({"ok": True, "providers": salida}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
