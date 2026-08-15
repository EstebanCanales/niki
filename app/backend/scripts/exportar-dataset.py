#!/usr/bin/env python3
"""Convierte las sesiones del runtime en un dataset de entrenamiento.

Cada sesión que corre Niki queda guardada en `agent-home/sessions/*.json` con la
trayectoria completa: el prompt de sistema, el esquema de las 51 herramientas, y todos
los mensajes con sus llamadas a herramientas, sus resultados y —lo más valioso— el
razonamiento del modelo antes de cada decisión. Eso es exactamente la forma que tiene un
dataset de ajuste fino; no hay que inventar un formato nuevo, hay que limpiarlo.

Salen dos formatos:

  messages  (por defecto)  Un objeto por sesión, con `messages` y `tools` al estilo
                           OpenAI. Conserva `reasoning`. Es el que sirve para entrenar
                           uso de herramientas.
  sharegpt  (--formato)    `{"conversations": [{"from": ..., "value": ...}]}`, que es lo
                           que come `trajectory_compressor.py` del propio runtime — el
                           mismo script que Nous usa para recortar trayectorias
                           "preserving training signal quality".

Lo que se tira, y por qué:

  - Sesiones de menos de `--min-turnos` intercambios: no enseñan nada y son casi todas
    pruebas de humo.
  - Sesiones cuyo id empieza con `prueba-`: mías, de verificar el runtime.
  - Sesiones sin ninguna respuesta del asistente: quedaron a mitad.

Todo el texto pasa por el redactor del propio runtime (`agent.redact`), que tapa claves
por prefijo, asignaciones de entorno, cabeceras de autorización, JWT, cadenas de conexión
y claves privadas. Importa de verdad: las sesiones tienen salida de terminal, y ahí
aparecen credenciales sin que uno se dé cuenta.

Uso:
    app/agent-runtime/venv/bin/python app/backend/scripts/exportar-dataset.py
    ... --formato sharegpt --salida /tmp/niki.jsonl
    ... --incluir-pruebas --min-turnos 1     # para ver todo lo que hay
"""

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(os.path.dirname(BACKEND), "agent-runtime")
SESIONES = os.path.join(BACKEND, "agent-home", "sessions")
SALIDA_POR_DEFECTO = os.path.join(BACKEND, "dataset")

sys.path.insert(0, RUNTIME)

try:
    from agent.redact import redact_sensitive_text
except Exception:  # el fork no está en el path o el venv está roto
    def redact_sensitive_text(text, *, force=False, code_file=False):  # type: ignore
        return text


def limpiar(valor):
    """Redacta secretos en cualquier texto, entrando en listas y diccionarios."""
    if isinstance(valor, str):
        return redact_sensitive_text(valor, force=True)
    if isinstance(valor, list):
        return [limpiar(v) for v in valor]
    if isinstance(valor, dict):
        return {k: limpiar(v) for k, v in valor.items()}
    return valor


def texto_de(mensaje):
    """El contenido de un mensaje como texto plano, venga como venga."""
    contenido = mensaje.get("content")
    if isinstance(contenido, str):
        return contenido
    if isinstance(contenido, list):
        partes = []
        for bloque in contenido:
            if isinstance(bloque, dict) and isinstance(bloque.get("text"), str):
                partes.append(bloque["text"])
        return "\n".join(partes)
    return ""


def util(sesion, min_turnos, incluir_pruebas):
    """¿Esta sesión aporta algo al dataset?"""
    sid = str(sesion.get("session_id") or "")
    if not incluir_pruebas and sid.startswith("prueba-"):
        return False, "sesión de prueba"
    mensajes = sesion.get("messages") or []
    asistentes = [m for m in mensajes if m.get("role") == "assistant"]
    if not asistentes:
        return False, "sin respuestas del asistente"
    # Un "turno" es un par usuario/asistente; los mensajes de herramienta no cuentan
    # porque una sola pregunta puede generar diez.
    turnos = min(len([m for m in mensajes if m.get("role") == "user"]), len(asistentes))
    if turnos < min_turnos:
        return False, f"solo {turnos} turno(s)"
    return True, ""


