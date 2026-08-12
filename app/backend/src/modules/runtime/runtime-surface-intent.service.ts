import { Injectable, Logger } from "@nestjs/common";
import Groq from "groq-sdk";

import { geocodeAddress } from "./runtime-geocode";
import type { RuntimeSurfacePayload } from "./runtime-events";
import { detectClearIntent, detectSurfaceIntent } from "./runtime-surface";

export type SurfaceIntentResult =
  | { action: "show"; payload: RuntimeSurfacePayload }
  | { action: "clear" }
  | { action: "none" };

type GroqLikeClient = {
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<{
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      }>;
    };
  };
};

const CLASSIFIER_MODEL = "llama-3.3-70b-versatile";

const SURFACE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "show_surface",
      description:
        "Show a visual surface (web search results, a map location, or a 3D model) inside Niki's UI, alongside the ongoing conversation. Call this ONLY when the user is explicitly asking to see, search for, find, look up, locate, or render something visual. Do NOT call it for greetings, small talk, or requests that don't need a visual result.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["search", "map", "model3d"],
            description:
              "search = web search results / lookup something (e.g. a menu, a document, general info). map = show a physical place/location. model3d = render a 3D model of an object.",
          },
          subject: {
            type: "string",
            description: "The short subject of the request, e.g. 'menú del restaurante', 'Café Central', 'una silla'.",
          },
          address: {
            type: "string",
            description: "For kind=map only: the place name or address to locate, as specific as possible.",
          },
        },
        required: ["kind", "subject"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clear_surface",
      description:
        "Dismiss/hide whatever visual surface is currently being shown. Call this when the user asks to close, hide, remove, or go back from what's on screen.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const CLASSIFIER_SYSTEM_PROMPT = [
  "Silent UI-intent classifier for Niki. Decide if the LAST user message needs a visual surface. Default: NO tool call — most messages are ordinary conversation.",
  "You may be given a short prior conversation for context — use it to resolve follow-up answers. If your last message asked a clarifying question (e.g. 'which place?', 'what would you like to see?') and the user's new message answers it (e.g. just a place name, an object), treat that combination as a direct request and call the tool.",
  "show_surface: only for a DIRECT request (or a direct answer to your own clarifying question) to find/search/show/locate/render something, not a mere mention. 'estoy pensando en comprar una silla' or 'tengo un mapa mental de X' → no call (statement, not a request). 'no encuentro mis llaves, ¿las has visto?' → no call (asking a person, not the web).",
  "clear_surface: only for an explicit close/hide/dismiss request ('ciérralo', 'quita eso'). Never for greetings or unrelated talk.",
  "Never explain. Only call a tool when clearly warranted, or call nothing.",
].join(" ");

export type SurfaceIntentHistoryMessage = { role: "user" | "assistant"; content: string };

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

@Injectable()
export class RuntimeSurfaceIntentService {
  private readonly logger = new Logger(RuntimeSurfaceIntentService.name);
  private client: GroqLikeClient | null = null;
  private overrideClient: GroqLikeClient | null = null;

  /** Solo para tests: inyecta un cliente Groq falso/determinista. */
  setClientForTesting(client: GroqLikeClient | null) {
    this.overrideClient = client;
  }

  private apiKey(): string {
    return String(process.env.GROQ_API_KEY ?? "").trim();
  }

  isLLMEnabled(): boolean {
    return Boolean(this.overrideClient) || Boolean(this.apiKey());
  }

  private getClient(): GroqLikeClient {
    if (this.overrideClient) return this.overrideClient;
    if (!this.client) {
      this.client = new Groq({ apiKey: this.apiKey() }) as unknown as GroqLikeClient;
    }
    return this.client;
  }

