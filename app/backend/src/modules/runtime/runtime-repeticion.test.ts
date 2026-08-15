import test from "node:test";
import assert from "node:assert/strict";

import { normalizar, parecido, preguntaRepetida } from "./runtime-repeticion";

test("normalizar borra tildes, signos y mayúsculas", () => {
  assert.equal(normalizar("¿Qué hora es?"), "que hora es");
  assert.equal(normalizar("QUÉ   HORA  ES!!"), "que hora es");
  // La ñ pierde la tilde a propósito: el reconocimiento de voz escribe las dos formas y
  // tienen que contar como la misma palabra.
  assert.equal(normalizar("Mañana"), "manana");
  assert.equal(parecido("nos vemos mañana", "nos vemos manana"), 1);
});

test("la misma pregunta escrita distinto se detecta", () => {
  const historial = [
    { role: "user", content: "¿cuánto está el dólar blue?" },
    { role: "assistant", content: "Mil doscientos." },
  ];
  assert.ok(preguntaRepetida(historial, "cuanto esta el dolar blue"));
});

test("una pregunta distinta no se marca como repetición", () => {
  const historial = [
    { role: "user", content: "¿cuánto está el dólar?" },
    { role: "assistant", content: "Mil doscientos." },
  ];
  assert.equal(preguntaRepetida(historial, "¿cómo está el clima mañana?"), null);
});

test("las palabras de relleno no alcanzan para parecerse", () => {
  // Sin sacar las vacías, estas dos comparten "me", "la", "el", "por" y darían repetición.
  const historial = [{ role: "user", content: "che, me pasás la hora por favor" }];
  assert.equal(preguntaRepetida(historial, "che, me pasás el clima por favor"), null);
});

test("solo mira las últimas preguntas, no la conversación entera", () => {
  const historial = [
    { role: "user", content: "contame del dólar blue" },
    { role: "user", content: "ahora contame del clima" },
    { role: "user", content: "y de spotify" },
    { role: "user", content: "y del notch" },
    { role: "user", content: "y del micrófono" },
  ];
  // Volver a un tema cinco preguntas después es otra conversación, no repreguntar.
  assert.equal(preguntaRepetida(historial, "contame del dólar blue"), null);
});

test("devuelve la pregunta anterior que coincide, no solo true", () => {
  const historial = [{ role: "user", content: "¿cuánto está el dólar blue?" }];
  assert.equal(preguntaRepetida(historial, "dolar blue cuanto esta"), "¿cuánto está el dólar blue?");
});

test("las respuestas del asistente no cuentan como preguntas", () => {
  const historial = [{ role: "assistant", content: "¿cuánto está el dólar blue?" }];
  assert.equal(preguntaRepetida(historial, "¿cuánto está el dólar blue?"), null);
});

test("parecido va de 0 a 1", () => {
  assert.equal(parecido("hola mundo", "hola mundo"), 1);
  assert.equal(parecido("hola", "chau"), 0);
  assert.equal(parecido("", "hola"), 0);
});
