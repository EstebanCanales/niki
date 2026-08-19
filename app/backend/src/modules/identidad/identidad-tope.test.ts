import test from "node:test";
import assert from "node:assert/strict";

import { IdentidadService } from "./identidad.service";
import type { SenalDeIdentidad } from "./identidad.types";

/** Huellas de mentira: acá se prueba la memoria del servicio, no el reconocimiento. */
const huellaFalsa = { available: true, status: async () => ({ enrolled: false }) } as never;

const si: SenalDeIdentidad = { registrado: true, coincide: true, puntaje: 0.9, umbral: 0.6 };

function servicio() {
  return new IdentidadService(huellaFalsa, huellaFalsa);
}

test("recordar a muchas personas no crece para siempre", () => {
  // Un mapa sin tope es un mapa sin tope: hoy hay un usuario, pero alcanza con que
  // alguien mande un userId distinto en cada pedido para que crezca sin fin.
  const s = servicio();
  for (let i = 0; i < 300; i += 1) s.anotarCara(`persona-${i}`, si);

  const memoria = (s as unknown as { ultimo: Map<string, unknown> }).ultimo;
  assert.ok(memoria.size <= 50, `quedaron ${memoria.size} personas en memoria`);
  // La última tiene que seguir estando: se descarta lo viejo, no lo nuevo.
  assert.equal(s.veredicto("persona-299").esElDueño, true);
  assert.equal(s.veredicto("persona-0").esElDueño, null, "la más vieja se tuvo que caer");
});

test("un veredicto vencido no se sigue usando", () => {
  // Vale cinco minutos: alcanza para que una conversación entera se apoye en el
  // reconocimiento del principio, y es poco como para que quien se siente después
  // herede la sesión del anterior.
  const s = servicio();
  s.anotarCara("x", si);
  assert.equal(s.veredicto("x").esElDueño, true);

  const memoria = (s as unknown as { ultimo: Map<string, { at: number }> }).ultimo;
  const guardado = memoria.get("x")!;
  guardado.at = Date.now() - 6 * 60_000;

  assert.equal(s.veredicto("x").esElDueño, null, "pasados los cinco minutos ya no se sabe");
});

test("olvidar borra lo que se sabía de esa persona y de nadie más", () => {
  const s = servicio();
  s.anotarCara("a", si);
  s.anotarCara("b", si);
  s.olvidar("a");

  assert.equal(s.veredicto("a").esElDueño, null);
  assert.equal(s.veredicto("b").esElDueño, true);
});
