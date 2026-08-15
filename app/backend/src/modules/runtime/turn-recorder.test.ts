import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { TurnRecorderService } from "./turn-recorder.service";

/** Cada test escribe en su propia carpeta: el dataset de verdad no se toca. */
function recorder() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "niki-voz-"));
  const leer = (): Record<string, unknown>[] => {
    const archivo = path.join(carpeta, `turnos-${new Date().toISOString().slice(0, 10)}.jsonl`);
    if (!fs.existsSync(archivo)) return [];
    return fs
      .readFileSync(archivo, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  };
  return { rec: new TurnRecorderService(carpeta), leer, carpeta };
}

test("un turno hablado queda anotado con las dos mitades", () => {
  const { rec, leer } = recorder();
  rec.record({
    sessionId: "s1",
    userId: "esteban",
    channel: "voice",
    input: "¿qué hora es?",
    reply: "Las tres y veinte.",
    model: "voz",
    latencyMs: 660,
  });

  const turnos = leer();
  assert.equal(turnos.length, 1);
  assert.equal(turnos[0].input, "¿qué hora es?");
  assert.equal(turnos[0].reply, "Las tres y veinte.");
  assert.equal(turnos[0].latencyMs, 660);
  assert.ok(typeof turnos[0].at === "string" && (turnos[0].at as string).includes("T"));
});

test("dos turnos se acumulan en el archivo del día", () => {
  const { rec, leer } = recorder();
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "uno", reply: "1", model: "voz" });
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "dos", reply: "2", model: "voz" });
  assert.deepEqual(leer().map((t) => t.input), ["uno", "dos"]);
});

test("un turno a medias no se anota", () => {
  const { rec, leer } = recorder();
  // Pasa cuando el usuario interrumpe: hay pregunta y no hay respuesta. Entrenar con eso
  // enseñaría a callarse.
  rec.record({ sessionId: "x", userId: "e", channel: "voice", input: "hola", reply: "   ", model: "voz" });
  rec.record({ sessionId: "x", userId: "e", channel: "voice", input: "", reply: "hola", model: "voz" });
  assert.equal(leer().length, 0);
});

test("escribir un turno nunca lanza, aunque el destino no sirva", () => {
  // El disco lleno o sin permisos no puede romper un turno que el usuario ya dio por
  // terminado: esto corre después de cerrar el stream.
  const rec = new TurnRecorderService("/proc/no-se-puede-escribir-aca");
  assert.doesNotThrow(() =>
    rec.record({ sessionId: "y", userId: "e", channel: "voice", input: "hola", reply: "chau", model: "voz" }),
  );
});
