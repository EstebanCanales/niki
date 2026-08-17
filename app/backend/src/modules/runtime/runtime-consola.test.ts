import test from "node:test";
import assert from "node:assert/strict";

import { esRuidoDeConsola, etiquetaDeHerramienta } from "./runtime-consola";

test("los deltas de texto no entran a la consola", () => {
  // Medido en un turno de una sola herramienta: once de veinte eventos eran deltas. En una
  // conversación real empujan fuera de la pantalla lo único que uno vino a buscar.
  assert.ok(esRuidoDeConsola("message.delta"));
  assert.ok(esRuidoDeConsola("reasoning.delta"));
});

test("lo que importa sí entra", () => {
  for (const tipo of ["tool.started", "tool.completed", "run.completed", "error", "approval.request"]) {
    assert.ok(!esRuidoDeConsola(tipo), `${tipo} tendría que entrar`);
  }
});

test("un evento de herramienta muestra qué corrió, no 'Tool Started'", () => {
  const e = etiquetaDeHerramienta("tool.started", {
    tool: "terminal",
    preview: "echo consola-viva",
  });
  assert.equal(e?.titulo, "terminal");
  assert.equal(e?.resumen, "echo consola-viva");
});

test("al terminar muestra cuánto tardó y si falló", () => {
  const ok = etiquetaDeHerramienta("tool.completed", { tool: "terminal", duration: 0.523, error: false });
  assert.equal(ok?.titulo, "terminal terminó");
  assert.equal(ok?.resumen, "0.52 s");

  const mal = etiquetaDeHerramienta("tool.completed", { tool: "web_search", duration: 2, error: true });
  assert.equal(mal?.titulo, "web_search falló");
});

test("sin vista previa lo dice en vez de quedar vacío", () => {
  const e = etiquetaDeHerramienta("tool.started", { tool: "memory" });
  assert.equal(e?.resumen, "sin vista previa");
});

test("lo que no es de herramienta se deja con su etiqueta de siempre", () => {
  assert.equal(etiquetaDeHerramienta("run.completed", { tool: "terminal" }), null);
  assert.equal(etiquetaDeHerramienta("tool.started", null), null);
  // Un JSON de herramienta sin el nombre no sirve para etiquetar nada.
  assert.equal(etiquetaDeHerramienta("tool.started", { preview: "algo" }), null);
});