def a_messages(sesion):
    """Formato OpenAI: mensajes + esquema de herramientas, con el razonamiento intacto."""
    mensajes = []
    for m in sesion.get("messages") or []:
        rol = m.get("role")
        if rol not in {"system", "user", "assistant", "tool"}:
            continue
        salida = {"role": rol, "content": limpiar(texto_de(m))}
        for campo in ("tool_calls", "tool_call_id", "name", "reasoning"):
            if m.get(campo):
                salida[campo] = limpiar(m[campo])
        mensajes.append(salida)
    fila = {
        "session_id": sesion.get("session_id"),
        "model": sesion.get("model"),
        "started_at": sesion.get("session_start"),
        "system_prompt": limpiar(sesion.get("system_prompt") or ""),
        "tools": limpiar(sesion.get("tools") or []),
        "messages": mensajes,
    }
    # Las señales van con el ejemplo, no aparte: son lo que dice si sirvió o no, y
    # separarlas en otro archivo es la forma más segura de que se pierdan.
    if sesion.get("senales"):
        fila["senales"] = sesion["senales"]
    if sesion.get("latency_ms") is not None:
        fila["latency_ms"] = sesion["latency_ms"]
    return fila


# ShareGPT nombra los roles distinto. `tool` no tiene equivalente propio: el compresor de
# trayectorias del runtime espera "tool", así que se deja tal cual.
_ROL_SHAREGPT = {"system": "system", "user": "human", "assistant": "gpt", "tool": "tool"}


def a_sharegpt(sesion):
    turnos = []
    sistema = sesion.get("system_prompt")
    if sistema:
        turnos.append({"from": "system", "value": limpiar(sistema)})
    for m in sesion.get("messages") or []:
        origen = _ROL_SHAREGPT.get(m.get("role"))
        if not origen:
            continue
        valor = texto_de(m)
        # Las llamadas a herramientas van serializadas dentro del turno: sin eso, el
        # ejemplo enseña a contestar sin hacer nada, que es lo contrario de lo que
        # queremos aprender.
        if m.get("tool_calls"):
            valor = (valor + "\n" if valor else "") + json.dumps(
                {"tool_calls": m["tool_calls"]}, ensure_ascii=False
            )
        if not valor:
            continue
        turnos.append({"from": origen, "value": limpiar(valor)})
    fila = {"conversations": turnos, "session_id": sesion.get("session_id")}
    if sesion.get("senales"):
        fila["senales"] = sesion["senales"]
    return fila


def leer_jsonl(carpeta):
    """Todas las líneas de todos los JSONL de una carpeta, salteando las rotas."""
    if not os.path.isdir(carpeta):
        return []
    filas = []
    for nombre in sorted(os.listdir(carpeta)):
        if not nombre.endswith(".jsonl"):
            continue
        with open(os.path.join(carpeta, nombre), encoding="utf-8") as fh:
            for linea in fh:
                linea = linea.strip()
                if not linea:
                    continue
                try:
                    filas.append(json.loads(linea))
                except json.JSONDecodeError:
                    # Una línea a medias —el backend murió escribiendo— no invalida el resto.
                    continue
    return filas


