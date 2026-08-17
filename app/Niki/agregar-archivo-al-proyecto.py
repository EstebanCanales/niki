#!/usr/bin/env python3
"""Agrega un archivo .swift al proyecto de Xcode.

El proyecto usa referencias explícitas (no grupos sincronizados con el sistema de
archivos), así que crear el archivo no alcanza: hay que anotarlo en cuatro lugares del
project.pbxproj o el build falla con "cannot find X in scope", que no se parece en nada al
problema real.

Se hace con un script y no a mano porque el pbxproj es un formato viejo, sensible al
orden, y editarlo a mano es como se rompen los proyectos de Xcode.

Uso:
    ./agregar-archivo-al-proyecto.py Sources/Desktop/Components/NikiConsolePanel.swift
"""

import os
import re
import sys
import uuid

PROYECTO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Niki.xcodeproj", "project.pbxproj")


def id_nuevo(contenido):
    """Un id de 24 hex que no esté usado. Xcode los quiere de ese largo exacto."""
    while True:
        candidato = uuid.uuid4().hex[:24].upper()
        if candidato not in contenido:
            return candidato


def main():
    if len(sys.argv) < 2:
        print("falta la ruta del archivo (relativa a app/Niki)", file=sys.stderr)
        return 1
    ruta = sys.argv[1]
    nombre = os.path.basename(ruta)
    base = os.path.dirname(os.path.abspath(__file__))
    if not os.path.isfile(os.path.join(base, ruta)):
        print(f"no existe: {ruta}", file=sys.stderr)
        return 1

    with open(PROYECTO, encoding="utf-8") as fh:
        c = fh.read()

    if f"/* {nombre} */" in c:
        print(f"{nombre} ya está en el proyecto")
        return 0

    # Se copia la ubicación de un archivo vecino en vez de adivinar el grupo: el vecino ya
    # está en el grupo correcto, con el sourceTree correcto.
    hermano = os.path.basename(
        next(
            (f for f in sorted(os.listdir(os.path.join(base, os.path.dirname(ruta))))
             if f.endswith(".swift") and f != nombre and f"/* {f} */" in c),
            "",
        )
    )
    if not hermano:
        print(f"no encontré ningún archivo vecino de {ruta} que ya esté en el proyecto",
              file=sys.stderr)
        return 1

    ref_hermano = re.search(
        rf"([0-9A-F]{{24}}) /\* {re.escape(hermano)} \*/ = {{isa = PBXFileReference", c
    ).group(1)
    build_hermano = re.search(
        rf"([0-9A-F]{{24}}) /\* {re.escape(hermano)} in Sources \*/ = {{isa = PBXBuildFile", c
    ).group(1)

    id_ref = id_nuevo(c)
    id_build = id_nuevo(c + id_ref)

    # 1. PBXBuildFile  2. PBXFileReference  3. el grupo  4. la fase de Sources
    c = c.replace(
        f"\t\t{build_hermano} /* {hermano} in Sources */ = {{isa = PBXBuildFile; fileRef = {ref_hermano} /* {hermano} */; }};\n",
        f"\t\t{build_hermano} /* {hermano} in Sources */ = {{isa = PBXBuildFile; fileRef = {ref_hermano} /* {hermano} */; }};\n"
        f"\t\t{id_build} /* {nombre} in Sources */ = {{isa = PBXBuildFile; fileRef = {id_ref} /* {nombre} */; }};\n",
        1,
    )
    c = c.replace(
        f"\t\t{ref_hermano} /* {hermano} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {hermano}; sourceTree = \"<group>\"; }};\n",
        f"\t\t{ref_hermano} /* {hermano} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {hermano}; sourceTree = \"<group>\"; }};\n"
        f"\t\t{id_ref} /* {nombre} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {nombre}; sourceTree = \"<group>\"; }};\n",
        1,
    )
    c = c.replace(
        f"\t\t\t\t{ref_hermano} /* {hermano} */,\n",
        f"\t\t\t\t{ref_hermano} /* {hermano} */,\n\t\t\t\t{id_ref} /* {nombre} */,\n",
        1,
    )
    c = c.replace(
        f"\t\t\t\t{build_hermano} /* {hermano} in Sources */,\n",
        f"\t\t\t\t{build_hermano} /* {hermano} in Sources */,\n\t\t\t\t{id_build} /* {nombre} in Sources */,\n",
        1,
    )

    if c.count(f"/* {nombre} */") < 3:
        print(f"no se pudo insertar {nombre} en las cuatro secciones", file=sys.stderr)
        return 1

    with open(PROYECTO, "w", encoding="utf-8") as fh:
        fh.write(c)
    print(f"{nombre} agregado (junto a {hermano})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
