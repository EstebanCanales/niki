import assert from "node:assert/strict";
import { test } from "node:test";

import { detectClearIntent, detectSurfaceIntent } from "./runtime-surface";

test("detects a map intent from a location question", () => {
  const result = detectSurfaceIntent("¿Dónde queda el Café Central?");
  assert.ok(result);
  assert.equal(result?.kind, "map");
  assert.equal(result?.location?.label, "el Café Central");
});

test("detects a search intent from búscame", () => {
  const result = detectSurfaceIntent("búscame el menú del restaurante");
  assert.ok(result);
  assert.equal(result?.kind, "search");
  assert.ok(result?.url?.includes("google.com/search"));
});

test("detects a model3d intent from renderízame un modelo 3d", () => {
  const result = detectSurfaceIntent("renderízame un modelo 3d de una silla");
  assert.ok(result);
  assert.equal(result?.kind, "model3d");
  assert.equal(result?.query, "una silla");
});

test("detects a model3d intent from render 3d", () => {
  const result = detectSurfaceIntent("render 3d de una silla");
  assert.ok(result);
  assert.equal(result?.kind, "model3d");
});

test("returns null for unrelated chat input", () => {
  const result = detectSurfaceIntent("hola, ¿cómo estás hoy?");
  assert.equal(result, null);
});

test("detects an English map intent", () => {
  const result = detectSurfaceIntent("where is the nearest coffee shop?");
  assert.ok(result);
  assert.equal(result?.kind, "map");
});

test("detects an English search intent", () => {
  const result = detectSurfaceIntent("search for the best pizza in town");
  assert.ok(result);
  assert.equal(result?.kind, "search");
});

test("detects an English model3d intent", () => {
  const result = detectSurfaceIntent("show me a 3d model of a guitar");
  assert.ok(result);
  assert.equal(result?.kind, "model3d");
  assert.equal(result?.query, "a guitar");
});

test("detects a subjunctive search intent (quiero que me busques X)", () => {
  const result = detectSurfaceIntent("quiero que me busques el menú del restaurante");
  assert.ok(result);
  assert.equal(result?.kind, "search");
  assert.equal(result?.query, "menú del restaurante");
});

test("detects a map intent using enséñame instead of muéstrame", () => {
  const result = detectSurfaceIntent("enséñame cómo llegar a la playa más cercana");
  assert.ok(result);
  assert.equal(result?.kind, "map");
});

test("detectClearIntent recognizes explicit dismiss phrases in Spanish", () => {
  assert.equal(detectClearIntent("ciérralo, ya lo vi"), true);
  assert.equal(detectClearIntent("quita eso de la pantalla"), true);
  assert.equal(detectClearIntent("esconde el mapa"), true);
});

test("detectClearIntent recognizes explicit dismiss phrases in English", () => {
  assert.equal(detectClearIntent("close it please"), true);
  assert.equal(detectClearIntent("hide this"), true);
});

test("detectClearIntent returns false for ordinary conversation", () => {
  assert.equal(detectClearIntent("hola, ¿cómo estás?"), false);
  assert.equal(detectClearIntent("gracias por tu ayuda"), false);
});