def turnos_de_voz(carpeta):
    """Los turnos hablados que anotó el backend, con sus señales de calidad pegadas.

    La ruta rápida de voz no pasa por el runtime —contesta con Groq en menos de un
    segundo— así que no deja sesión. El backend los va appendeando a un JSONL por día
    (ver TurnRecorderService); acá se les da la misma forma que a los demás para que
    salgan en el mismo archivo.

    Las señales viven en el mismo archivo como líneas aparte y se atan por `turnId`. Las
    que no tienen turno —una aprobación en una conversación que fue toda por el agente—
    se juntan por sesión, para que `senales_por_sesion` las pueda pegar allá.
    """
    filas = leer_jsonl(carpeta)

    por_turno = {}
    sueltas = {}
    for f in filas:
        if f.get("type") != "senal":
            continue
        marca = {"senal": f.get("senal"), "at": f.get("at")}
        if f.get("detalle"):
            marca["detalle"] = limpiar(f["detalle"])
        if f.get("turnId"):
            por_turno.setdefault(f["turnId"], []).append(marca)
        elif f.get("sessionId"):
            sueltas.setdefault(f["sessionId"], []).append(marca)

    sesiones = []
    for t in filas:
        # Las primeras versiones del archivo no tenían `type`: todo era un turno.
        if t.get("type") not in (None, "turno"):
            continue
        if not t.get("input"):
            continue
        senales = por_turno.get(t.get("turnId"), [])
        sesiones.append({
            "session_id": t.get("sessionId"),
            "model": t.get("model") or "voz",
            "session_start": t.get("at"),
            "system_prompt": "",
            "tools": [],
            "senales": senales,
            "latency_ms": t.get("latencyMs"),
            "messages": [
                {"role": "user", "content": t.get("input") or ""},
                {"role": "assistant", "content": t.get("reply") or ""},
            ],
        })
    return sesiones, sueltas


VERSION_EXPORTADOR = 2


def dia_de(sesion):
    """El día de una sesión, para agruparla. Sin fecha va a `sin-fecha`, no se descarta."""
    inicio = str(sesion.get("session_start") or "")
    return inicio[:10] if len(inicio) >= 10 else "sin-fecha"


