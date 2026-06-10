import { Inject, Injectable, Logger } from "@nestjs/common";
import Groq from "groq-sdk";

import { ComputerControlService, type ActionContext } from "../computer/computer-control.service";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

export type AgentHooks = {
  onText: (delta: string) => void;
  onToolStart?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, ok: boolean, summary: string) => void;
  onStatus?: (label: string, summary: string) => void;
  signal?: { aborted: boolean };
};

export type AgentPreferences = {
  notificationsEnabled?: boolean;
  disabledTools?: string[];
};

export type AgentRunInput = {
  input: string;
  history?: Array<{ role: string; content: string }>;
  instructions?: string;
  preferences?: AgentPreferences;
  ctx: ActionContext;
};

export type AgentRunResult = {
  ok: boolean;
  text: string;
  toolCalls: number;
  iterations: number;
  error?: string;
};

const MAX_ITERATIONS = 10;
const MAX_TOOL_CALLS = 24;
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

@Injectable()
export class GroqAgentService {
  private readonly logger = new Logger(GroqAgentService.name);
  private client: Groq | null = null;

  constructor(
    @Inject(ComputerControlService)
    private readonly computer: ComputerControlService,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.apiKey());
  }

  model(): string {
    return String(process.env.GROQ_MODEL ?? "").trim() || DEFAULT_MODEL;
  }

  private apiKey(): string {
    return String(process.env.GROQ_API_KEY ?? "").trim();
  }

  private getClient(): Groq {
    if (!this.client) {
      this.client = new Groq({ apiKey: this.apiKey() });
    }
    return this.client;
  }

  private buildSystemPrompt(extra?: string, prefs?: AgentPreferences): string {
    const config = this.computer.getConfig();
    const disabledList = prefs?.disabledTools ?? [];
    const notificationsOff = prefs?.notificationsEnabled === false;
    if (notificationsOff && !disabledList.includes("notify")) disabledList.push("notify");

    const lines = [
      "You are Niki, a personal AI assistant running on the user's Mac.",
      "You have access to tools that control the computer, but you must use them ONLY when the user explicitly asks for something actionable.",
      "For greetings, casual conversation, or questions that don't require computer actions, respond naturally and conversationally — do NOT call any tools.",
      "Examples: 'Hola' → greet back warmly; 'cómo estás' → answer conversationally; 'abre Safari' → use app_launch; 'qué tengo en el correo' → use mail_read.",
      "Always respond in the user's language (default: Spanish).",
      "When you do use tools: be concise, chain calls when needed, and confirm briefly what you did.",
      "Coordinates are absolute screen pixels, top-left origin. Take a screenshot first if you need to see the screen.",
      `Current control mode: ${config.mode}.`,
      "High-risk tools (shell_exec, app_quit, fs_write, applescript_run) require confirm=true in params — only add it when the user clearly authorized that action.",
      "If a tool returns requiresConfirmation, explain what needs confirming instead of retrying.",
    ];
    if (disabledList.length > 0) {
      lines.push(`Disabled tools (do not call): ${disabledList.join(", ")}.`);
    }
    if (extra && extra.trim()) lines.push(extra.trim());
    return lines.join(" ");
  }

  async run(input: AgentRunInput, hooks: AgentHooks): Promise<AgentRunResult> {
    if (!this.isEnabled()) {
      return { ok: false, text: "", toolCalls: 0, iterations: 0, error: "GROQ_API_KEY not configured" };
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(input.instructions, input.preferences) },
    ];
    for (const m of input.history ?? []) {
      const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
      if (m.content && m.content.trim()) messages.push({ role, content: m.content });
    }
    messages.push({ role: "user", content: input.input });

    const tools = this.computer.getToolSchemas();
    let fullText = "";
    let toolCalls = 0;
    let iterations = 0;

    try {
      for (iterations = 1; iterations <= MAX_ITERATIONS; iterations += 1) {
        if (hooks.signal?.aborted) break;

        const disabledTools = input.preferences?.disabledTools ?? [];
      const notificationsOff = input.preferences?.notificationsEnabled === false;
      const allDisabled = notificationsOff && !disabledTools.includes("notify")
        ? [...disabledTools, "notify"]
        : disabledTools;
      const activeTools = tools.filter((t) => !allDisabled.includes(t.function.name));

      const stream = await this.getClient().chat.completions.create({
          model: this.model(),
          messages: messages as unknown as Groq.Chat.ChatCompletionMessageParam[],
          tools: activeTools.length > 0 ? activeTools as unknown as Groq.Chat.ChatCompletionTool[] : undefined,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 2048,
          stream: true,
        });

        let assistantText = "";
        const pendingToolCalls = new Map<
          number,
          { id: string; name: string; arguments: string }
        >();

        for await (const chunk of stream) {
          if (hooks.signal?.aborted) break;
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content.length > 0) {
            assistantText += delta.content;
            fullText += delta.content;
            hooks.onText(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              const existing =
                pendingToolCalls.get(index) ?? { id: "", name: "", arguments: "" };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              pendingToolCalls.set(index, existing);
            }
          }
        }

        // Sin tool calls → la respuesta del modelo es final.
        if (pendingToolCalls.size === 0) {
          return { ok: true, text: fullText, toolCalls, iterations, error: undefined };
        }

        // Asignar un id estable por tool call (el id se reutiliza en el mensaje
        // assistant y en el mensaje tool; deben coincidir para la API de Groq).
        const assembled = Array.from(pendingToolCalls.values())
          .filter((t) => t.name)
          .map((t, idx) => ({
            ...t,
            id: t.id || `call_${iterations}_${idx}_${Math.random().toString(36).slice(2, 10)}`,
          }));

        if (assembled.length === 0) {
          // Hubo deltas de tool_calls sin nombre válido → tratar como final.
          return { ok: true, text: fullText, toolCalls, iterations, error: undefined };
        }

        messages.push({
          role: "assistant",
          content: assistantText || null,
          tool_calls: assembled.map((t) => ({
            id: t.id,
            type: "function",
            function: { name: t.name, arguments: t.arguments || "{}" },
          })),
        });

        for (const call of assembled) {
          if (toolCalls >= MAX_TOOL_CALLS) break;
          toolCalls += 1;
          let args: Record<string, unknown> = {};
          try {
            const parsed = call.arguments ? JSON.parse(call.arguments) : {};
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            args = {};
          }
          hooks.onToolStart?.(call.name, args);
          hooks.onStatus?.(`Running ${call.name}`, summarizeArgs(args));

          const result = await this.computer.executeTool(call.name, args, input.ctx);
          const summary = summarizeResult(result);
          hooks.onToolResult?.(call.name, Boolean(result.ok), summary);

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify(result).slice(0, 8000),
          });
        }

        if (toolCalls >= MAX_TOOL_CALLS) {
          const note = "\n\n_(límite de acciones por turno alcanzado)_";
          fullText += note;
          hooks.onText(note);
          return { ok: true, text: fullText, toolCalls, iterations, error: undefined };
        }
      }

      return { ok: true, text: fullText, toolCalls, iterations, error: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[groq-agent] error: ${message}`, err instanceof Error ? err.stack : undefined);
      return { ok: false, text: fullText, toolCalls, iterations, error: message };
    }
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (k === "confirm") continue;
    const value = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${String(value).slice(0, 60)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(" ");
}

function summarizeResult(result: Record<string, unknown>): string {
  if (!result.ok) return `error: ${String(result.error ?? "failed").slice(0, 120)}`;
  if (typeof result.stdout === "string" && result.stdout.trim()) {
    return result.stdout.trim().slice(0, 120);
  }
  if (typeof result.result === "string" && result.result.trim()) {
    return result.result.trim().slice(0, 120);
  }
  if (Array.isArray(result.apps)) return `${result.apps.length} apps`;
  if (typeof result.content === "string") return `${result.content.length} chars`;
  return "ok";
}
