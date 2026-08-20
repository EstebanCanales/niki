import test from "node:test";
import assert from "node:assert/strict";

import { construirEntrada } from "./runtime.service";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("sin imagen manda el texto de siempre", () => {
  assert.equal(construirEntrada("hola"), "hola");
  assert.equal(construirEntrada("hola", undefined), "hola");
  assert.equal(construirEntrada("hola", ""), "hola");
});

test("con imagen manda un mensaje, no una lista de partes", () => {
  // Distinción que costó un 400: en `/v1/runs`, `input` es una lista de MENSAJES.
  // Mandar las partes sueltas da "No user message found in input".
  const entrada = construirEntrada("¿me ves?", PNG) as any[];
  assert.equal(entrada.length, 1);
  assert.equal(entrada[0].role, "user");
  assert.equal(entrada[0].content[0].text, "¿me ves?");
  assert.equal(entrada[0].content[1].image_url.url, PNG);
});

test("solo data URLs de imagen", () => {
  // Un file:// o un http:// harían que el runtime abra un archivo del disco o salga a
  // la red porque se lo pidió quien mandó el turno. Recibir un cuadro no puede ser
  // también una forma de hacerle buscar cosas.
  for (const malo of [
    "file:///etc/passwd",
    "http://interno/algo.png",
    "https://ejemplo.com/x.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",   // SVG lleva script adentro
    "javascript:alert(1)",
  ]) {
    assert.equal(construirEntrada("hola", malo), "hola", `dejó pasar ${malo}`);
  }
});

test("acepta los formatos que saca una cámara", () => {
  for (const bueno of ["png", "jpeg", "jpg", "webp"]) {
    const r = construirEntrada("x", `data:image/${bueno};base64,AAAA`);
    assert.ok(Array.isArray(r), `rechazó ${bueno}`);
  }
});
