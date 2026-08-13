import { Injectable, Logger } from "@nestjs/common";
import Groq from "groq-sdk";

/**
 * Runtime conversacional de Niki para el canal de voz.
 *
 * Por qué existe: Hermes no es un modelo, es un agente. Corre con
 * `reasoning_effort: medium`, `max_turns: 60` y su toolset entero cargado en cada turno,
 * contra un Kimi remoto. Eso da 3-11 s hasta el primer token — perfectamente razonable
 * para "abrime el Canva y ordename los archivos", e inaceptable para "¿qué hora es?".
 *
 * Este runtime es lo contrario: sin bucle de agente, sin herramientas, sin razonamiento,
 * prompt corto y un modelo rápido. Solo conversa. Todo lo que huela a trabajo de verdad
 * se escala a Hermes, que para eso está.
 *
 * (Se evaluó levantar un segundo Hermes configurado para ser rápido. No sale: Hermes no
 * tiene a Groq entre sus proveedores de inferencia — el `groq` que aparece en su código
 * es para su propio STT — y su `base_url` custom solo aplica a tareas auxiliares. Y aun
 * resolviéndolo, lo valioso de Hermes son justo las piezas que acá sobran.)
 */

type GroqStreamChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
};

type GroqLikeClient = {
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<AsyncIterable<GroqStreamChunk>>;
    };
  };
};

/** Rápido y suficientemente bueno para conversar. ~300ms hasta el primer token. */
const VOICE_MODEL = "llama-3.3-70b-versatile";

/**
 * Tope de generación. Niki llegó a monologar 57 segundos seguidos: en voz, largo no es
 * generoso, es insoportable — no podés hojear lo que te están diciendo.
 */
const MAX_VOICE_TOKENS = 220;

/** Cuántos turnos previos se mandan. Más historial es prefill que se paga en cada turno. */
const HISTORY_TURNS = 8;

const VOICE_SYSTEM_PROMPT = [
  "Sos Niki, la asistente de Esteban. Estás en una conversación hablada: lo que escribas se va a leer en voz alta.",
  "Respondé corto y directo, como en una charla real — una o dos frases salvo que te pidan explayarte.",
  "Nada de listas, viñetas, markdown, emojis ni encabezados: no se pueden pronunciar.",
  "Escribí los números y símbolos como se dicen ('veinte por ciento', no '20%').",
  "Si no sabés algo, decilo en una frase. No inventes datos ni finjas haber hecho algo.",
  "Hablás español rioplatense, natural y sin solemnidad.",
].join(" ");

export type VoiceTurnMessage = { role: "user" | "assistant"; content: string };

/**
 * Pedidos que esta ruta no puede cumplir: necesitan las herramientas de Hermes.
 * Es deliberadamente conservador — ante la duda, contesta la ruta rápida. Un falso
 * positivo manda una charla trivial por el camino lento de 10 segundos; un falso
 * negativo lo arregla el escalado, que se dispara igual desde la app.
 */
const NEEDS_TOOLS = [
  /\b(abr[ií]|abre|abrime|cerr[aá]|cierra)\s+(el|la|los|las)?\s*\w*\s*(app|aplicaci[oó]n|canva|chrome|safari|spotify|finder|terminal|xcode|slack|notion|figma)\b/i,
  /\b(busc[aá]|buscame|encontr[aá]|abr[ií])\s+(el|la|los|las|un|una|mis?)\s*(archivo|carpeta|documento|pdf|foto|captura)/i,
  /\b(clic|click|hac[eé] clic|escrib[ií] en|apret[aá]|toc[aá])\b.*\b(pantalla|bot[oó]n|ventana)\b/i,
  /\b(captur[aá]|screenshot|pantallazo|grab[aá] la pantalla)\b/i,
  /\b(cre[aá]|agreg[aá]|añad[ií]|borr[aá]|elimin[aá])\s+(una?\s+)?(tarea|recordatorio|evento|nota|work item)\b/i,
  /\b(mand[aá]|envi[aá])\s+(un\s+)?(mail|correo|email|mensaje|whatsapp)\b/i,
  /\b(corr[eé]|ejecut[aá])\s+(el|la|los|las)?\s*(comando|script|test|build|prueba)s?\b/i,
  /\b(mcp|skill|herramienta|toolset)\b/i,
];

@Injectable()
export class NikiVoiceRuntimeService {
  private readonly logger = new Logger(NikiVoiceRuntimeService.name);
  private client: GroqLikeClient | null = null;
  private overrideClient: GroqLikeClient | null = null;

  /** Solo para tests: inyecta un cliente Groq falso/determinista. */
  setClientForTesting(client: GroqLikeClient | null) {
    this.overrideClient = client;
  }

  private apiKey(): string {
    return String(process.env.GROQ_API_KEY ?? "").trim();
  }

  isEnabled(): boolean {
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
   * ¿Este turno pide algo que la ruta rápida no puede hacer? Sin red y sin modelo:
   * decidirlo con una llamada extra costaría justo el tiempo que se quiere ahorrar.
   */
  needsFullAgent(input: string): boolean {
    const text = String(input ?? "");
    return NEEDS_TOOLS.some((pattern) => pattern.test(text));
  }

  /**
   * Genera la respuesta hablada token a token.
   *
   * `onDelta` recibe cada fragmento nuevo (no el acumulado): quien llama decide si lo
   * acumula, y así el SSE de `proxyChatStream` se arma igual que con Hermes.
   */
  async *stream(
    input: string,
    history: VoiceTurnMessage[] = [],
    personaHint?: string,
  ): AsyncGenerator<string, void, unknown> {
    const system = personaHint?.trim()
      ? `${VOICE_SYSTEM_PROMPT} ${personaHint.trim()}`
      : VOICE_SYSTEM_PROMPT;

    const messages = [
      { role: "system" as const, content: system },
      ...history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: input },
    ];

    const startedAt = performance.now();
    let firstTokenMs = 0;
    let chars = 0;

    const stream = await this.getClient().chat.completions.create({
      model: VOICE_MODEL,
      messages,
      max_tokens: MAX_VOICE_TOKENS,
      temperature: 0.6,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;
      if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - startedAt);
      chars += delta.length;
      yield delta;
    }

    this.logger.log(
      `[voz] ruta rápida ttft=${firstTokenMs}ms total=${Math.round(performance.now() - startedAt)}ms chars=${chars}`,
    );
  }
}
