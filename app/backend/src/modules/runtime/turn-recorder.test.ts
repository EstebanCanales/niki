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

test("una señal se cuelga del último turno de esa sesión", () => {
  const { rec, leer } = recorder();
  const turnId = rec.record({
    sessionId: "s1", userId: "e", channel: "voice",
    input: "contame un chiste largo", reply: "Había una vez...", model: "voz",
  });
  rec.signal("s1", "interrupcion", "alcanzó a decir: Había una vez");

  const [turno, senal] = leer();
  assert.equal(turno.type, "turno");
  assert.equal(senal.type, "senal");
  assert.equal(senal.senal, "interrupcion");
  assert.equal(senal.turnId, turnId, "la señal tiene que apuntar al turno que la provocó");
});

test("cada sesión tiene su propio último turno", () => {
  const { rec, leer } = recorder();
  const a = rec.record({ sessionId: "A", userId: "e", channel: "voice", input: "uno", reply: "1", model: "voz" });
  const b = rec.record({ sessionId: "B", userId: "e", channel: "voice", input: "dos", reply: "2", model: "voz" });
  rec.signal("A", "repeticion");

  const senal = leer().find((f) => f.type === "senal");
  assert.equal(senal?.turnId, a, "no puede colgarse del turno de la otra sesión");
  assert.notEqual(a, b);
});

test("una señal sin turno previo se anota igual, atada a la sesión", () => {
  // Pasa cuando la conversación va toda por el agente: no hay turno de voz que marcar,
  // pero la señal sigue valiendo — el exportador la ata por sessionId.
  const { rec, leer } = recorder();
  rec.signal("sesion-sin-voz", "rechazo", "deny: terminal");

  const [senal] = leer();
  assert.equal(senal.turnId, null);
  assert.equal(senal.sessionId, "sesion-sin-voz");
  assert.equal(senal.detalle, "deny: terminal");
});

test("una señal sin sesión no se anota", () => {
  const { rec, leer } = recorder();
  rec.signal("", "interrupcion");
  assert.equal(leer().length, 0);
});

test("recordar el último turno de miles de sesiones no crece sin límite", () => {
  const { rec } = recorder();
  for (let i = 0; i < 600; i += 1) {
    rec.record({ sessionId: `s${i}`, userId: "e", channel: "voice", input: "x", reply: "y", model: "voz" });
  }
  const mapa = (rec as unknown as { ultimoTurno: Map<string, string> }).ultimoTurno;
  assert.ok(mapa.size <= 500, `quedaron ${mapa.size} sesiones en memoria`);
  assert.ok(mapa.has("s599"), "la más nueva tiene que seguir estando");
  assert.ok(!mapa.has("s0"), "la más vieja se tuvo que caer");
});

test("con la captura apagada no se guarda nada", () => {
  const { rec, leer } = recorder();
  rec.capturar(false);
  assert.equal(rec.estaCapturando(), false);

  const id = rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "hola", reply: "chau", model: "voz" });
  rec.signal("s", "interrupcion");

  assert.equal(id, null, "sin captura no hay turno al que colgarle señales");
  assert.equal(leer().length, 0, "ni turnos ni señales");
});

test("apagar y volver a encender: lo de antes sigue, lo del medio no", () => {
  const { rec, leer } = recorder();
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "antes", reply: "1", model: "voz" });
  rec.capturar(false);
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "durante", reply: "2", model: "voz" });
  rec.capturar(true);
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "despues", reply: "3", model: "voz" });

  assert.deepEqual(leer().map((t) => t.input), ["antes", "despues"]);
});

test("el interruptor sobrevive a un reinicio del backend", () => {
  // Vive en un archivo, no en memoria: apagar la captura y que se vuelva a encender sola
  // sería peor que no tener interruptor.
  const { rec, carpeta } = recorder();
  rec.capturar(false);
  assert.equal(new TurnRecorderService(carpeta).estaCapturando(), false);
});

test("el resumen cuenta turnos y señales sin devolver las conversaciones", () => {
  const { rec } = recorder();
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "hola", reply: "chau", model: "voz" });
  rec.signal("s", "interrupcion");

  const r = rec.resumen();
  assert.equal(r.turnos, 1);
  assert.equal(r.senales, 1);
  assert.equal(r.capturando, true);
  assert.equal(r.dias.length, 1);
  assert.ok(r.bytes > 0);
  assert.ok(!JSON.stringify(r).includes("chau"), "el resumen no puede filtrar lo que se dijo");
});

test("borrar deja el dataset vacío", () => {
  const { rec, leer } = recorder();
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "hola", reply: "chau", model: "voz" });
  const { borrados } = rec.borrar();
  assert.equal(borrados.length, 1);
  assert.equal(leer().length, 0);
  assert.equal(rec.resumen().turnos, 0);
});

test("borrar un día no se lleva los otros", () => {
  const { rec, carpeta } = recorder();
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, "turnos-2026-01-01.jsonl"), '{"type":"turno"}\n');
  fs.writeFileSync(path.join(carpeta, "turnos-2026-01-02.jsonl"), '{"type":"turno"}\n');

  rec.borrar("2026-01-01");
  assert.deepEqual(rec.resumen().dias.map((d) => d.dia), ["2026-01-02"]);
});

test("borrar no toca archivos que no escribió este servicio", () => {
  const { rec, carpeta } = recorder();
  fs.mkdirSync(carpeta, { recursive: true });
  const ajeno = path.join(carpeta, "no-es-mio.txt");
  fs.writeFileSync(ajeno, "algo importante de otro");
  rec.record({ sessionId: "s", userId: "e", channel: "voice", input: "hola", reply: "chau", model: "voz" });

  rec.borrar();
  assert.ok(fs.existsSync(ajeno), "solo se borran los turnos-YYYY-MM-DD.jsonl de esta carpeta");
});

test("escribir un turno nunca lanza, aunque el destino no sirva", () => {
  // El disco lleno o sin permisos no puede romper un turno que el usuario ya dio por
  // terminado: esto corre después de cerrar el stream.
  const rec = new TurnRecorderService("/proc/no-se-puede-escribir-aca");
  assert.doesNotThrow(() =>
    rec.record({ sessionId: "y", userId: "e", channel: "voice", input: "hola", reply: "chau", model: "voz" }),
  );
});
