import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeSurfaceIntentService } from "./runtime-surface-intent.service";

// Prueba de integración real contra Groq (sin mocks) — mide precisión real del
// clasificador de intención con frases representativas en español e inglés,
// incluidas las variantes exactas que pidió el usuario. Se salta si no hay GROQ_API_KEY.
const hasKey = Boolean(String(process.env.GROQ_API_KEY ?? "").trim());

type Case = {
  input: string;
  expectAction: "show" | "clear" | "none";
  expectKind?: "search" | "map" | "model3d";
  hasActiveSurface?: boolean;
};

const CASES: Case[] = [
  { input: "quiero que me busques el menú del restaurante", expectAction: "show", expectKind: "search" },
  { input: "quiero que me muestres dónde queda el Café Central", expectAction: "show", expectKind: "map" },
  { input: "quiero que me renderices un modelo 3d de una silla", expectAction: "show", expectKind: "model3d" },
  { input: "¿dónde queda la Torre Eiffel?", expectAction: "show", expectKind: "map" },
  { input: "búscame información sobre gatos persas", expectAction: "show", expectKind: "search" },
  { input: "muéstrame un modelo 3d de un carro deportivo", expectAction: "show", expectKind: "model3d" },
  { input: "hola, ¿cómo estás hoy?", expectAction: "none" },
  { input: "gracias por tu ayuda con eso de ayer", expectAction: "none" },
  { input: "creo que deberíamos hablar de mi agenda de mañana", expectAction: "none" },
  { input: "ciérralo, ya lo vi", expectAction: "clear", hasActiveSurface: true },
  { input: "quita eso de la pantalla", expectAction: "clear", hasActiveSurface: true },
  { input: "can you show me a 3d model of a guitar?", expectAction: "show", expectKind: "model3d" },
  { input: "where is the nearest coffee shop?", expectAction: "show", expectKind: "map" },
  { input: "tengo un mapa mental de todo el proyecto en mi cabeza", expectAction: "none" },
  { input: "búscame cómo se dice 'gracias' en japonés", expectAction: "show", expectKind: "search" },
  { input: "no encuentro mis llaves, ¿las has visto?", expectAction: "none" },
  { input: "enséñame en el mapa cómo llegar a la playa más cercana", expectAction: "show", expectKind: "map" },
  { input: "estoy pensando en comprar una silla nueva para mi oficina", expectAction: "none" },
  { input: "ciérralo, ya lo vi", expectAction: "none", hasActiveSurface: false },
];

test("live: RuntimeSurfaceIntentService classifies representative phrases accurately", { skip: !hasKey }, async (t) => {
  const service = new RuntimeSurfaceIntentService();
  let correct = 0;

  for (const testCase of CASES) {
    await t.test(testCase.input, async () => {
      const result = await service.detect(testCase.input, testCase.hasActiveSurface ?? false);
      assert.equal(
        result.action,
        testCase.expectAction,
        `expected action=${testCase.expectAction} for: "${testCase.input}", got ${JSON.stringify(result)}`,
      );
      if (result.action === "show" && testCase.expectKind) {
        assert.equal(
          result.payload.kind,
          testCase.expectKind,
          `expected kind=${testCase.expectKind} for: "${testCase.input}", got ${result.payload.kind}`,
        );
      }
      correct += 1;
    });
  }

  t.diagnostic(`${correct}/${CASES.length} cases matched expected action+kind`);
});
