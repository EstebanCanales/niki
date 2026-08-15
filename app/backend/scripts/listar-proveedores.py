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
# El estado de sesión se lee del home de Niki, no del Hermes personal del usuario. Sin
# esto, un proveedor conectado acá figuraba desconectado porque se consultaba ~/.hermes.
os.environ.setdefault(
    "HERMES_HOME",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent-home"),
)


def main() -> int:
    sys.path.insert(0, RUNTIME_DIR)
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY
    except Exception as error:  # el fork no está instalado o el venv está roto
        json.dump({"ok": False, "error": str(error), "providers": []}, sys.stdout)
        return 1

    # Estado de sesión de los que van por OAuth. Sin esto, un proveedor con la sesión
    # ya iniciada —Codex, por ejemplo— figuraba como no usable, porque `credentialReady`
    # solo miraba variables de entorno y no sabe nada de sesiones.
    try:
        from hermes_cli.auth import get_auth_status
    except Exception:
        get_auth_status = None

    # Modelos sugeridos por proveedor, del propio catálogo del runtime. Sin esto el
    # campo de modelo es adivinanza: cada proveedor nombra los suyos distinto.
    try:
        from hermes_cli.models import curated_models_for_provider
    except Exception:
        curated_models_for_provider = None

    def modelos(pid: str) -> list:
        if not curated_models_for_provider:
            return []
        try:
            ms = curated_models_for_provider(pid) or []
            return [str(m[0] if isinstance(m, (tuple, list)) else m) for m in ms][:8]
        except Exception:
            return []

    def logueado(pid: str, auth_type: str) -> bool:
        if not get_auth_status or auth_type == "api_key":
            return False
        try:
            return bool((get_auth_status(pid) or {}).get("logged_in"))
        except Exception:
            return False

    salida = []
    for pid, cfg in PROVIDER_REGISTRY.items():
        env_vars = tuple(getattr(cfg, "api_key_env_vars", ()) or ())
        # Qué variable de entorno resolvería la credencial, si hay alguna puesta. Sirve
        # para que la UI muestre qué proveedores están listos para usar sin pedir nada,
        # sin exponer nunca el valor.
        resuelta = next((v for v in env_vars if os.environ.get(v, "").strip()), None)
        auth_type = getattr(cfg, "auth_type", "")
        sesion = logueado(pid, auth_type)
        salida.append(
            {
                "id": pid,
                "name": getattr(cfg, "name", pid),
                "authType": auth_type,
                "loggedIn": sesion,
                "models": modelos(pid),
                "baseUrl": getattr(cfg, "inference_base_url", "") or "",
                "apiKeyEnvVars": list(env_vars),
                "baseUrlEnvVar": getattr(cfg, "base_url_env_var", "") or "",
                # Usable si hay clave en el entorno O la sesión está iniciada.
                "credentialReady": bool(resuelta) or sesion,
                "credentialFrom": resuelta or ("sesión iniciada" if sesion else None),
            }
        )

    # Upstream registra alias del mismo servicio con distinto id (novita, novita-ai,
    # novitaai...). En una lista para elegir eso es ruido: se queda el primero de cada
    # grupo que comparte nombre, endpoint y credencial.
    vistos = set()
    unicos = []
    for p in salida:
        clave = (p["name"], p["baseUrl"], tuple(p["apiKeyEnvVars"]))
        if clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(p)
    salida = unicos

    salida.sort(key=lambda p: (not p["credentialReady"], p["name"].lower()))
    json.dump({"ok": True, "providers": salida}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
