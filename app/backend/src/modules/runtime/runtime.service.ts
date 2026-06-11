import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { existsSync, readFileSync, watchFile, writeFileSync, unwatchFile, type Stats } from "node:fs";
import { homedir } from "node:os";

import type { ChatRequestDto } from "../../wrapper/wrapper.types";
import type { NikiPersonaProfile } from "../../domain/contracts";
import { AppConfigService } from "../common/app-config.service";
import {
  actingUserIdFrom,
  correlationIdFrom,
  internalApiKeyFrom,
  wrapperApiKeyFrom,
} from "../common/request-context";
import { RuntimeStateService } from "../common/runtime-state.service";
import { ComputerControlService } from "../computer/computer-control.service";
import { ConversationContextService } from "./conversation-context.service";
import { HermesProbeCache } from "./hermes-probe-cache";
import {
  parseHermesRuntimeConfig,
  serializeHermesRuntimeConfig,
  type HermesCompatibilityMode,
} from "./hermes-config";

type RuntimeConnectionState = "disconnected" | "connecting" | "pairing" | "syncing" | "ready" | "degraded";

type RuntimeUpdate =
  | {
      kind: "partial";
      patch: RuntimePatch;
    }
  | {
      kind: "event";
      event: {
        id: string;
        ts: string;
        level: "info" | "success" | "warning" | "error";
        source: string;
        type: string;
        title: string;
        summary: string;
        detail?: string;
      };
    };

type RuntimePatch = {
  connection?: {
    state: RuntimeConnectionState;
    endpoint: string;
    latencyMs: number;
    operatorMode: string;
    runtimeVersion: string;
  };
  agent?: {
    state: "idle" | "listening" | "thinking" | "acting" | "speaking" | "success" | "warning" | "error";
    model: string;
    channel: string;
    currentTask: string;
    summary: string;
  };
};

type RuntimeConnectionConfigInput = {
  apiServerUrl?: string;
  apiKey?: string;
  model?: string;
  contextLengthOverride?: number | string | null;
  compatibilityMode?: string;
  diagnosticsEnabled?: boolean;
};

type ResolvedRuntimeConfig = {
  apiServerUrl: string;
  apiKey: string;
  model: string;
  contextLengthOverride: number | null;
  compatibilityMode: HermesCompatibilityMode;
  diagnosticsEnabled: boolean;
  source: {
    apiServerUrl: "settings" | "env";
    apiKey: "settings" | "env";
    model: "settings" | "env";
    contextLengthOverride: "settings" | "default";
    compatibilityMode: "settings" | "default";
    diagnosticsEnabled: "settings" | "default";
  };
};

type HermesProbeResult = {
  state: "disconnected" | "degraded" | "ready";
  health: "offline" | "degraded" | "healthy";
  detail: string;
  apiServerUrl: string;
  resolvedModel: string;
  latencyMs: number;
};

function nowIso() {
  return new Date().toISOString();
}

