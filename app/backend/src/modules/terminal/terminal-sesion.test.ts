import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { guionParaSesion, sesionDeLaIA, sesionesDeNiki, sesionPropia } from "./terminal-sesion";

/** Un log falso del runtime, con las líneas que deja al abrir cada sesión. */
function logConSesiones(temp: string, ...ids: string[]): string {
  const ruta = path.join(temp, "agent.log");
  fs.writeFileSync(
    ruta,
    ids
      .map((id) => `2026-08-17 13:02:02,024 INFO [x] tools.environments.base: Session snapshot created (session=${id}, cwd=/tmp)\n`)
      .join(""),
  );
  return ruta;
}

/** Un temporal propio por test: el de verdad tiene las sesiones reales del runtime. */
function tempFalso() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "niki-term-"));
}

function fabricarSesionDeLaIA(temp: string, id: string, cwd: string, hace = 0) {
  fs.writeFileSync(path.join(temp, `hermes-cwd-${id}.txt`), `${cwd}\n`);
  fs.writeFileSync(path.join(temp, `hermes-snap-${id}.sh`), "export FOO=bar\n");
  if (hace) {
    const cuando = new Date(Date.now() - hace);
    fs.utimesSync(path.join(temp, `hermes-cwd-${id}.txt`), cuando, cuando);
  }
}

test("encuentra la sesión que la IA está usando", () => {
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "abc123456789", os.tmpdir());
  const log = logConSesiones(temp, "abc123456789");

  const s = sesionDeLaIA(temp, log);
  assert.equal(s?.id, "abc123456789");
  assert.equal(s?.cwd, os.tmpdir());
  assert.equal(s?.compartidaConLaIA, true);
});

test("entre varias sesiones toma la última que abrió Niki", () => {
  // Los archivos de gateways anteriores quedan en el temporal. Tomar uno viejo sería
  // aterrizar en el directorio de anteayer.
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "aaaaaaaaaaaa", "/usr");
  fabricarSesionDeLaIA(temp, "ffffffffffff", os.tmpdir());
  const log = logConSesiones(temp, "aaaaaaaaaaaa", "ffffffffffff");

  assert.equal(sesionDeLaIA(temp, log)?.id, "ffffffffffff");
});

test("no se mete en la sesión de otro Hermes de la misma máquina", () => {
  // El Hermes personal de Esteban (~/.hermes) escribe en el mismo temporal y con el mismo
  // formato de nombre. Antes se tomaba el archivo más reciente y la terminal de Niki
  // terminaba parada en el directorio del otro — pasó de verdad.
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "de1a1a1a1a1a", os.tmpdir());   // de Niki
  fabricarSesionDeLaIA(temp, "de0000000000", "/usr");        // del otro Hermes, más nuevo
  const log = logConSesiones(temp, "de1a1a1a1a1a");          // el log solo conoce la suya

  assert.equal(sesionDeLaIA(temp, log)?.id, "de1a1a1a1a1a");
});

test("sin log no hay sesión de la IA", () => {
  // Es lo correcto: si no se puede probar que la sesión es de Niki, mejor abrir una
  // propia que meterse en la de cualquiera.
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "abc123456789", os.tmpdir());
  assert.equal(sesionDeLaIA(temp, path.join(temp, "no-existe.log")), null);
});

test("las sesiones salen del log en orden, la más nueva primero", () => {
  const temp = tempFalso();
  const log = logConSesiones(temp, "111111111111", "222222222222", "333333333333");
  assert.deepEqual(sesionesDeNiki(log), ["333333333333", "222222222222", "111111111111"]);
});

test("una sesión sin snapshot no sirve: sería compartir a medias", () => {
  const temp = tempFalso();
  fs.writeFileSync(path.join(temp, "hermes-cwd-5010cd012345.txt"), `${os.tmpdir()}\n`);
  assert.equal(sesionDeLaIA(temp, logConSesiones(temp, "5010cd012345")), null);
});

test("si el directorio guardado ya no existe, esa sesión se descarta", () => {
  // Pasa cuando la IA borró el directorio donde estaba: `cd` fallaría con 126 y el
  // comando se perdería sin explicación.
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "b0114d012345", path.join(temp, "ya-no-esta"));
  assert.equal(sesionDeLaIA(temp, logConSesiones(temp, "b0114d012345")), null);
});

test("sin sesión de la IA se abre una propia, y se dice que lo es", () => {
  const temp = tempFalso();
  assert.equal(sesionDeLaIA(temp, logConSesiones(temp)), null);

  const s = sesionPropia("/Users/x/proyecto", temp);
  assert.equal(s.compartidaConLaIA, false);
  assert.equal(s.cwd, "/Users/x/proyecto");
  assert.ok(fs.existsSync(s.archivoSnapshot), "el snapshot tiene que existir para poder cargarlo");
});

test("la sesión propia recuerda dónde quedó", () => {
  const temp = tempFalso();
  const primera = sesionPropia("/Users/x/proyecto", temp);
  fs.writeFileSync(primera.archivoCwd, `${os.tmpdir()}\n`);

  assert.equal(sesionPropia("/Users/x/proyecto", temp).cwd, os.tmpdir());
});

test("el guion sigue el mismo orden que el del runtime", () => {
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "07de41234567", os.tmpdir());
  const s = sesionDeLaIA(temp, logConSesiones(temp, "07de41234567"))!;
  const g = guionParaSesion(s, "echo hola");

  // Cualquier diferencia de orden acá significa que la IA y Esteban terminan en sesiones
  // que se parecen pero no son la misma.
  const pasos = [
    g.indexOf("source "),
    g.indexOf("builtin cd"),
    g.indexOf("echo hola"),
    g.indexOf("export -p >"),
    g.indexOf("pwd -P >"),
  ];
  assert.deepEqual(pasos, [...pasos].sort((a, b) => a - b), "los pasos están fuera de orden");
  assert.ok(pasos.every((p) => p >= 0), "falta algún paso");
});

test("un directorio con espacios o comillas no rompe el guion", () => {
  const temp = tempFalso();
  const raro = path.join(temp, "carpeta con 'comillas'");
  fs.mkdirSync(raro);
  fabricarSesionDeLaIA(temp, "4a4012345678", raro);

  const g = guionParaSesion(sesionDeLaIA(temp, logConSesiones(temp, "4a4012345678"))!, "pwd");
  assert.ok(g.includes("'comillas'\\''"), "el nombre tiene que ir escapado");
});

test("el código de salida del comando es el que sale, no el de los pasos que le siguen", () => {
  // Después del comando se vuelca el entorno y se escribe el cwd: sin guardar el código
  // antes, `false` devolvería 0 porque el último paso salió bien.
  const temp = tempFalso();
  fabricarSesionDeLaIA(temp, "c0d160123456", os.tmpdir());
  const g = guionParaSesion(sesionDeLaIA(temp, logConSesiones(temp, "c0d160123456"))!, "false");

  assert.ok(g.includes("__niki_ec=$?"), "hay que guardar el código apenas termina");
  assert.ok(g.trimEnd().endsWith("exit $__niki_ec"), "y devolverlo al final");
});
