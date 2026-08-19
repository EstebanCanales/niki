import test from "node:test";
import assert from "node:assert/strict";

import { projectRuntimeCapabilities } from "./runtime-capabilities";

/**
 * Todo panel que la app pueda mostrar en el dock tiene que estar declarado acá.
 *
 * Existe por un error concreto: se agregaron la consola, la terminal y el panel de
 * identidad, con sus vistas, sus rutas y sus casos en el switch — y no aparecían en el
 * dock. El motivo era que un módulo que no está en esta proyección se considera `hidden`,
 * así que los tres estaban invisibles y todo lo demás compilaba y pasaba.
 *
 * Este test no puede leer el Swift, así que la lista se mantiene a mano; pero al menos
 * falla ruidosamente cuando alguien agrega un panel y se olvida de la otra mitad.
 */
const MODULOS_DEL_DOCK = [
  "chat",
  "computer",
  "approvals",
  "sessions",
  "mcp",
  "discover",
  "diagnostics",
  "consola",
  "terminal",
  "identidad",
  "verme",
  "settings",
];

function proyectar(extra: Record<string, unknown> = {}) {
  return projectRuntimeCapabilities({
    hermes: {
      computerUse: true,
      approvals: true,
      mcpCatalog: true,
      xSearch: true,
      videoGenerate: true,
      remoteSessions: true,
      lspDiagnostics: true,
    },
    flags: {
      computer: true,
      approvals: true,
      mcp: true,
      discover: true,
      sessions: true,
      diagnostics: true,
    },
    ...extra,
  });
}

test("todos los paneles del dock están declarados", () => {
  const modulos = proyectar({ identidadDisponible: true }).modules;
  for (const nombre of MODULOS_DEL_DOCK) {
    assert.ok(modulos[nombre], `falta declarar el módulo "${nombre}" — la app lo esconde`);
  }
});

test("la consola y la terminal no dependen de Hermes", () => {
  // Una muestra el flujo de eventos, que existe siempre; la otra la sirve el propio
  // backend. Con Hermes entero caído las dos tienen que seguir estando — de hecho es
  // cuando más falta hacen.
  const modulos = projectRuntimeCapabilities({
    hermes: {
      computerUse: false, approvals: false, mcpCatalog: false, xSearch: false,
      videoGenerate: false, remoteSessions: false, lspDiagnostics: false,
    },
    flags: {
      computer: false, approvals: false, mcp: false,
      discover: false, sessions: false, diagnostics: false,
    },
  }).modules;

  assert.equal(modulos.consola.state, "ready");
  assert.equal(modulos.terminal.state, "ready");
});

test("identidad aparece solo si hay con qué reconocer", () => {
  assert.equal(proyectar({ identidadDisponible: true }).modules.identidad.state, "ready");
  // Sin los entornos, el panel serían dos carteles diciendo que no está instalado.
  assert.equal(proyectar({ identidadDisponible: false }).modules.identidad.state, "hidden");
});

test("se pueden apagar desde el backend sin tocar la app", () => {
  const modulos = projectRuntimeCapabilities({
    hermes: {
      computerUse: true, approvals: true, mcpCatalog: true, xSearch: true,
      videoGenerate: true, remoteSessions: true, lspDiagnostics: true,
    },
    flags: {
      computer: true, approvals: true, mcp: true, discover: true,
      sessions: true, diagnostics: true,
      consola: false, terminal: false,
    },
  }).modules;

  assert.equal(modulos.consola.state, "hidden");
  assert.equal(modulos.terminal.state, "hidden");
});
