#!/usr/bin/env python3
"""Mide un modelo contra el conjunto de retención de Niki.

Existe antes que el modelo propio a propósito. Sin una forma de medir, el día que haya
un modelo entrenado no va a haber manera de saber si es mejor que el que hay hoy — y
"suena mejor" no es una respuesta. Se arma ahora, con pocos datos, porque después es tarde.

Mide tres cosas que se pueden medir sin un juez y sin opinión:

  herramienta   De los ejemplos donde Niki tuvo que usar una herramienta, en cuántos el
                modelo llama la misma. Es lo único que distingue a un asistente que hace
                cosas de uno que las describe.
  largo         Cuántas palabras contesta, contra las que contestó Niki. A Esteban le
                molestan las respuestas largas que no dicen nada, así que un modelo que
                contesta el triple es peor aunque acierte.
  formato       Qué fracción de las respuestas mete markdown, viñetas o emojis. Todo esto
                se lee en voz alta: una viñeta hablada es ruido.

No hay puntaje único ni nota final. Tres números que se comparan entre corridas.

Uso:
    # línea de base contra el modelo de voz que hay hoy
    app/agent-runtime/venv/bin/python app/backend/scripts/evaluar-modelo.py \\
        --base-url https://api.groq.com/openai/v1 \\
        --modelo llama-3.3-70b-versatile --clave-env GROQ_API_KEY

    # el modelo propio, cuando exista
    ... --base-url http://127.0.0.1:8080/v1 --modelo niki-1 --clave-env NINGUNA
"""

import argparse
import glob
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTICIONES = os.path.join(BACKEND, "dataset", "particiones")

# Markdown, viñetas y emojis: lo que no se puede leer en voz alta.
FORMATO_HABLADO_ROTO = re.compile(
    r"(\*\*|^\s*[-*•]\s|^\s*\d+\.\s|`|^#{1,6}\s|[\U0001F300-\U0001FAFF✀-➿])",
    re.MULTILINE,
)


def cargar_retencion(raiz):
    """Los ejemplos que nunca entran al entrenamiento."""
    filas = []
    for ruta in sorted(glob.glob(os.path.join(raiz, "*", "*-retencion.jsonl"))):
        with open(ruta, encoding="utf-8") as fh:
            for linea in fh:
                if linea.strip():
                    filas.append(json.loads(linea))
    return filas


def preparar(fila):
    """Separa el ejemplo en lo que se le da al modelo y lo que se espera que conteste.

    Se corta en el último mensaje del usuario: todo lo anterior es contexto y lo que viene
    después es la respuesta de referencia. Los ejemplos que no terminan en una respuesta
    del asistente no sirven para medir y se saltean.
    """
    mensajes = fila.get("messages") or []
    ultimo_usuario = max(
        (i for i, m in enumerate(mensajes) if m.get("role") == "user"), default=None
    )
    if ultimo_usuario is None:
        return None
    esperado = next(
        (m for m in mensajes[ultimo_usuario + 1:] if m.get("role") == "assistant"), None
    )
    if not esperado:
        return None

    entrada = mensajes[: ultimo_usuario + 1]
    if fila.get("system_prompt"):
        entrada = [{"role": "system", "content": fila["system_prompt"]}] + entrada
    return {
        "entrada": [{k: v for k, v in m.items() if k in ("role", "content", "tool_calls", "tool_call_id", "name")} for m in entrada],
        "esperado": esperado,
        "tools": fila.get("tools") or [],
        "session_id": fila.get("session_id"),
    }


def preguntar(base_url, modelo, clave, mensajes, tools, timeout=120, intentos=4):
    """Una respuesta del modelo, esperando si el proveedor pide bajar el ritmo.

    Cada ejemplo lleva el prompt de sistema y hasta cuarenta y dos herramientas: son diez
    mil tokens largos por pedido, y el plan gratis de Groq corta en doce mil por minuto.
    Sin la espera, medir tres ejemplos seguidos da tres 429 y ninguna medición.
    """
    for intento in range(intentos):
        try:
            return _preguntar_una_vez(base_url, modelo, clave, mensajes, tools, timeout)
        except urllib.error.HTTPError as error:
            if error.code != 429 or intento == intentos - 1:
                raise
            espera = int(error.headers.get("retry-after") or 0) or 20 * (intento + 1)
            print(f"    (429 — esperando {espera}s)", flush=True)
            time.sleep(espera)
    raise RuntimeError("inalcanzable")


def _preguntar_una_vez(base_url, modelo, clave, mensajes, tools, timeout=120):
    cuerpo = {"model": modelo, "messages": mensajes, "max_tokens": 512}
    if tools:
        cuerpo["tools"] = tools
    datos = json.dumps(cuerpo).encode("utf-8")
    pedido = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=datos,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {clave}",
            # Sin esto Groq contesta 403: bloquea el "Python-urllib/3.x" que manda urllib
            # por defecto. Costó un rato entender que el 403 no era por la credencial.
            "User-Agent": "niki-eval/1.0",
        },
    )
    try:
        with urllib.request.urlopen(pedido, timeout=timeout) as r:
            return json.loads(r.read())["choices"][0]["message"]
    except urllib.error.HTTPError as error:
        # El cuerpo dice qué pasó; el código solo dice que pasó algo. Sin esto, un 400 por
        # un esquema de herramienta inválido y uno por falta de crédito se ven igual.
        detalle = error.read().decode("utf-8", "replace")[:300]
        raise urllib.error.HTTPError(
            error.url, error.code, f"{error.reason}: {detalle}", error.headers, None
        ) from None


