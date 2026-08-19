import test from "node:test";
import assert from "node:assert/strict";

import { juntarSenales, SIN_SENAL, type SenalDeIdentidad } from "./identidad.types";

const si: SenalDeIdentidad = { registrado: true, coincide: true, puntaje: 0.9, umbral: 0.6 };
const no: SenalDeIdentidad = { registrado: true, coincide: false, puntaje: 0.2, umbral: 0.6 };
/** Registrado pero no se pudo mirar: cámara tapada, micrófono mudo, worker caído. */
const noMiro: SenalDeIdentidad = { registrado: true, coincide: null, puntaje: null, umbral: 0.6 };

test("cara y voz de acuerdo dan confianza alta", () => {
  const v = juntarSenales(si, si);
  assert.equal(v.esElDueño, true);
  assert.equal(v.confianza, "alta");
  assert.match(v.resumen, /confirman su cara y su voz/);
});

test("una sola huella alcanza, pero con menos confianza", () => {
  for (const [cara, voz] of [[si, noMiro], [noMiro, si]] as const) {
    const v = juntarSenales(cara, voz);
    assert.equal(v.esElDueño, true);
    assert.equal(v.confianza, "media");
  }
});

test("si una dice que NO, el veredicto es negativo aunque la otra diga que sí", () => {
  // Es la regla que hace que el dato sirva: afirmar "es Esteban" con una de las dos
  // diciendo que no sería peor que no decir nada.
  const v = juntarSenales(si, no);
  assert.equal(v.esElDueño, false);
  assert.equal(v.confianza, "negativa");
  assert.match(v.resumen, /NO parece ser Esteban/);
});

test("sin nada que mirar el veredicto es null, no false", () => {
  // La distinción más importante de todo esto: "no pude ver" y "no sos vos" llevan a
  // decisiones opuestas. Confundirlas es lo que rompe estos sistemas.
  const v = juntarSenales(SIN_SENAL, SIN_SENAL);
  assert.equal(v.esElDueño, null);
  assert.equal(v.confianza, "nula");
});

test("registrado pero sin poder mirar tampoco es un no", () => {
  const v = juntarSenales(noMiro, noMiro);
  assert.equal(v.esElDueño, null);
  assert.equal(v.confianza, "nula");
});

test("el resumen le dice al agente qué hacer, no solo qué pasó", () => {
  // Va en prosa dentro de sus instrucciones: un booleano perdido entre veinte campos se
  // ignora, una frase que dice qué hacer se respeta.
  assert.match(juntarSenales(no, noMiro).resumen, /no cuentes nada personal/);
  assert.match(juntarSenales(SIN_SENAL, SIN_SENAL).resumen, /sin dar por hecho/);
});

test("el puntaje y el umbral viajan con la señal", () => {
  // Para poder calibrar después hace falta el número, no solo el veredicto.
  const v = juntarSenales(si, no);
  assert.equal(v.porCara.puntaje, 0.9);
  assert.equal(v.porVoz.puntaje, 0.2);
  assert.equal(v.porVoz.umbral, 0.6);
});
