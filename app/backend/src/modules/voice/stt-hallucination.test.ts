import assert from "node:assert/strict";
import test from "node:test";

import {
  esAlucinacion,
  esBucleRepetido,
  esFraseInventada,
  textoDeSegmentosConfiables,
} from "./stt-hallucination";

/**
 * Los casos de abajo no son inventados: salieron del log de las pruebas de voz, cuando
 * ruido de sala llegaba a Niki como frases y ella respondía en serio.
 */

test("atrapa las frases que Whisper inventa sobre silencio", () => {
  for (const t of [
    "Gracias.",
    "gracias",
    "Subtítulos realizados por la comunidad de Amara.org",
    "¡Gracias por ver el video!",
    "...",
    "♪",
    "[Música]",
  ]) {
    assert.equal(esFraseInventada(t), true, `debería marcarse: "${t}"`);
  }
});

test("no marca habla real que se le parece", () => {
  for (const t of [
    "gracias por el dato, seguí",
    "poné música",
    "gracias, ahora contame otra cosa",
  ]) {
    assert.equal(esFraseInventada(t), false, `no debería marcarse: "${t}"`);
  }
});

test("atrapa los bucles de repetición", () => {
  assert.equal(esBucleRepetido("No, no, no, no, no."), true);
  assert.equal(esBucleRepetido("sí sí sí sí sí sí"), true);
  assert.equal(esBucleRepetido("eh eh eh eh eh eh sí"), true);
});

test("no marca la repetición enfática, que es habla normal", () => {
  // Esto lo dice cualquiera. Marcarlo sería peor que dejar pasar un bucle.
  assert.equal(esBucleRepetido("no, no"), false);
  assert.equal(esBucleRepetido("pará, pará"), false);
  assert.equal(esBucleRepetido("dale dale, contame"), false);
});

test("descarta segmentos por las señales que reporta Whisper", () => {
  const segmentos = [
    { text: "hola Niki", no_speech_prob: 0.1, compression_ratio: 1.2, avg_logprob: -0.3 },
    { text: "ruido", no_speech_prob: 0.9, compression_ratio: 1.1, avg_logprob: -0.2 },
    { text: "bucle bucle bucle", no_speech_prob: 0.1, compression_ratio: 3.5, avg_logprob: -0.2 },
    { text: "adivinando", no_speech_prob: 0.1, compression_ratio: 1.1, avg_logprob: -2.5 },
  ];
  assert.equal(textoDeSegmentosConfiables(segmentos), "hola Niki");
});

test("si ningún segmento es confiable, no se inventa texto", () => {
  const segmentos = [
    { text: "Gracias.", no_speech_prob: 0.95, compression_ratio: 1.0, avg_logprob: -0.1 },
  ];
  assert.equal(textoDeSegmentosConfiables(segmentos), "");
});

test("un segmento sin métricas se acepta — no todos los proveedores las mandan", () => {
  // whisper-server local no devuelve avg_logprob. Descartar por ausencia dejaría a Niki
  // sorda cuando Groq falla y entra el fallback.
  assert.equal(textoDeSegmentosConfiables([{ text: "hola" }]), "hola");
});

test("el veredicto final junta las dos vías", () => {
  assert.equal(esAlucinacion(""), true);
  assert.equal(esAlucinacion("   "), true);
  assert.equal(esAlucinacion("Gracias."), true);
  assert.equal(esAlucinacion("No, no, no, no, no."), true);
  assert.equal(esAlucinacion("¿Cuál es la capital de Francia?"), false);
});

test("descarta cuando el modelo solo devuelve el vocabulario que le pasamos", () => {
  // Medido de verdad: con prompt="Niki. Esteban." sobre un tono puro, Groq devolvió
  // "Esteban.". El sesgo de vocabulario ayuda con voz y estorba con ruido.
  const vocab = ["Niki", "Esteban"];
  assert.equal(esAlucinacion("Esteban.", vocab), true);
  assert.equal(esAlucinacion("Niki", vocab), true);
  assert.equal(esAlucinacion("Niki Esteban", vocab), true);
});

test("una frase real que contiene el vocabulario sí pasa", () => {
  const vocab = ["Niki", "Esteban"];
  assert.equal(esAlucinacion("Niki, contame algo", vocab), false);
  assert.equal(esAlucinacion("hola Esteban qué tal", vocab), false);
});

test("sin vocabulario el comportamiento no cambia", () => {
  assert.equal(esAlucinacion("Esteban."), false);
});