function toSseData(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function toOpenAiStyleChunk(text: string) {
  return toSseData({ choices: [{ delta: { content: text } }] });
}

function slugifyEventType(value: string) {
  return value.replace(/[^a-z0-9]+/gi, ".").replace(/^\.+|\.+$/g, "").toLowerCase() || "runtime.event";
}

function summarizeEventType(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\./g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Runtime event";
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function formatHermesConnectionError(apiServerUrl: string, error: unknown) {
  const fallback = formatUnknownError(error);
  const cause =
    error instanceof Error && "cause" in error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;

  if (cause && typeof cause === "object") {
    const record = cause as { code?: unknown; address?: unknown; port?: unknown };
    const code = typeof record.code === "string" ? record.code : "";
    const address = typeof record.address === "string" ? record.address : "127.0.0.1";
    const port = typeof record.port === "number" || typeof record.port === "string" ? String(record.port) : "";

    if (code === "ECONNREFUSED") {
      const target = port ? `${address}:${port}` : address;
      return `No se pudo conectar a Hermes en ${apiServerUrl} (${target}). Activa \`API_SERVER_ENABLED=true\` en ~/.hermes/.env y arranca o reinicia \`hermes gateway\`.`;
    }

    if (code === "ETIMEDOUT" || code === "EHOSTUNREACH") {
      return `Hermes no respondió en ${apiServerUrl}. Verifica host, puerto y que \`hermes gateway\` esté corriendo con API server habilitado.`;
    }
  }

  if (fallback === "fetch failed") {
    return `No se pudo conectar a Hermes en ${apiServerUrl}. Verifica que el API server esté habilitado y que \`hermes gateway\` esté corriendo.`;
  }

  return `Error al conectar con Hermes en ${apiServerUrl}: ${fallback}`;
}

function normalizeMessage(role?: string, content?: string) {
  return {
    role: role === "assistant" || role === "system" ? role : "user",
    content: String(content ?? "").trim(),
  };
}

function buildNikiRuntimeInstructions(channel?: string, contextJson?: string) {
  const base = [
    "You are Niki, the user-facing assistant inside the Niki desktop app.",
    "Do not introduce yourself as Hermes. Hermes is the runtime behind you.",
    "Use the conversation history you receive to resolve short follow-ups like 'abrela', pronouns, and recent references.",
    "Keep replies concise, practical, and action-oriented.",
    "When the wrapper provides structured context for memory, tasks, or recent references, treat that context as authoritative.",
  ];


  if (contextJson) {
    base.push(`Wrapper context JSON: ${contextJson}`);
  }

  return base.join(" ");
}

function buildNikiPersonaInstructions(profile: NikiPersonaProfile) {
  const identityInstruction = `You are ${profile.assistantName || "Niki"}.`;

  const toneInstruction =
    profile.tone === "warm"
      ? "Sound warm and personal, but still operational."
      : profile.tone === "direct"
        ? "Sound direct and decisive, without filler."
        : "Sound grounded, pragmatic, and calm.";

  const brevityInstruction =
    profile.brevity === "detailed"
      ? "Use fuller answers when needed, but stay structured."
      : profile.brevity === "balanced"
        ? "Keep answers short by default, then add only the necessary detail."
        : "Prefer concise replies and short confirmations.";

  const responseStyleInstruction =
    profile.responseStyle === "friendly"
      ? "Use a friendly response style without becoming verbose."
      : profile.responseStyle === "brief_status"
        ? "Prefer status-like confirmations and short operational phrasing."
        : "Use an operational response style focused on action and clarity.";

  return [
    identityInstruction,
    toneInstruction,
    brevityInstruction,
    responseStyleInstruction,
    profile.operationalRules?.trim() || "",
    profile.forbiddenBehaviors?.trim() || "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildEmptyHermesFallback(input: string, assistantName: string) {
  void input;
  return `${assistantName} no recibió texto final de Hermes. Inténtalo otra vez.`;
}

function normalizeContextLengthOverride(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function normalizeCompatibilityMode(value: unknown): HermesCompatibilityMode {
  return value === "hermes_agent" ? "hermes_agent" : "standard";
}

function inferModelContextLength(model: string) {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("kimi-k2.6")) return 32_768;
  return null;
}

function hermesConfigPath() {
  return process.env.HERMES_CONFIG_PATH?.trim() || `${homedir()}/.hermes/config.yaml`;
}

function readHermesConfigContextLength() {
  const filePath = hermesConfigPath();
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const modelBlock = raw.match(/(?:^|\n)model:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? "";
    const value = modelBlock.match(/^[ \t]+context_length:\s*(\d+)/m)?.[1];
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

function summarizeHermesPayloadShape(payload: unknown, depth = 0): unknown {
  if (depth > 2) return "[max-depth]";
  if (payload == null) return payload;
  if (typeof payload === "string") {
    return payload.length > 180 ? `${payload.slice(0, 180)}...` : payload;
  }
  if (typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload.slice(0, 4).map((item) => summarizeHermesPayloadShape(item, depth + 1));
  }

  const record = payload as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 12)
      .map(([key, value]) => [key, summarizeHermesPayloadShape(value, depth + 1)]),
  );
}

@Injectable()
export class RuntimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RuntimeService.name);
  private readonly listeners = new Set<Response>();
  private readonly heartbeatMs = 15_000;
  private readonly hermesConfigFilePath = hermesConfigPath();
  private readonly hermesProbeCache = new HermesProbeCache<HermesProbeResult>(1_500);
  private heartbeatId?: ReturnType<typeof setInterval>;
  private lastBroadcastState = "";
  private readonly handleHermesConfigWatch = (current: Stats, previous: Stats) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    this.logger.log(`[runtime] detected Hermes config change at ${this.hermesConfigFilePath}`);
    this.hermesProbeCache.clear();
    this.lastBroadcastState = "";
    void this.broadcastRuntimeHeartbeat();
  };

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
    @Inject(ConversationContextService)
    private readonly conversationContext: ConversationContextService,
    @Inject(ComputerControlService)
    private readonly computer: ComputerControlService,
  ) {
    this.ensureHeartbeat();
    this.ensureHermesConfigWatch();
  }

  onModuleDestroy() {
    if (this.heartbeatId) clearInterval(this.heartbeatId);
    unwatchFile(this.hermesConfigFilePath, this.handleHermesConfigWatch);
  }

  assertWrapperAuthorized(req: Request) {
    const expected = this.configService.get().wrapperApiKey;
    if (expected && wrapperApiKeyFrom(req) !== expected) {
      throw new ForbiddenException("invalid wrapper api key");
    }
  }

  assertRuntimeEventsAuthorized(req: Request) {
    const expected = this.configService.get().wrapperApiKey;
    const queryApiKey = String(req.query.apiKey ?? "").trim();
    if (expected && wrapperApiKeyFrom(req) !== expected && queryApiKey !== expected) {
      throw new ForbiddenException("invalid runtime events api key");
    }
  }

  assertInternal(req: Request) {
    const expected = this.configService.get().internalApiKey;
    if (expected && internalApiKeyFrom(req) !== expected) {
      throw new ForbiddenException("invalid internal api key");
    }
  }

  legacyHealth(req: Request) {
    const config = this.configService.get();
    const runtimeConfig = this.resolveRuntimeConfig();
    return {
      ok: true,
      status: "live",
      endpoint: `${config.publicBaseUrl}/healthz`,
      chat: true,
      voice: true,
      transport: "nestjs-hermes-wrapper",
      agentTarget: runtimeConfig.model,
      defaultModel: runtimeConfig.model,
      gatewayUrl: runtimeConfig.apiServerUrl,
      requestHost: req.headers.host ?? `${config.host}:${config.port}`,
    };
  }

  publicConfig() {
    const runtimeConfig = this.resolveRuntimeConfig();
    return {
      ok: true,
      app: "niki-agent",
      chat: true,
      voice: true,
      apiServerUrl: runtimeConfig.apiServerUrl,
      model: runtimeConfig.model,
      provider: "hermes",
      computerControl: this.computer.getConfig().mode,
    };
  }

  getRuntimeConfig() {
    const runtimeConfig = this.resolveRuntimeConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    return {
      ok: true,
      provider: "hermes",
      agentProvider: "hermes",
      apiServerUrl: runtimeConfig.apiServerUrl,
      apiKey: runtimeConfig.apiKey,
      hasApiKey: Boolean(runtimeConfig.apiKey),
      model: runtimeConfig.model,
      contextLengthOverride: runtimeConfig.contextLengthOverride,
      compatibilityMode: runtimeConfig.compatibilityMode,
      diagnosticsEnabled: runtimeConfig.diagnosticsEnabled,
      compatibility,
      source: runtimeConfig.source,
    };
  }

  updateRuntimeConfig(input: RuntimeConnectionConfigInput) {
    const current = this.resolveRuntimeConfig();
    const next = {
      apiServerUrl:
        "apiServerUrl" in input
          ? String(input.apiServerUrl ?? "").trim().replace(/\/+$/, "")
          : current.apiServerUrl,
      apiKey: "apiKey" in input ? String(input.apiKey ?? "").trim() : current.apiKey,
      model: "model" in input ? String(input.model ?? "").trim() : current.model,
      contextLengthOverride:
        "contextLengthOverride" in input
          ? normalizeContextLengthOverride(input.contextLengthOverride)
          : current.contextLengthOverride,
      compatibilityMode:
        "compatibilityMode" in input
          ? normalizeCompatibilityMode(input.compatibilityMode)
          : current.compatibilityMode,
      diagnosticsEnabled:
        "diagnosticsEnabled" in input
          ? Boolean(input.diagnosticsEnabled)
          : current.diagnosticsEnabled,
    };

    this.hermesProbeCache.clear();
    this.lastBroadcastState = "";
    this.writeHermesRuntimeConfig(next);
    void this.broadcastRuntimeHeartbeat();

    return this.getRuntimeConfig();
  }

  async status() {
    const state = this.runtimeState.snapshot();
    const hermes = await this.probeHermes();
    const runtimeConfig = this.resolveRuntimeConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    return {
      ok: true,
      provider: "hermes",
      apiServerUrl: hermes.apiServerUrl,
      resolvedModel: hermes.resolvedModel,
      defaultModel: this.configService.get().hermesModel,
      runtimeVersion: hermes.resolvedModel,
      state: hermes.state,
      health: hermes.health,
      auth: {
        mode: "api_key",
        configured: Boolean(this.configService.get().wrapperApiKey),
        upstreamConfigured: Boolean(this.resolveRuntimeConfig().apiKey),
      },
      capabilities: {
        readTools: true,
        workflowExecution: false,
        runtimeEvents: true,
        runsApi: true,
      },
      compatibility,
      config: {
        model: runtimeConfig.model,
        contextLengthOverride: runtimeConfig.contextLengthOverride,
        compatibilityMode: runtimeConfig.compatibilityMode,
        diagnosticsEnabled: runtimeConfig.diagnosticsEnabled,
      },
      infra: this.configService.infraStatus(),
      counts: {
        users: state.users.length,
        auditEvents: state.auditEvents.length,
      },
      detail: hermes.detail,
    };
  }

  listTools() {
    return {
      ok: true,
      tools: [
        "generateAuditSummary",
      ],
    };
  }

  generateAuditSummary() {
    const state = this.runtimeState.snapshot();
    return {
      ok: true,
      summary: {
        totalAuditEvents: state.auditEvents.length,
        latestAuditEvent: state.auditEvents[0]?.detail ?? "No audit events yet.",
      },
    };
  }

  async streamRuntimeEvents(req: Request, res: Response) {
    this.assertRuntimeEventsAuthorized(req);
    this.setupSse(res);
    this.listeners.add(res);
    await this.emitInitialRuntimeState(res);
    req.on("close", () => {
      this.listeners.delete(res);
      res.end();
    });
  }

  async proxyChatStream(req: Request, res: Response, body: ChatRequestDto) {
    const input = String(body.input ?? body.messages?.at(-1)?.content ?? "").trim();
    if (!input) throw new BadRequestException("input is required");

    const userId = actingUserIdFrom(req);
    const correlationId = correlationIdFrom(req);
    const sessionId = String(body.sessionId ?? "session").trim() || "session";
    const channel = String(body.channel ?? "niki-agent").trim() || "niki-agent";

    await this.conversationContext.captureUserTurn(userId, sessionId, channel, input);

    const personaProfile = await this.conversationContext.getPersonaProfile(userId);

    this.runtimeState.audit(
      userId,
      "runtime.chat.proxy",
      sessionId,
      correlationId,
      `Prompt sent to Hermes runtime for channel ${channel}.`,
    );

    this.setupSse(res);
    this.broadcastEvent("info", "runtime", "runtime.chat.request", "Hermes request started", input.slice(0, 180));
    const runtimeConfig = this.resolveRuntimeConfig();
    this.broadcastPatch({
      agent: {
        state: "thinking",
        model: runtimeConfig.model,
        channel: "Niki app -> Hermes",
        currentTask: "Creating run",
        summary: input.slice(0, 180),
      },
    });

    const apiServerUrl = runtimeConfig.apiServerUrl.trim();
    if (!apiServerUrl) {
      res.write(toOpenAiStyleChunk("> Hermes no configurado. Define `HERMES_API_SERVER_URL` en el backend.\n\n[[exec_status:sin_acciones|hermes]]"));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    if (!compatibility.ok) {
      res.write(
        toOpenAiStyleChunk(
          `> ${compatibility.message}\n\n[[exec_status:sin_acciones|hermes]]`,
        ),
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const headers = this.hermesHeaders(userId, correlationId);
    const messages = (body.messages?.length ? body.messages : [{ role: "user", content: input }])
      .map((message) => normalizeMessage(message.role, message.content))
      .filter((message) => message.content.length > 0);
    const latestMessage = messages.at(-1);
    const conversationHistory = messages.slice(0, -1);
    const runtimeContext = await this.conversationContext.buildRuntimeContext(
      userId,
      sessionId,
      channel,
    );

    this.logger.log(`[runtime] [${correlationId}] user=${userId} session=${sessionId} channel=${channel}`);
    this.logger.log(`[runtime] [${correlationId}] prompt → hermes ${apiServerUrl}/v1/runs`);

    // Cancelar el upstream y dejar de escribir si el cliente se desconecta.
    const hermesAbort = new AbortController();
    const hermesWrite = (chunk: string) => {
      if (res.writableEnded) return;
      try {
        res.write(chunk);
      } catch {
        /* cliente desconectado */
      }
    };
    req.on("close", () => hermesAbort.abort());

    try {
      const runRes = await fetch(`${apiServerUrl}/v1/runs`, {
        method: "POST",
        signal: hermesAbort.signal,
        headers,
        body: JSON.stringify({
          model: runtimeConfig.model,
          context_length:
            runtimeConfig.contextLengthOverride && runtimeConfig.contextLengthOverride > 0
              ? runtimeConfig.contextLengthOverride
              : undefined,
          input: latestMessage?.content ?? input,
          session_id: sessionId,
          conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
          instructions: `${buildNikiRuntimeInstructions(channel, runtimeContext)} ${buildNikiPersonaInstructions(personaProfile)}`,
          metadata: {
            sessionId,
            channel,
            userId,
          },
        }),
      });

      const runPayload = (await runRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!runRes.ok) {
        throw new Error(`runs ${runRes.status}: ${JSON.stringify(runPayload)}`);
      }

      const runId = this.extractRunId(runPayload);
      if (!runId) {
        throw new Error("Hermes did not return a run id.");
      }
      this.logger.log(
        `[runtime] [${correlationId}] run created id=${runId} payload=${JSON.stringify(
          summarizeHermesPayloadShape(runPayload),
        )}`,
      );

      this.broadcastEvent(
        "info",
        "runtime",
        "runtime.run.created",
        "Hermes run created",
        `Run ${runId} created for ${channel}.`,
      );

      const eventsRes = await fetch(`${apiServerUrl}/v1/runs/${runId}/events`, {
        method: "GET",
        signal: hermesAbort.signal,
        headers: {
          ...headers,
          Accept: "text/event-stream",
        },
      });

      if (!eventsRes.ok || !eventsRes.body) {
        const detail = await eventsRes.text().catch(() => String(eventsRes.status));
        throw new Error(`run events ${eventsRes.status}: ${detail}`);
      }

      let fullText = "";
      let emittedStatus = false;
      let lastRelevantPayload: unknown = null;

      for await (const packet of this.readSsePackets(eventsRes.body)) {
        if (res.writableEnded || hermesAbort.signal.aborted) break;
        const parsed = this.parseHermesPacket(packet);
        const eventType = parsed.eventType;
        if (runtimeConfig.diagnosticsEnabled) {
          this.logger.log(
            `[runtime] [${correlationId}] event=${eventType} shape=${JSON.stringify(
              summarizeHermesPayloadShape(parsed.data),
            )}`,
          );
        }
        const label = summarizeEventType(eventType);
        const progress = this.progressMarkerForEvent(eventType);
        const nextState = this.agentStateForEvent(eventType);

        if (nextState) {
          this.broadcastPatch({
            agent: {
              state: nextState,
              model: runtimeConfig.model,
              channel: "Niki app -> Hermes",
              currentTask: label,
              summary: progress ?? label,
            },
          });
        }

        if (parsed.dataRaw) {
          this.broadcastEvent(
            eventType.includes("error") ? "error" : eventType.includes("completed") ? "success" : "info",
            "runtime",
            slugifyEventType(eventType),
            label,
            progress ?? label,
            parsed.dataRaw.slice(0, 400),
          );
        }

        const delta = this.extractHermesText(parsed.data);
        if (delta) {
          lastRelevantPayload = parsed.data;
          if (runtimeConfig.diagnosticsEnabled) {
            this.logger.log(
              `[runtime] [${correlationId}] text event=${eventType} delta=${JSON.stringify(
                delta.slice(0, 180),
              )}`,
            );
          }
        } else if (
          eventType.includes("completed") ||
          eventType.includes("finished") ||
          eventType.includes("response")
        ) {
          lastRelevantPayload = parsed.data;
        }
        if (this.shouldEmitHermesText(eventType, fullText, delta)) {
          fullText += delta;
          hermesWrite(toOpenAiStyleChunk(delta));
          this.broadcastPatch({
            agent: {
              state: "speaking",
              model: runtimeConfig.model,
              channel: "Niki app -> Hermes",
              currentTask: "Streaming response",
              summary: fullText.slice(0, 180),
            },
          });
        }

        if (eventType.includes("completed") || eventType.includes("finished")) {
          emittedStatus = true;
        }

        if (eventType.includes("error") || eventType.includes("failed")) {
          emittedStatus = true;
          hermesWrite(toOpenAiStyleChunk(`\n\n[[exec_status:parcial|hermes]]`));
        }
      }

      if (!fullText.trim()) {
        if (runtimeConfig.diagnosticsEnabled) {
          this.logger.warn(
            `[runtime] [${correlationId}] completed with empty fullText. lastPayload=${JSON.stringify(
              summarizeHermesPayloadShape(lastRelevantPayload),
            )}`,
          );
        }
        fullText = buildEmptyHermesFallback(
          input,
          personaProfile.assistantName || "Niki",
        );
        hermesWrite(toOpenAiStyleChunk(fullText));
      }
      if (!emittedStatus) {
        hermesWrite(toOpenAiStyleChunk("\n\n[[exec_status:verificada|hermes]]"));
      }

      this.broadcastPatch({
        agent: {
          state: "success",
          model: runtimeConfig.model,
          channel: "Niki app -> Hermes",
          currentTask: "Completed",
          summary: (fullText.trim() || "Completed").slice(0, 180),
        },
      });
      await this.conversationContext.recordAssistantReply(
        userId,
        sessionId,
        channel,
        fullText.trim() || "Completed",
      );
      this.broadcastEvent("success", "runtime", "runtime.chat.completed", "Hermes response completed", `Run completed for ${channel}.`);
    } catch (err) {
      const message = formatHermesConnectionError(apiServerUrl, err);
      this.logger.error(`[runtime] [${correlationId}] hermes error: ${message}`);
      hermesWrite(toOpenAiStyleChunk(`\n\n> Error al conectar con Hermes runtime: ${message}\n\n[[exec_status:sin_acciones|hermes]]`));
      this.broadcastPatch({
        agent: {
          state: "error",
          model: runtimeConfig.model,
          channel: "Niki app -> Hermes",
          currentTask: "Request failed",
          summary: message.slice(0, 180),
        },
      });
      this.broadcastEvent("error", "runtime", "runtime.chat.error", "Hermes request failed", message.slice(0, 200));
    }

    hermesWrite("data: [DONE]\n\n");
    if (!res.writableEnded) res.end();
  }

  private async emitInitialRuntimeState(res: Response) {
    const status = await this.status();
    res.write(
      toSseData({
        kind: "partial",
        patch: {
          connection: {
            state: status.state,
            endpoint: status.apiServerUrl,
            latencyMs: 0,
            operatorMode: "wrapper",
            runtimeVersion: status.resolvedModel,
          },
          agent: {
            state: status.state === "ready" ? "idle" : status.state === "degraded" ? "warning" : "error",
            model: status.resolvedModel,
            channel: "Niki app -> Hermes",
            currentTask: status.state === "ready" ? "Ready for realtime requests" : "Runtime unavailable",
            summary: String(status.detail ?? ""),
          },
        },
      } satisfies RuntimeUpdate),
    );
  }

  private async probeHermes() {
    const runtimeConfig = this.resolveRuntimeConfig();
    const signature = [
      runtimeConfig.apiServerUrl,
      runtimeConfig.apiKey,
      runtimeConfig.model,
    ].join("|");

    return this.hermesProbeCache.get(signature, async () =>
      this.probeHermesUncached(runtimeConfig),
    );
  }

  private async probeHermesUncached(runtimeConfig: ResolvedRuntimeConfig): Promise<HermesProbeResult> {
    const startedAt = performance.now();
    const apiServerUrl = runtimeConfig.apiServerUrl.trim();
    if (!apiServerUrl) {
      return {
        state: "disconnected" as const,
        health: "offline" as const,
        detail: "Hermes API server URL is not configured.",
        apiServerUrl: "",
        resolvedModel: runtimeConfig.model,
        latencyMs: 0,
      };
    }

    try {
      const res = await fetch(`${apiServerUrl}/v1/models`, {
        method: "GET",
        headers: this.hermesHeaders("user-demo", "status-check"),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          state: "degraded" as const,
          health: "degraded" as const,
          detail: `Hermes responded HTTP ${res.status}.`,
          apiServerUrl,
          resolvedModel: runtimeConfig.model,
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        };
      }
      const models = Array.isArray(payload.data) ? payload.data : [];
      const firstModelId = models.find(
        (item): item is { id: string } =>
          Boolean(item) && typeof item === "object" && typeof (item as { id?: unknown }).id === "string",
      )?.id;
      const resolvedModel = runtimeConfig.model || firstModelId || "hermes/default";
      return {
        state: "ready" as const,
        health: "healthy" as const,
        detail: `Hermes API server reachable at ${apiServerUrl}.`,
        apiServerUrl,
        resolvedModel,
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      };
    } catch (error) {
      return {
        state: "disconnected" as const,
        health: "offline" as const,
        detail: formatHermesConnectionError(apiServerUrl, error),
        apiServerUrl,
        resolvedModel: runtimeConfig.model,
        latencyMs: 0,
      };
    }
  }

  private hermesHeaders(userId: string, correlationId: string) {
    const runtimeConfig = this.resolveRuntimeConfig();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      "x-niki-user-id": userId,
    };
    if (runtimeConfig.apiKey) {
      headers.authorization = `Bearer ${runtimeConfig.apiKey}`;
    }
    return headers;
  }

  private evaluateHermesCompatibility(runtimeConfig: ResolvedRuntimeConfig) {
    const minimumContextLength =
      runtimeConfig.compatibilityMode === "hermes_agent" ? 64_000 : null;
    const inferredContextLength =
      readHermesConfigContextLength() ?? inferModelContextLength(runtimeConfig.model);
    const effectiveContextLength =
      runtimeConfig.contextLengthOverride ?? inferredContextLength ?? null;

    if (
      minimumContextLength &&
      effectiveContextLength !== null &&
      effectiveContextLength < minimumContextLength
    ) {
      return {
        ok: false,
        mode: runtimeConfig.compatibilityMode,
        minimumContextLength,
        effectiveContextLength,
        warning: `Model ${runtimeConfig.model} reports ${effectiveContextLength.toLocaleString()} tokens. Hermes Agent requires at least ${minimumContextLength.toLocaleString()}.`,
        message: `El modelo ${runtimeConfig.model} está configurado con ${effectiveContextLength.toLocaleString()} tokens y Hermes Agent requiere mínimo ${minimumContextLength.toLocaleString()}. Sube el context override o cambia el modelo desde Settings.`,
      };
    }

    return {
      ok: true,
      mode: runtimeConfig.compatibilityMode,
      minimumContextLength,
      effectiveContextLength,
      warning:
        minimumContextLength && effectiveContextLength === null
          ? "Niki no pudo inferir el context window real del modelo. Usa Context override si Hermes Agent sigue fallando."
          : "",
      message: minimumContextLength
        ? "Hermes Agent compatibility active."
        : "Standard Hermes runtime mode.",
    };
  }

  private resolveRuntimeConfig(): ResolvedRuntimeConfig {
    const config = this.configService.get();
    const raw = this.readHermesConfigFile();
    const parsed = parseHermesRuntimeConfig(raw ?? "", {
      defaultApiServerUrl: config.hermesApiServerUrl,
      defaultApiKey: config.hermesApiKey,
      defaultModel: config.hermesModel,
    });

    return {
      apiServerUrl: parsed.apiServerUrl,
      apiKey: parsed.apiKey,
      model: parsed.model,
      contextLengthOverride: parsed.contextLengthOverride,
      compatibilityMode: parsed.compatibilityMode,
      diagnosticsEnabled: parsed.diagnosticsEnabled,
      source: {
        apiServerUrl: raw && /api_server_url:/m.test(raw) ? "settings" : "env",
        apiKey: raw && /api_key:/m.test(raw) ? "settings" : "env",
        model: raw && /(^|\n)model:\n(?:[ \t]+.*\n)*[ \t]+default:/m.test(raw) ? "settings" : "env",
        contextLengthOverride: raw && /context_length:/m.test(raw) ? "settings" : "default",
        compatibilityMode: raw && /compatibility_mode:/m.test(raw) ? "settings" : "default",
        diagnosticsEnabled: raw && /diagnostics_enabled:/m.test(raw) ? "settings" : "default",
      } as const,
    };
  }

  private readHermesConfigFile() {
    const filePath = hermesConfigPath();
    if (!existsSync(filePath)) return null;
    try {
      return readFileSync(filePath, "utf8");
    } catch (error) {
      this.logger.warn(
        `[runtime] could not read Hermes config file ${filePath}: ${formatUnknownError(error)}`,
      );
      return null;
    }
  }

  private writeHermesRuntimeConfig(runtimeConfig: {
    apiServerUrl: string;
    apiKey: string;
    model: string;
    contextLengthOverride: number | null;
    compatibilityMode: HermesCompatibilityMode;
    diagnosticsEnabled: boolean;
  }) {
    const filePath = hermesConfigPath();
    const currentRaw = this.readHermesConfigFile() ?? "";

    try {
      const nextRaw = serializeHermesRuntimeConfig(currentRaw, runtimeConfig);
      writeFileSync(filePath, nextRaw, "utf8");
    } catch (error) {
      this.logger.warn(
        `[runtime] could not sync Hermes config file ${filePath}: ${formatUnknownError(error)}`,
      );
    }
  }

  private extractRunId(payload: Record<string, unknown>) {
    if (typeof payload.id === "string" && payload.id) return payload.id;
    if (typeof payload.run_id === "string" && payload.run_id) return payload.run_id;
    if (typeof payload.runId === "string" && payload.runId) return payload.runId;
    const nested = payload.run;
    if (nested && typeof nested === "object" && typeof (nested as { id?: unknown }).id === "string") {
      return String((nested as { id: string }).id);
    }
    const data = payload.data;
    if (data && typeof data === "object") {
      const record = data as { id?: unknown; run_id?: unknown; runId?: unknown };
      if (typeof record.id === "string" && record.id) return record.id;
      if (typeof record.run_id === "string" && record.run_id) return record.run_id;
      if (typeof record.runId === "string" && record.runId) return record.runId;
    }
    return null;
  }

  private async *readSsePackets(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        if (chunk.trim()) yield chunk;
      }
    }

    const tail = buffer.trim();
    if (tail) yield tail;
  }

  private parseHermesPacket(packet: string) {
    const lines = packet.split("\n");
    let eventType = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "runtime.event";
    const dataRaw = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    let data: unknown = dataRaw;
    if (dataRaw) {
      try {
        data = JSON.parse(dataRaw);
      } catch {
        data = dataRaw;
      }
    }

    if (eventType === "runtime.event" && data && typeof data === "object") {
      const payloadEvent = (data as { event?: unknown; type?: unknown }).event ?? (data as { type?: unknown }).type;
      if (typeof payloadEvent === "string" && payloadEvent.trim()) {
        eventType = payloadEvent.trim();
      }
    }

    return { eventType, dataRaw, data };
  }

  private extractHermesText(payload: unknown): string {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (Array.isArray(payload)) {
      return payload.map((item) => this.extractHermesText(item)).filter(Boolean).join("");
    }
    if (typeof payload !== "object") return "";

    const record = payload as Record<string, unknown>;
    const directKeys = ["delta", "text", "output_text", "content", "message"];
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }

    const choices = record.choices;
    if (Array.isArray(choices)) {
      const extracted = choices
        .map((choice) => this.extractHermesText(choice))
        .filter(Boolean)
        .join("");
      if (extracted) return extracted;
    }

    const message = record.message;
    if (message && typeof message === "object") {
      const extracted = this.extractHermesText(message);
      if (extracted) return extracted;
    }

    const content = record.content;
    if (Array.isArray(content)) {
      const extracted = content
        .map((item) => {
          if (typeof item === "string") return item;
          if (!item || typeof item !== "object") return "";
          const entry = item as Record<string, unknown>;
          if (typeof entry.text === "string") return entry.text;
          if (typeof entry.content === "string") return entry.content;
          return this.extractHermesText(entry);
        })
        .filter(Boolean)
        .join("");
      if (extracted) return extracted;
    }

    const nestedKeys = ["data", "response", "item", "output", "content"];
    for (const key of nestedKeys) {
      const value = record[key];
      const extracted = this.extractHermesText(value);
      if (extracted) return extracted;
    }

    return "";
  }

  private shouldEmitHermesText(eventType: string, fullText: string, delta: string) {
    if (!delta) return false;
    if (eventType.includes("delta")) return true;
    return !fullText.trim();
  }

  private progressMarkerForEvent(eventType: string) {
    if (eventType.includes("queued")) return "Run queued";
    if (eventType.includes("started")) return "Run started";
    if (eventType.includes("tool")) return "Running tools";
    if (eventType.includes("response")) return "Generating response";
    if (eventType.includes("completed")) return "Run completed";
    return "";
  }

  private agentStateForEvent(eventType: string) {
    if (eventType.includes("queued") || eventType.includes("started")) return "thinking" as const;
    if (eventType.includes("tool")) return "acting" as const;
    if (eventType.includes("response") || eventType.includes("delta")) return "speaking" as const;
    if (eventType.includes("completed")) return "success" as const;
    if (eventType.includes("error") || eventType.includes("failed")) return "error" as const;
    return null;
  }

  private setupSse(res: Response) {
    res.status(200);
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
  }

  private broadcastPatch(patch: RuntimePatch) {
    this.broadcast({ kind: "partial", patch });
  }

  private broadcastEvent(
    level: "info" | "success" | "warning" | "error",
    source: string,
    type: string,
    title: string,
    summary: string,
    detail?: string,
  ) {
    this.broadcast({
      kind: "event",
      event: {
        id: `${type}-${Date.now()}`,
        ts: nowIso(),
        level,
        source,
        type,
        title,
        summary,
        detail,
      },
    });
  }

  private broadcast(update: RuntimeUpdate) {
    const payload = toSseData(update);
    for (const listener of this.listeners) {
      if (listener.writableEnded) {
        this.listeners.delete(listener);
        continue;
      }
      try {
        listener.write(payload);
      } catch {
        // Listener muerto: lo removemos para no acumular escrituras fallidas.
        this.listeners.delete(listener);
      }
    }
  }

  private ensureHeartbeat() {
    if (this.heartbeatId) return;
    this.heartbeatId = setInterval(() => {
      void this.broadcastRuntimeHeartbeat();
    }, this.heartbeatMs);
  }

  private ensureHermesConfigWatch() {
    watchFile(this.hermesConfigFilePath, { interval: 2_000 }, this.handleHermesConfigWatch);
  }

  private async broadcastRuntimeHeartbeat() {
    if (this.listeners.size === 0) return;
    const status = await this.status();
    const signature = `${status.state}|${status.resolvedModel}|${status.detail}`;
    if (signature === this.lastBroadcastState) return;
    this.lastBroadcastState = signature;

    this.broadcastPatch({
      connection: {
        state: status.state,
        endpoint: status.apiServerUrl,
        latencyMs: 0,
        operatorMode: "wrapper",
        runtimeVersion: status.resolvedModel,
      },
      agent: {
        state: status.state === "ready" ? "idle" : status.state === "degraded" ? "warning" : "error",
        model: status.resolvedModel,
        channel: "Niki app -> Hermes",
        currentTask: status.state === "ready" ? "Ready for realtime requests" : "Runtime unavailable",
        summary: String(status.detail ?? ""),
      },
    });
    this.broadcastEvent(
      status.state === "ready" ? "success" : status.state === "degraded" ? "warning" : "error",
      "runtime",
      `runtime.${status.state}`,
      status.state === "ready" ? "Hermes connected" : status.state === "degraded" ? "Hermes degraded" : "Hermes disconnected",
      String(status.detail ?? ""),
      status.apiServerUrl,
    );
  }
}