def nombre_de_herramienta(mensaje):
    llamadas = (mensaje or {}).get("tool_calls") or []
    if not llamadas:
        return None
    primera = llamadas[0]
    if isinstance(primera, dict):
        return (primera.get("function") or {}).get("name") or primera.get("name")
    return None


def clasificar(error):
    """Por qué no contestó. Un 413 y un 400 no son el mismo problema y no se arreglan igual."""
    codigo = getattr(error, "code", None)
    if codigo == 413:
        return "no entra en el límite del proveedor (413)"
    if codigo == 429:
        return "límite de ritmo, ni con esperas (429)"
    if codigo == 400 and "tool_use_failed" in str(error):
        return "el modelo no pudo armar la llamada a la herramienta (400)"
    if codigo:
        return f"error {codigo} del proveedor"
    return "no respondió"


def palabras(texto):
    return len(str(texto or "").split())


def main():
    p = argparse.ArgumentParser(description="Mide un modelo contra el conjunto de retención.")
    p.add_argument("--base-url", required=True)
    p.add_argument("--modelo", required=True)
    p.add_argument("--clave-env", default="GROQ_API_KEY", help="variable de entorno con la clave")
    p.add_argument("--particiones", default=PARTICIONES)
    p.add_argument("--limite", type=int, default=0, help="cortar después de N ejemplos")
    p.add_argument("--salida", default="", help="dónde escribir el detalle en JSON")
    args = p.parse_args()

    clave = os.environ.get(args.clave_env, "sin-clave")
    ejemplos = [e for e in (preparar(f) for f in cargar_retencion(args.particiones)) if e]
    if args.limite:
        ejemplos = ejemplos[: args.limite]
    if not ejemplos:
        print(
            "No hay ejemplos de retención. Corré primero:\n"
            "  exportar-dataset.py --particionar",
            file=sys.stderr,
        )
        return 1

    con_herramienta = aciertos = 0
    largos = []
    formato_roto = 0
    fallos = 0
    por_motivo = {}
    detalle = []

    for ejemplo in ejemplos:
        try:
            respuesta = preguntar(args.base_url, args.modelo, clave, ejemplo["entrada"], ejemplo["tools"])
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, TimeoutError) as error:
            # Un modelo que no contesta es un resultado, no un accidente: se cuenta.
            fallos += 1
            motivo = clasificar(error)
            por_motivo[motivo] = por_motivo.get(motivo, 0) + 1
            detalle.append({"session_id": ejemplo["session_id"], "error": str(error)[:200]})
            continue

        esperada = nombre_de_herramienta(ejemplo["esperado"])
        obtenida = nombre_de_herramienta(respuesta)
        if esperada:
            con_herramienta += 1
            if esperada == obtenida:
                aciertos += 1

        texto = respuesta.get("content") or ""
        referencia = ejemplo["esperado"].get("content") or ""
        if texto:
            largos.append((palabras(texto), palabras(referencia)))
            if FORMATO_HABLADO_ROTO.search(texto):
                formato_roto += 1

        detalle.append({
            "session_id": ejemplo["session_id"],
            "herramienta_esperada": esperada,
            "herramienta_obtenida": obtenida,
            "palabras": palabras(texto),
            "palabras_referencia": palabras(referencia),
            "respuesta": texto[:300],
        })

    mias = [a for a, _ in largos]
    suyas = [b for _, b in largos]

    print(f"Modelo: {args.modelo} ({args.base_url})")
    print(f"  ejemplos            : {len(ejemplos)}" + (f" ({fallos} sin respuesta)" if fallos else ""))
    for motivo, cuenta in sorted(por_motivo.items(), key=lambda kv: -kv[1]):
        print(f"      {cuenta:>3}  {motivo}")
    if con_herramienta:
        print(f"  herramienta correcta: {aciertos}/{con_herramienta} ({aciertos / con_herramienta:.0%})")
    else:
        print("  herramienta correcta: sin ejemplos con herramientas en retención")
    if largos:
        print(f"  palabras (mediana)  : {statistics.median(mias):.0f} contra {statistics.median(suyas):.0f} de referencia")
        print(f"  formato hablado roto: {formato_roto}/{len(largos)} respuestas con markdown, viñetas o emojis")

    if args.salida:
        with open(args.salida, "w", encoding="utf-8") as fh:
            json.dump({"modelo": args.modelo, "base_url": args.base_url, "detalle": detalle}, fh,
                      ensure_ascii=False, indent=2)
        print(f"  detalle             : {args.salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
