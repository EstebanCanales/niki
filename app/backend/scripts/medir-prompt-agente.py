#!/usr/bin/env python3
"""Mide el prompt fijo que Niki le manda al runtime del agente en cada turno.

Existe para que la medición de "antes" y la de "después" del recorte de herramientas
usen exactamente el mismo método. Comparar dos números obtenidos de formas distintas no
prueba nada, y ese recorte es justo el que puede rendir menos de lo esperado si el
proveedor ya cacheaba el prefijo estable del prompt.

Uso:
    python3 scripts/medir-prompt-agente.py [--home RUTA] [--guardar SALIDA]

Por defecto lee las sesiones del Hermes externo (~/.hermes). Cuando el runtime interno
esté andando, se le pasa --home app/backend/agent-home para medir el nuevo.

La aproximación de tokens es caracteres/4. Es cruda a propósito: no depende de tener el
tokenizador del proveedor instalado, y al aplicarse igual a los dos lados la comparación
se sostiene.
"""

import argparse
import json
import os
import re
import statistics
import sys
from glob import glob

# Sesiones creadas por Niki: las que abre el backend (api-…, nombres de prueba) y las que
# manda la app, que usa UUID en mayúsculas. El resto de ~/.hermes son de Esteban usando
# Hermes por su cuenta y meterlas ensuciaría la medición.
NIKI_SESSION = re.compile(r"session_(api-|esc|perf|[0-9A-F]{8}-)")

CHARS_PER_TOKEN = 4


def medir(home: str, solo_niki: bool = True):
    carpeta = os.path.join(os.path.expanduser(home), "sessions")
    filas = []
    for ruta in glob(os.path.join(carpeta, "session_*.json")):
        base = os.path.basename(ruta)
        if solo_niki and not NIKI_SESSION.match(base):
            continue
        try:
            with open(ruta) as fh:
                datos = json.load(fh)
        except Exception:
            continue
        herramientas = datos.get("tools") or []
        if not herramientas:
            continue
        prompt = len(datos.get("system_prompt") or "")
        esquemas = len(json.dumps(herramientas, ensure_ascii=False))
        filas.append(
            {
                "sesion": base,
                "modelo": datos.get("model"),
                "prompt_chars": prompt,
                "herramientas": len(herramientas),
                "esquemas_chars": esquemas,
                "total_chars": prompt + esquemas,
                "tokens_aprox": (prompt + esquemas) // CHARS_PER_TOKEN,
            }
        )
    return filas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default="~/.hermes", help="HERMES_HOME a medir")
    ap.add_argument("--guardar", help="Escribe el resultado como JSON en esta ruta")
    ap.add_argument("--todas", action="store_true", help="No filtrar por sesiones de Niki")
    args = ap.parse_args()

    filas = medir(args.home, solo_niki=not args.todas)
    if not filas:
        print(f"No se encontraron sesiones con herramientas en {args.home}", file=sys.stderr)
        return 1

    totales = [f["total_chars"] for f in filas]
    mediana = int(statistics.median(totales))
    resumen = {
        "home": args.home,
        "sesiones": len(filas),
        "mediana_chars": mediana,
        "mediana_tokens_aprox": mediana // CHARS_PER_TOKEN,
        "min_tokens_aprox": min(totales) // CHARS_PER_TOKEN,
        "max_tokens_aprox": max(totales) // CHARS_PER_TOKEN,
        "herramientas_mediana": int(statistics.median([f["herramientas"] for f in filas])),
    }

    print(f"  home:        {resumen['home']}")
    print(f"  sesiones:    {resumen['sesiones']}")
    print(f"  herramientas:{resumen['herramientas_mediana']} (mediana)")
    print(f"  prompt fijo: {resumen['mediana_chars']} caracteres")
    print(f"  ≈ tokens:    {resumen['mediana_tokens_aprox']} (mediana), "
          f"{resumen['min_tokens_aprox']}–{resumen['max_tokens_aprox']} (rango)")

    if args.guardar:
        with open(args.guardar, "w") as fh:
            json.dump({"resumen": resumen, "sesiones": filas}, fh, indent=2, ensure_ascii=False)
        print(f"  guardado en: {args.guardar}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
