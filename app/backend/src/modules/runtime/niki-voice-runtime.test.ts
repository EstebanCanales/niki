import assert from "node:assert/strict";
import test from "node:test";

import { NikiVoiceRuntimeService } from "./niki-voice-runtime.service";

/**
 * El router decide qué turno contesta la ruta rápida (~300ms) y cuál se va a Hermes
 * (3-11s). Equivocarse hacia el lado lento cuesta una charla trivial de 10 segundos;
 * hacia el lado rápido, una respuesta que promete algo que no puede hacer. Por eso los
 * casos de abajo son los dos lados, no solo el feliz.
 */

function service() {
  return new NikiVoiceRuntimeService();
}

test("las frases de charla van por la ruta rápida", () => {
  const s = service();
  for (const input of [
    "¿qué hora es?",
    "hola Niki, ¿cómo andás?",
    "contame algo del océano",
    "¿cuál es la capital de Francia?",
    "gracias, buenísimo",
    "explicame qué es un pasa-altos",
  ]) {
    assert.equal(s.needsFullAgent(input), false, `debería ser rápida: "${input}"`);
  }
});

test("los pedidos que necesitan herramientas se escalan a Hermes", () => {
  const s = service();
  for (const input of [
    "abrime el Canva",
    "abre la aplicación de Spotify",
    "buscame el archivo de la propuesta",
    "hacé clic en el botón de la pantalla",
    "tomá una captura de pantalla",
    "creá una tarea para mañana",
    "mandá un mail a Esteban",
    "corré los tests",
  ]) {
    assert.equal(s.needsFullAgent(input), true, `debería escalar: "${input}"`);
  }
});

test("mencionar algo no es pedirlo — no escala por una palabra suelta", () => {
  const s = service();
  // El riesgo del detector por patrones es disparar con la mención en vez del pedido.
  for (const input of [
    "ayer estuve usando Canva y me gustó",
    "me encanta la pantalla de esta Mac",
    "tengo una tarea pendiente en la cabeza",
  ]) {
    assert.equal(s.needsFullAgent(input), false, `no debería escalar: "${input}"`);
  }
});

test("sin clave de Groq el runtime se declara apagado y el turno cae a Hermes", () => {
  const previous = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    assert.equal(service().isEnabled(), false);
  } finally {
    if (previous !== undefined) process.env.GROQ_API_KEY = previous;
  }
});

test("stream devuelve los fragmentos tal como llegan del modelo", async () => {
  const s = service();
  s.setClientForTesting({
    chat: {
      completions: {
        create: async () =>
          (async function* () {
            yield { choices: [{ delta: { content: "Son " } }] };
            yield { choices: [{ delta: { content: "las tres." } }] };
            yield { choices: [{ delta: { content: null } }] };
          })(),
      },
    },
  });

  const parts: string[] = [];
  for await (const delta of s.stream("¿qué hora es?")) parts.push(delta);

  assert.deepEqual(parts, ["Son ", "las tres."]);
});

test("el historial se recorta y el turno actual va último", async () => {
  const s = service();
  let sent: Record<string, unknown> = {};
  s.setClientForTesting({
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          sent = params;
          return (async function* () {
            yield { choices: [{ delta: { content: "ok" } }] };
          })();
        },
      },
    },
  });

  const history = Array.from({ length: 20 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turno ${i}`,
  }));
  for await (const _ of s.stream("lo último que dije", history)) void _;

  const messages = sent.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].role, "system", "el prompt de sistema va primero");
  assert.ok(messages.length <= 10, `el historial debe acotarse, llegaron ${messages.length}`);
  assert.equal(messages.at(-1)?.content, "lo último que dije");
  assert.ok((sent.max_tokens as number) > 0, "hay tope de longitud para que no monologue");
  assert.equal(sent.stream, true);
});