def sha256_de(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for bloque in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(bloque)
    return h.hexdigest()


def escribir_manifiesto(ruta_jsonl, formato, conteos):
    """Un manifiesto al lado del .jsonl.

    Existe para el momento de subir esto a la nube: sin un hash y un conteo por partición,
    no hay forma de saber qué se subió, qué cambió y qué está duplicado del otro lado. Con
    el hash, volver a subir una partición que no cambió es un no-op y se nota.
    """
    manifiesto = {
        "archivo": os.path.basename(ruta_jsonl),
        "formato": formato,
        "version_exportador": VERSION_EXPORTADOR,
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "bytes": os.path.getsize(ruta_jsonl),
        "sha256": sha256_de(ruta_jsonl),
        **conteos,
    }
    destino = os.path.join(os.path.dirname(ruta_jsonl), "manifiesto.json")
    with open(destino, "w", encoding="utf-8") as fh:
        json.dump(manifiesto, fh, ensure_ascii=False, indent=2)
    return manifiesto


def main():
    p = argparse.ArgumentParser(description="Exporta las sesiones de Niki como dataset.")
    p.add_argument("--formato", choices=("messages", "sharegpt"), default="messages")
    p.add_argument("--salida", default="", help="archivo .jsonl (por defecto, dataset/<fecha>.jsonl)")
    p.add_argument("--sesiones", default=SESIONES)
    p.add_argument("--min-turnos", type=int, default=2)
    p.add_argument("--incluir-pruebas", action="store_true")
    p.add_argument("--sin-voz", action="store_true", help="no incluir los turnos hablados")
    p.add_argument(
        "--particionar",
        action="store_true",
        help="una carpeta por día con su manifiesto, para subir de a partes",
    )
    args = p.parse_args()

    if not os.path.isdir(args.sesiones):
        print(f"No existe {args.sesiones}", file=sys.stderr)
        return 1

    salida = args.salida
    if not salida:
        os.makedirs(SALIDA_POR_DEFECTO, exist_ok=True)
        fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        salida = os.path.join(SALIDA_POR_DEFECTO, f"niki-{fecha}-{args.formato}.jsonl")

    archivos = sorted(
        f for f in os.listdir(args.sesiones)
        if f.startswith("session_") and f.endswith(".json")
    )

    voz, senales_sueltas = ([], {}) if args.sin_voz else turnos_de_voz(
        os.path.join(BACKEND, "dataset", "voz")
    )

    escritas = 0
    mensajes = 0
    con_herramientas = 0
    con_razonamiento = 0
    con_senales = 0
    descartadas = {}

    def leer_sesiones():
        for nombre in archivos:
            try:
                with open(os.path.join(args.sesiones, nombre), encoding="utf-8") as sf:
                    yield json.load(sf)
            except Exception as error:
                motivo = f"ilegible ({type(error).__name__})"
                descartadas[motivo] = descartadas.get(motivo, 0) + 1
        for sesion in voz:
            yield sesion

    # Se juntan primero y se escriben después: para partir por día hay que saber a qué
    # día va cada fila, y las sesiones no vienen ordenadas.
    por_dia = defaultdict(list)
    for sesion in leer_sesiones():
        # Señales que no tienen turno hablado —aprobaciones, rechazos— pero sí sesión.
        propias = senales_sueltas.get(str(sesion.get("session_id") or ""))
        if propias:
            sesion = {**sesion, "senales": propias}

        ok, motivo = util(sesion, args.min_turnos, args.incluir_pruebas)
        if not ok:
            descartadas[motivo] = descartadas.get(motivo, 0) + 1
            continue

        fila = a_sharegpt(sesion) if args.formato == "sharegpt" else a_messages(sesion)
        por_dia[dia_de(sesion)].append(fila)
        escritas += 1

        ms = sesion.get("messages") or []
        mensajes += len(ms)
        con_herramientas += sum(1 for m in ms if m.get("tool_calls"))
        con_razonamiento += sum(1 for m in ms if m.get("reasoning") or m.get("reasoning_content"))
        if sesion.get("senales"):
            con_senales += 1

    def volcar(ruta, filas):
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with open(ruta, "w", encoding="utf-8") as fh:
            for fila in filas:
                fh.write(json.dumps(fila, ensure_ascii=False) + "\n")

    if args.particionar:
        raiz = os.path.join(SALIDA_POR_DEFECTO, "particiones")
        partes = []
        for dia in sorted(por_dia):
            ruta = os.path.join(raiz, dia, f"{args.formato}.jsonl")
            volcar(ruta, por_dia[dia])
            m = escribir_manifiesto(ruta, args.formato, {
                "dia": dia,
                "sesiones": len(por_dia[dia]),
                "con_senales": sum(1 for f in por_dia[dia] if f.get("senales")),
            })
            partes.append({"dia": dia, "sha256": m["sha256"], "sesiones": m["sesiones"], "bytes": m["bytes"]})
        with open(os.path.join(raiz, "particiones.json"), "w", encoding="utf-8") as fh:
            json.dump({
                "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "formato": args.formato,
                "version_exportador": VERSION_EXPORTADOR,
                "particiones": partes,
            }, fh, ensure_ascii=False, indent=2)
        salida = raiz
    else:
        todas = [f for dia in sorted(por_dia) for f in por_dia[dia]]
        volcar(salida, todas)
        escribir_manifiesto(salida, args.formato, {
            "sesiones": escritas,
            "mensajes": mensajes,
            "con_senales": con_senales,
            "dias": sorted(por_dia),
        })

    print(f"Escrito: {salida}")
    if args.particionar:
        print(f"  particiones         : {len(por_dia)} ({', '.join(sorted(por_dia))})")
    print(f"  sesiones exportadas : {escritas} de {len(archivos) + len(voz)}")
    print(f"  de ellas, de voz    : {len(voz)}")
    print(f"  mensajes            : {mensajes}")
    print(f"  con herramientas    : {con_herramientas}")
    print(f"  con razonamiento    : {con_razonamiento}")
    print(f"  con señales         : {con_senales}")
    if descartadas:
        print("  descartadas         :")
        for motivo, cuenta in sorted(descartadas.items(), key=lambda kv: -kv[1]):
            print(f"      {cuenta:>4}  {motivo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
