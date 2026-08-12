import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeSurfaceIntentService } from "./runtime-surface-intent.service";

function fakeGroqClient(toolCall: { name: string; args?: Record<string, unknown> } | null) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                tool_calls: toolCall
                  ? [
                      {
                        function: {
                          name: toolCall.name,
                          arguments: JSON.stringify(toolCall.args ?? {}),
                        },
                      },
                    ]
                  : [],
              },
            },
          ],
        }),
      },
    },
  };
}

test("returns none for an empty message without calling the LLM", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(fakeGroqClient(null) as never);
  const result = await service.detect("   ");
  assert.equal(result.action, "none");
});

test("show_surface tool call with kind=map produces a show action with a map payload", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(
    fakeGroqClient({ name: "show_surface", args: { kind: "map", subject: "Café Central", address: "Café Central, Madrid" } }) as never,
  );
  const result = await service.detect("¿dónde queda el Café Central?");
  assert.equal(result.action, "show");
  if (result.action === "show") {
    assert.equal(result.payload.kind, "map");
    assert.equal(result.payload.location?.address, "Café Central, Madrid");
  }
});

test("show_surface tool call with kind=search produces a search payload with a query URL", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(
    fakeGroqClient({ name: "show_surface", args: { kind: "search", subject: "menú del restaurante" } }) as never,
  );
  const result = await service.detect("búscame el menú del restaurante");
  assert.equal(result.action, "show");
  if (result.action === "show") {
    assert.equal(result.payload.kind, "search");
    assert.equal(result.payload.query, "menú del restaurante");
    assert.ok(result.payload.url?.includes(encodeURIComponent("menú del restaurante")));
  }
});

test("show_surface tool call with kind=model3d produces a model3d payload", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(
    fakeGroqClient({ name: "show_surface", args: { kind: "model3d", subject: "una silla" } }) as never,
  );
  const result = await service.detect("renderízame un modelo 3d de una silla");
  assert.equal(result.action, "show");
  if (result.action === "show") {
    assert.equal(result.payload.kind, "model3d");
    assert.equal(result.payload.query, "una silla");
  }
});

test("clear_surface tool call produces a clear action", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(fakeGroqClient({ name: "clear_surface" }) as never);
  const result = await service.detect("cierra eso, gracias");
  assert.equal(result.action, "clear");
});

test("a successful LLM response with no tool call is trusted as-is, not overridden by the regex heuristic", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(fakeGroqClient(null) as never);
  const result = await service.detect("búscame el menú del restaurante");
  assert.equal(result.action, "none");
});

test("no tool call and no regex match returns none (ordinary conversation)", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(fakeGroqClient(null) as never);
  const result = await service.detect("hola, ¿cómo estás?");
  assert.equal(result.action, "none");
});

test("an unknown tool name returns none", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(fakeGroqClient({ name: "unrelated_tool" }) as never);
  const result = await service.detect("cualquier cosa");
  assert.equal(result.action, "none");
});

test("an invalid kind in show_surface args returns none", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting(fakeGroqClient({ name: "show_surface", args: { kind: "bogus", subject: "x" } }) as never);
  const result = await service.detect("cualquier cosa");
  assert.equal(result.action, "none");
});

test("malformed JSON arguments from the LLM returns none instead of throwing", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                tool_calls: [{ function: { name: "show_surface", arguments: "{not json" } }],
              },
            },
          ],
        }),
      },
    },
  } as never);
  const result = await service.detect("cualquier cosa");
  assert.equal(result.action, "none");
});

test("an LLM client that throws falls back to the regex heuristic instead of failing", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting({
    chat: {
      completions: {
        create: async () => {
          throw new Error("groq is down");
        },
      },
    },
  } as never);
  const result = await service.detect("búscame el menú del restaurante");
  assert.equal(result.action, "show");
  if (result.action === "show") assert.equal(result.payload.kind, "search");
});

test("clear_surface is not offered to the LLM when there is no active surface", async () => {
  const service = new RuntimeSurfaceIntentService();
  let seenToolNames: string[] = [];
  service.setClientForTesting({
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seenToolNames = (params.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
          return { choices: [{ message: { tool_calls: [] } }] };
        },
      },
    },
  } as never);

  await service.detect("hola", false);
  assert.deepEqual(seenToolNames, ["show_surface"]);
});

test("clear_surface is offered to the LLM when a surface is currently active", async () => {
  const service = new RuntimeSurfaceIntentService();
  let seenToolNames: string[] = [];
  service.setClientForTesting({
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seenToolNames = (params.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
          return { choices: [{ message: { tool_calls: [] } }] };
        },
      },
    },
  } as never);

  await service.detect("ciérralo", true);
  assert.deepEqual(seenToolNames, ["show_surface", "clear_surface"]);
});

test("when the LLM is unavailable and a surface is active, the regex clear-intent fallback applies", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting({
    chat: {
      completions: {
        create: async () => {
          throw new Error("groq is down");
        },
      },
    },
  } as never);
  const result = await service.detect("ciérralo, ya lo vi", true);
  assert.equal(result.action, "clear");
});

test("when the LLM is unavailable and there is no active surface, clear phrases resolve to none", async () => {
  const service = new RuntimeSurfaceIntentService();
  service.setClientForTesting({
    chat: {
      completions: {
        create: async () => {
          throw new Error("groq is down");
        },
      },
    },
  } as never);
  const result = await service.detect("ciérralo, ya lo vi", false);
  assert.equal(result.action, "none");
});

test("passes recent history to the LLM so it can resolve a follow-up answer", async () => {
  const service = new RuntimeSurfaceIntentService();
  let seenMessages: Array<{ role: string; content: string }> = [];
  service.setClientForTesting({
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seenMessages = params.messages as Array<{ role: string; content: string }>;
          return {
            choices: [
              {
                message: {
                  tool_calls: [
                    { function: { name: "show_surface", arguments: JSON.stringify({ kind: "map", address: "El Retiro, Madrid", subject: "El Retiro" }) } },
                  ],
                },
              },
            ],
          };
        },
      },
    },
  } as never);

  const result = await service.detect("El Retiro, Madrid", false, [
    { role: "user", content: "muéstrame en el fondo de la app" },
    { role: "assistant", content: "Claro. ¿Qué lugar quieres ver?" },
  ]);

  assert.equal(result.action, "show");
  // El historial se manda en orden, antes del mensaje final del usuario.
  const roles = seenMessages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
  assert.equal(seenMessages.at(-2)?.content, "Claro. ¿Qué lugar quieres ver?");
  assert.equal(seenMessages.at(-1)?.content, "El Retiro, Madrid");
});

test("only keeps the last 4 history turns to bound token usage", async () => {
  const service = new RuntimeSurfaceIntentService();
  let seenMessages: Array<{ role: string; content: string }> = [];
  service.setClientForTesting({
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          seenMessages = params.messages as Array<{ role: string; content: string }>;
          return { choices: [{ message: { tool_calls: [] } }] };
        },
      },
    },
  } as never);

  const longHistory = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn ${i}`,
  }));

  await service.detect("hola", false, longHistory);
  // system + 4 history turns + current user message = 6
  assert.equal(seenMessages.length, 6);
});

test("isLLMEnabled reflects an injected test client even without GROQ_API_KEY", () => {
  const service = new RuntimeSurfaceIntentService();
  assert.equal(service.isLLMEnabled(), Boolean(process.env.GROQ_API_KEY));
  service.setClientForTesting(fakeGroqClient(null) as never);
  assert.equal(service.isLLMEnabled(), true);
});