  /**
   * @param hasActiveSurface Si hay una surface visible ahora mismo. Cuando es false, no le
   * ofrecemos clear_surface al modelo — un modelo pequeño/mediano tiende a "alucinar" un
   * clear_surface en saludos o mensajes cortos si la herramienta está disponible aunque no
   * tenga sentido; quitarla de la lista cuando no aplica elimina la clase de error de raíz.
   */
  async detect(
    input: string,
    hasActiveSurface = false,
    history: SurfaceIntentHistoryMessage[] = [],
  ): Promise<SurfaceIntentResult> {
    const trimmed = input.trim();
    if (!trimmed) return { action: "none" };

    const llmResult = await this.detectWithLLM(trimmed, hasActiveSurface, history);
    if (llmResult) return llmResult;

    if (hasActiveSurface && detectClearIntent(trimmed)) {
      return { action: "clear" };
    }

    const regexPayload = detectSurfaceIntent(trimmed);
    if (regexPayload) {
      const enriched = await this.enrichWithGeocode(regexPayload);
      return { action: "show", payload: enriched };
    }

    return { action: "none" };
  }

  private async detectWithLLM(
    input: string,
    hasActiveSurface: boolean,
    history: SurfaceIntentHistoryMessage[],
  ): Promise<SurfaceIntentResult | null> {
    if (!this.isLLMEnabled()) return null;

    const tools = hasActiveSurface ? SURFACE_TOOLS : SURFACE_TOOLS.filter((t) => t.function.name !== "clear_surface");
    // Solo las últimas vueltas — suficiente para resolver un follow-up, sin inflar tokens.
    const contextTurns = history.slice(-4).map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));

    try {
      const response = await this.getClient().chat.completions.create({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
          ...contextTurns,
          { role: "user", content: input },
        ],
        tools,
        tool_choice: "auto",
        temperature: 0,
        max_tokens: 200,
        seed: 42,
      });

      const call = response.choices?.[0]?.message?.tool_calls?.[0];
      if (!call?.function?.name) return { action: "none" };

      if (call.function.name === "clear_surface") {
        return { action: "clear" };
      }

      if (call.function.name === "show_surface") {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          return { action: "none" };
        }

        const kind = args.kind;
        if (kind !== "search" && kind !== "map" && kind !== "model3d") return { action: "none" };

        const subject = typeof args.subject === "string" ? args.subject.trim() : "";
        const address = typeof args.address === "string" ? args.address.trim() : "";

        const payload: RuntimeSurfacePayload = {
          id: `surface:${Date.now()}:${randomId()}`,
          kind,
          title: this.titleFor(kind, subject || address),
          subtitle: subject || address || undefined,
          createdAt: new Date().toISOString(),
        };

        if (kind === "map") {
          payload.location = { label: address || subject, address: address || subject };
        } else if (kind === "search") {
          payload.query = subject;
          payload.url = subject ? `https://www.google.com/search?q=${encodeURIComponent(subject)}` : undefined;
        } else if (kind === "model3d") {
          payload.query = subject || undefined;
        }

        const enriched = await this.enrichWithGeocode(payload);
        return { action: "show", payload: enriched };
      }

      return { action: "none" };
    } catch (err) {
      this.logger.warn(`[surface-intent] LLM classification failed, falling back to heuristics: ${String(err)}`);
      return null;
    }
  }

  private async enrichWithGeocode(payload: RuntimeSurfacePayload): Promise<RuntimeSurfacePayload> {
    if (payload.kind !== "map" || !payload.location) return payload;
    const query = payload.location.address || payload.location.label;
    if (!query) return payload;

    const geocoded = await geocodeAddress(query);
    if (!geocoded) return payload;

    return {
      ...payload,
      location: {
        ...payload.location,
        lat: geocoded.lat,
        lng: geocoded.lng,
      },
    };
  }

  private titleFor(kind: RuntimeSurfacePayload["kind"], subject: string): string {
    if (kind === "map") return subject ? `Ubicación: ${subject}` : "Ubicación";
    if (kind === "model3d") return subject ? `Modelo 3D: ${subject}` : "Modelo 3D";
    return subject ? `Búsqueda: ${subject}` : "Búsqueda";
  }
}
