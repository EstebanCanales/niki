import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
import type { WorkItem, WorkItemKind } from "../../domain/contracts";
import { WorkItemsService } from "../work-items/work-items.service";
import { ConversationContextService } from "./conversation-context.service";

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

type HermesCompatibilityMode = "standard" | "hermes_agent";

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
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);
  private readonly listeners = new Set<Response>();
  private readonly heartbeatMs = 15_000;
  private heartbeatId?: ReturnType<typeof setInterval>;
  private lastBroadcastState = "";
  private readonly runtimeConfigOverride: Partial<{
    apiServerUrl: string;
    apiKey: string;
    model: string;
    contextLengthOverride: number | null;
    compatibilityMode: HermesCompatibilityMode;
    diagnosticsEnabled: boolean;
  }> = {};

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
    @Inject(WorkItemsService)
    private readonly workItemsService: WorkItemsService,
    @Inject(ConversationContextService)
    private readonly conversationContext: ConversationContextService,
  ) {
    this.ensureHeartbeat();
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
      app: "niki-hermes-wrapper",
      chat: true,
      voice: true,
      apiServerUrl: runtimeConfig.apiServerUrl,
      model: runtimeConfig.model,
      provider: "hermes",
    };
  }

  getRuntimeConfig() {
    const runtimeConfig = this.resolveRuntimeConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    return {
      ok: true,
      provider: "hermes",
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
    if ("apiServerUrl" in input) {
      const value = String(input.apiServerUrl ?? "").trim();
      if (value) this.runtimeConfigOverride.apiServerUrl = value.replace(/\/+$/, "");
      else delete this.runtimeConfigOverride.apiServerUrl;
    }

    if ("apiKey" in input) {
      const value = String(input.apiKey ?? "").trim();
      if (value) this.runtimeConfigOverride.apiKey = value;
      else delete this.runtimeConfigOverride.apiKey;
    }

    if ("model" in input) {
      const value = String(input.model ?? "").trim();
      if (value) this.runtimeConfigOverride.model = value;
      else delete this.runtimeConfigOverride.model;
    }

    if ("contextLengthOverride" in input) {
      const value = normalizeContextLengthOverride(input.contextLengthOverride);
      if (value) this.runtimeConfigOverride.contextLengthOverride = value;
      else delete this.runtimeConfigOverride.contextLengthOverride;
    }

    if ("compatibilityMode" in input) {
      this.runtimeConfigOverride.compatibilityMode = normalizeCompatibilityMode(
        input.compatibilityMode,
      );
    }

    if ("diagnosticsEnabled" in input) {
      this.runtimeConfigOverride.diagnosticsEnabled = Boolean(input.diagnosticsEnabled);
    }

    this.lastBroadcastState = "";
    void this.broadcastRuntimeHeartbeat();
    this.syncHermesConfigFile(this.resolveRuntimeConfig());

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

    const setupPlanResponse = await this.tryHandleFullAppSetupRequest({
      userId,
      sessionId,
      channel,
      input,
      personaProfile,
    });
    if (setupPlanResponse) {
      this.setupSse(res);
      res.write(toOpenAiStyleChunk(setupPlanResponse.message));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const localWorkItemResponse = await this.tryHandleWorkItemCommand({
      userId,
      sessionId,
      channel,
      input,
      correlationId,
      messages: body.messages,
    });
    if (localWorkItemResponse) {
      this.runtimeState.audit(
        userId,
        "runtime.chat.local_work_items",
        sessionId,
        correlationId,
        `Wrapper handled ${localWorkItemResponse.action} for work items on channel ${channel}.`,
      );
      this.setupSse(res);
      this.broadcastEvent(
        "success",
        "runtime",
        "runtime.work_items.local",
        "Work items handled locally",
        localWorkItemResponse.visibleText.slice(0, 180),
      );
      this.broadcastPatch({
        agent: {
          state: "success",
          model: this.resolveRuntimeConfig().model,
          channel: "Niki app -> Work items",
          currentTask: "Completed",
          summary: localWorkItemResponse.visibleText.slice(0, 180),
        },
      });
      res.write(toOpenAiStyleChunk(localWorkItemResponse.message));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

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

    try {
      const runRes = await fetch(`${apiServerUrl}/v1/runs`, {
        method: "POST",
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
          res.write(toOpenAiStyleChunk(delta));
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
          res.write(toOpenAiStyleChunk(`\n\n[[exec_status:parcial|hermes]]`));
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
        res.write(toOpenAiStyleChunk(fullText));
      }
      if (!emittedStatus) {
        res.write(toOpenAiStyleChunk("\n\n[[exec_status:verificada|hermes]]"));
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
      res.write(toOpenAiStyleChunk(`\n\n> Error al conectar con Hermes runtime: ${message}\n\n[[exec_status:sin_acciones|hermes]]`));
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

    res.write("data: [DONE]\n\n");
    res.end();
  }

  private async tryHandleWorkItemCommand(params: {
    userId: string;
    sessionId: string;
    channel: string;
    input: string;
    correlationId: string;
    messages?: Array<{ role?: string; content?: string }>;
  }): Promise<
    | {
        message: string;
        visibleText: string;
        action: "list" | "create" | "update" | "delete" | "noop";
      }
    | null
  > {
    const { userId, sessionId, channel, input, correlationId, messages } = params;
    const preferredIds = this.conversationContext.getPreferredWorkItemIds(
      userId,
      sessionId,
      channel,
    );

    const listKind = this.extractWorkItemListKind(input);
    if (listKind !== undefined) {
      const items = this.workItemsService.listRaw(userId, {
        kind: listKind ?? undefined,
        status: "open",
      });
      await this.conversationContext.recordWorkItemListing(
        userId,
        sessionId,
        channel,
        items,
      );
      const visibleText = this.formatWorkItemList(items, listKind ?? undefined);
      await this.conversationContext.recordAssistantReply(
        userId,
        sessionId,
        channel,
        visibleText,
      );
      return {
        action: "list",
        message: `${visibleText}\n\n[[exec_status:verificada|work_items]]`,
        visibleText,
      };
    }

    const createIntent = this.extractCreateWorkItemIntent(input);
    if (createIntent) {
      const created = this.workItemsService.create(
        userId,
        {
          ...createIntent,
          source: "chat",
          sourceSessionId: sessionId,
        },
        { actor: "chat", correlationId },
      );
      const item = {
        ...(created.item as Omit<WorkItem, "userId">),
        userId,
      } as WorkItem;
      await this.conversationContext.recordWorkItemMutation(
        userId,
        sessionId,
        channel,
        "create",
        item,
      );
      const visibleText = this.formatWorkItemCreatedMessage(item);
      await this.conversationContext.recordAssistantReply(
        userId,
        sessionId,
        channel,
        visibleText,
      );
      return {
        action: "create",
        message: `${visibleText}\n\n[[work_item_created:${item.id}]]\n[[exec_status:verificada|work_items]]`,
        visibleText,
      };
    }

    const importIntent = this.extractImportWorkItemsIntent(input, messages);
    if (importIntent) {
      if (importIntent.items.length === 0) {
        const visibleText =
          "No pude meter esas tareas en Tasks porque en el historial reciente no encontré una lista concreta para importar.";
        await this.conversationContext.recordAssistantReply(
          userId,
          sessionId,
          channel,
          visibleText,
        );
        return {
          action: "noop",
          message: `${visibleText}\n\n[[exec_status:sin_acciones|work_items]]`,
          visibleText,
        };
      }

      const createdItems = importIntent.items.map((item) =>
        this.workItemsService.create(
          userId,
          {
            kind: importIntent.targetKind,
            title: item.title,
            category: item.category,
            source: "chat",
            sourceSessionId: sessionId,
          },
          { actor: "chat", correlationId },
        ),
      );
      const firstItem = createdItems[0]?.item as Omit<WorkItem, "userId"> | undefined;
      const mutationItems = createdItems
        .map((created) => created.item as Omit<WorkItem, "userId"> | undefined)
        .filter(Boolean)
        .map((item) => ({ ...item, userId } as WorkItem));

      for (const item of mutationItems) {
        await this.conversationContext.recordWorkItemMutation(
          userId,
          sessionId,
          channel,
          "create",
          item,
        );
      }

      const visibleText = this.formatImportedWorkItemsMessage(
        mutationItems,
        importIntent.targetKind,
      );
      await this.conversationContext.recordAssistantReply(
        userId,
        sessionId,
        channel,
        visibleText,
      );
      return {
        action: "create",
        message: `${visibleText}${firstItem ? `\n\n[[work_item_created:${firstItem.id}]]` : ""}\n[[exec_status:verificada|work_items]]`,
        visibleText,
      };
    }

    const completeIntent = this.extractCompleteWorkItemIntent(input, preferredIds);
    if (completeIntent) {
      const match = this.workItemsService.findBestMatch(userId, completeIntent.query, {
        kind: completeIntent.kind,
        preferredIds,
      });
      if (!match) {
        const visibleText = `No encontré un task que coincida con "${completeIntent.query}".`;
        await this.conversationContext.recordAssistantReply(
          userId,
          sessionId,
          channel,
          visibleText,
        );
        return {
          action: "update",
          message: `${visibleText}\n\n[[exec_status:sin_acciones|work_items]]`,
          visibleText,
        };
      }
      const updated = this.workItemsService.update(
        userId,
        match.id,
        { status: "done" },
        { correlationId },
      );
      const item = {
        ...(updated.item as Omit<WorkItem, "userId">),
        userId,
      } as WorkItem;
      await this.conversationContext.recordWorkItemMutation(
        userId,
        sessionId,
        channel,
        "update",
        item,
      );
      const visibleText = `Listo, marqué "${item.title}" como hecho.`;
      await this.conversationContext.recordAssistantReply(
        userId,
        sessionId,
        channel,
        visibleText,
      );
      return {
        action: "update",
        message: `${visibleText}\n\n[[work_item_updated:${item.id}]]\n[[exec_status:verificada|work_items]]`,
        visibleText,
      };
    }

    const deleteIntent = this.extractDeleteWorkItemIntent(input, preferredIds.length > 0);
    if (deleteIntent) {
      const match = this.workItemsService.findBestMatch(userId, deleteIntent.query, {
        kind: deleteIntent.kind,
        preferredIds,
      });
      if (!match) {
        const visibleText = `No encontré un task que coincida con "${deleteIntent.query}".`;
        await this.conversationContext.recordAssistantReply(
          userId,
          sessionId,
          channel,
          visibleText,
        );
        return {
          action: "delete",
          message: `${visibleText}\n\n[[exec_status:sin_acciones|work_items]]`,
          visibleText,
        };
      }
      const deleted = this.workItemsService.delete(userId, match.id, { correlationId });
      const item = {
        ...(deleted.item as Omit<WorkItem, "userId">),
        userId,
      } as WorkItem;
      await this.conversationContext.recordWorkItemMutation(
        userId,
        sessionId,
        channel,
        "delete",
        item,
      );
      const visibleText = `Listo, eliminé "${item.title}".`;
      await this.conversationContext.recordAssistantReply(
        userId,
        sessionId,
        channel,
        visibleText,
      );
      return {
        action: "delete",
        message: `${visibleText}\n\n[[work_item_deleted:${item.id}]]\n[[exec_status:verificada|work_items]]`,
        visibleText,
      };
    }

    return null;
  }

  private async tryHandleFullAppSetupRequest(params: {
    userId: string;
    sessionId: string;
    channel: string;
    input: string;
    personaProfile: NikiPersonaProfile;
  }) {
    const { userId, sessionId, channel, input, personaProfile } = params;
    const normalized = this.normalizeIntentText(input);
    const looksLikeFullApp =
      /\b(app completa|aplicacion completa|complete app|full app|complete product|producto completo)\b/.test(
        normalized,
      ) ||
      (/\b(crea|build|haz|make|desarrolla)\b/.test(normalized) &&
        /\b(app|aplicacion|producto|product)\b/.test(normalized) &&
        /\b(completa|complete|full)\b/.test(normalized));

    if (!looksLikeFullApp) return null;

    const visibleText = this.formatFullAppSetupPlan(input, personaProfile);
    await this.conversationContext.recordAssistantReply(
      userId,
      sessionId,
      channel,
      visibleText,
    );
    return {
      message: `${visibleText}\n\n[[exec_status:pendiente|full_app_setup]]`,
      visibleText,
    };
  }

  private extractWorkItemListKind(input: string): WorkItemKind | null | undefined {
    const normalized = this.normalizeIntentText(input);
    const asksList =
      /(que tengo|que hay|muestrame|muestrame|muestrame|lista|show me|what do i have|list)/.test(
        normalized,
      ) || /^(mis|my)\b/.test(normalized);

    const taskLike = /\b(tarea|tareas|task|tasks|todo|to do)\b/.test(normalized);

    if (!asksList) return undefined;
    if (taskLike) return null;
    return undefined;
  }

  private extractCreateWorkItemIntent(input: string) {
    const normalized = this.normalizeIntentText(input);
    const isTaskLike =
      /\b(recordatorio|recordatorios|reminder|reminders|recu[eé]rdame|remind me|tarea|tareas|task|tasks)\b/.test(
        normalized,
      );
    const hasCreateVerb =
      /^(?:puedes\s+|podrias\s+|me ayudas a\s+|ayudame a\s+)?(?:pon|ponme|agrega|agregame|añade|anade|crea|creame|haz|hazme|add|create|make)\b/.test(
        normalized,
      ) ||
      /\b(?:añade|anade|agrega|crea|haz|add|create|make)\s+(?:una|un)?\s*(?:nuev[oa]\s+)?(?:tarea|task)\b/.test(
        normalized,
      ) ||
      /\b(recuerdame|recuérdame|remind me)\b/.test(normalized);

    if (!hasCreateVerb || !isTaskLike) return null;

    let working = input.trim();
    working = working
      .replace(
        /^(?:por favor\s+)?(?:puedes\s+|podrias\s+|me ayudas a\s+|ayudame a\s+)?(?:pon(?:me)?|agrega(?:me)?|a[nñ]ade|crea(?:me)?|haz(?:me)?|add|create|make)\s+(?:un|una)?\s*(?:nuev[oa]\s+)?\s*(?:recordatorio|reminder|tarea|task)\s*(?:dentro de niki|en niki|en la app de niki|inside niki|inside the niki app)?\s*(?:que diga|que diga que|sobre|to|de|para)?\s*/i,
        "",
      )
      .replace(/^(?:recu[eé]rdame|remind me)\s+/i, "");

    working = working
      .replace(/^(?:una|un)\s+(?:nuev[oa]\s+)?(?:tarea|task|recordatorio|reminder)\s+/i, "")
      .replace(/^(?:dentro de niki|en niki|en la app de niki|inside niki)\s+/i, "")
      .replace(/^(?:para|to|sobre)\s+/i, "");

    const schedule = this.extractScheduleFromText(working);
    working = schedule.remainingText;
    const category = this.extractCategoryFromText(working);
    working = category.remainingText
      .replace(/[.]+$/g, "")
      .replace(/^(?:el|la|los|las|un|una)\s+/i, "")
      .replace(/^(?:que diga(?: que)?|que sea|sobre)\s+/i, "")
      .trim();

    if (!working) return null;

    return {
      kind: "task" as const,
      title: working,
      category: category.category,
      dueAt: schedule.whenIso,
    };
  }

  private extractDeleteWorkItemIntent(input: string, hasPreferredContext: boolean) {
    const normalized = this.normalizeIntentText(input);
    if (!/^(elimina|borra|quita|remove|delete)\b/.test(normalized)) return null;

    const mentionsWorkItems =
      /\b(recordatorio|recordatorios|reminder|reminders|tarea|tareas|task|tasks)\b/.test(
        normalized,
      ) || hasPreferredContext;
    if (!mentionsWorkItems) return null;

    let working = input
      .trim()
      .replace(/^(?:por favor\s+)?(?:elimina|borra|quita|remove|delete)\s+/i, "")
      .replace(/^(?:el|la|los|las|un|una)\s+/i, "")
      .replace(/^(?:recordatorio|reminder|tarea|task)\s*(?:de|para)?\s*/i, "")
      .replace(/[.]+$/g, "")
      .trim();

    if (!working) return null;

    return {
      query: working,
      kind: "task" as const,
    };
  }

  private extractCompleteWorkItemIntent(input: string, preferredIds: string[]) {
    const normalized = this.normalizeIntentText(input);
    if (
      !/^(completa|marca|marcar|mark|complete|termina)\b/.test(normalized)
    ) {
      return null;
    }

    const hasContext =
      /\b(recordatorio|recordatorios|reminder|reminders|tarea|tareas|task|tasks)\b/.test(
        normalized,
      ) || preferredIds.length > 0;
    if (!hasContext) return null;

    const working = input
      .trim()
      .replace(/^(?:por favor\s+)?(?:completa|marca|marcar|mark|complete|termina)\s+/i, "")
      .replace(/^(?:el|la|los|las|un|una)\s+/i, "")
      .replace(/^(?:recordatorio|reminder|tarea|task)\s*(?:de|para)?\s*/i, "")
      .replace(/\b(?:como hecho|as done|done)\b/gi, "")
      .replace(/[.]+$/g, "")
      .trim();

    if (!working) return null;

    return {
      query: working,
      kind: "task" as const,
    };
  }

  private extractCategoryFromText(text: string) {
    const match = text.match(/\b(?:categoria|categoría|category)\s+([a-z0-9][a-z0-9\s-]{0,40})/i);
    if (!match?.[1]) {
      return {
        category: "General",
        remainingText: text.trim(),
      };
    }

    return {
      category: match[1].trim(),
      remainingText: text.replace(match[0], "").replace(/\s+/g, " ").trim(),
    };
  }

  private extractScheduleFromText(text: string) {
    let remainingText = text;
    let dayOffset = 0;
    let hour = 9;
    let minute = 0;
    let explicitTime = false;

    if (/\b(mañana|manana|tomorrow)\b/i.test(remainingText)) {
      dayOffset = 1;
      remainingText = remainingText.replace(/\b(mañana|manana|tomorrow)\b/gi, " ");
    } else if (/\b(hoy|today)\b/i.test(remainingText)) {
      remainingText = remainingText.replace(/\b(hoy|today)\b/gi, " ");
      hour = 18;
    }

    const timeMatch = remainingText.match(/\b(?:a las|at)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (timeMatch?.[1]) {
      hour = Number.parseInt(timeMatch[1], 10);
      minute = Number.parseInt(timeMatch[2] ?? "0", 10);
      const meridiem = String(timeMatch[3] ?? "").toLowerCase();
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      explicitTime = true;
      remainingText = remainingText.replace(timeMatch[0], " ");
    }

    const hadDateLanguage = dayOffset > 0 || /\b(hoy|today)\b/i.test(text);
    const whenIso =
      hadDateLanguage || explicitTime
        ? this.buildScheduledIso(dayOffset, hour, minute, explicitTime)
        : undefined;

    return {
      whenIso,
      remainingText: remainingText.replace(/\s+/g, " ").trim(),
    };
  }

  private extractImportWorkItemsIntent(
    input: string,
    messages?: Array<{ role?: string; content?: string }>,
  ) {
    const normalized = this.normalizeIntentText(input);
    const asksImport =
      /\b(puedes|podrias|podrias|me ayudas a|ayudame a|help me)\b/.test(normalized) ||
      /\b(pon|poner|mete|meter|agrega|agregar|pasa|pasar|integra|integrar|sincroniza|sincronizar|importa|importar|add|move|sync|import)\b/.test(
        normalized,
      );
    const mentionsTarget =
      /\b(tasks|task|tareas|recordatorios|reminders|reminder)\b/.test(normalized) &&
      /\b(app|niki)\b/.test(normalized);
    const refersToExistingSet =
      /\b(esas|esos|estas|estos|those|them|las de|los de)\b/.test(normalized) ||
      /\b(de reminders|de recordatorios|from reminders)\b/.test(normalized);

    if (!asksImport || !mentionsTarget || !refersToExistingSet) return null;

    return {
      targetKind: "task" as const,
      items: this.extractReferencedWorkItems(messages, "task"),
    };
  }

  private extractReferencedWorkItems(
    messages: Array<{ role?: string; content?: string }> | undefined,
    targetKind: WorkItemKind,
  ) {
    if (!messages?.length) return [];

    const seen = new Set<string>();
    const items: Array<{ title: string; category: string }> = [];
    const recentMessages = messages.slice(-6).reverse();

    for (const message of recentMessages) {
      const content = String(message.content ?? "").trim();
      if (!content) continue;

      for (const candidate of this.extractCandidateTitlesFromMessage(content)) {
        const normalized = this.normalizeIntentText(candidate);
        if (!normalized || seen.has(normalized)) continue;
        if (this.looksLikeNonTaskCandidate(candidate)) continue;

        seen.add(normalized);
        items.push({
          title: candidate,
          category: "Imported",
        });
        if (items.length >= 8) return items;
      }
    }

    return items;
  }

  private extractCandidateTitlesFromMessage(content: string) {
    const candidates: string[] = [];
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const bulletMatch = line.match(
        /^(?:[-*•]\s+|\d+\.\s+|\[\s?[x ]\s?\]\s*)(?:\[(?:Reminder|Task)\]\s*)?(.+)$/i,
      );
      if (bulletMatch?.[1]) {
        candidates.push(this.cleanCandidateTitle(bulletMatch[1]));
      }

      const labeledMatch = line.match(/^\[(?:Reminder|Task)\]\s+(.+)$/i);
      if (labeledMatch?.[1]) {
        candidates.push(this.cleanCandidateTitle(labeledMatch[1]));
      }

      const quoted = [...line.matchAll(/"([^"]{2,120})"/g)];
      for (const match of quoted) {
        if (match[1]) candidates.push(this.cleanCandidateTitle(match[1]));
      }
    }

    return candidates.filter(Boolean);
  }

  private cleanCandidateTitle(value: string) {
    return value
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .replace(/[.]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private looksLikeNonTaskCandidate(value: string) {
    const normalized = this.normalizeIntentText(value);
    if (!normalized) return true;
    if (normalized.length < 3) return true;
    if (
      /^(apple reminders|work items de niki|work items|resumen de tus tareas|tareas pendientes|apple|niki|notes)$/.test(
        normalized,
      )
    ) {
      return true;
    }
    if (
      /\b(sin fecha asignada|con fecha|tarea abierta|tareas pendientes|queres que haga algo)\b/.test(
        normalized,
      )
    ) {
      return true;
    }
    return false;
  }

  private formatImportedWorkItemsMessage(items: WorkItem[], kind: WorkItemKind) {
    const kindLabel = "tasks";
    if (items.length === 1) {
      return `Listo, metí 1 item en ${kindLabel}: "${items[0].title}".`;
    }
    const preview = items
      .slice(0, 3)
      .map((item) => `"${item.title}"`)
      .join(", ");
    const suffix = items.length > 3 ? "..." : "";
    return `Listo, metí ${items.length} items en ${kindLabel}: ${preview}${suffix}`;
  }

  private buildScheduledIso(dayOffset: number, hour: number, minute: number, explicitTime: boolean) {
    const target = new Date();
    target.setSeconds(0, 0);
    target.setDate(target.getDate() + dayOffset);
    target.setHours(hour, minute, 0, 0);

    if (!dayOffset && explicitTime && target.getTime() < Date.now()) {
      target.setDate(target.getDate() + 1);
    }

    return target.toISOString();
  }

  private formatWorkItemList(items: WorkItem[], kind?: WorkItemKind) {
    if (items.length === 0) {
      return "No tienes tasks pendientes.";
    }

    const heading = `Tienes ${items.length} tasks pendientes:`;
    const lines = items.map((item) => {
      const schedule = this.formatWorkItemSchedule(item);
      const prefix = item.proposalStatus === "proposed" ? "[Suggested]" : "[Task]";
      return `- ${prefix} ${item.title}${schedule ? ` (${schedule})` : ""}`;
    });
    return [heading, ...lines].join("\n");
  }

  private formatWorkItemCreatedMessage(item: WorkItem) {
    const schedule = this.formatWorkItemSchedule(item);
    const scheduleText = schedule ? ` para ${schedule}` : "";
    return `Listo, guardé el task "${item.title}"${scheduleText}.`;
  }

  private formatFullAppSetupPlan(input: string, personaProfile: NikiPersonaProfile) {
    const lead =
      personaProfile.responseStyle === "friendly"
        ? "Puedo desarrollar la app completa y dejar el runtime listo, pero esto queda como plan preparado hasta que confirmes la ejecución."
        : "Esto queda preparado como plan. No lo marco como instalado ni ejecutado todavía.";
    return [
      lead,
      "",
      "Plan base para app completa con runtime real:",
      "1. Definir alcance de la app y las superficies clave.",
      "2. Preparar Hermes: instalar, habilitar `API_SERVER_ENABLED=true`, y arrancar o reiniciar `hermes gateway`.",
      "3. Preparar OpenClaw: instalar/configurar gateway y validar la ruta runtime real.",
      "4. Conectar Niki/backend a Hermes y OpenClaw con validación de health/runtime.",
      "5. Implementar la app completa sobre ese runtime, no sobre mocks.",
      "",
      "Checklist Hermes/OpenClaw incluido por defecto:",
      "- Hermes install",
      "- Hermes API server enablement",
      "- Hermes gateway start/restart",
      "- OpenClaw install/setup path",
      "- OpenClaw gateway/runtime validation",
      "",
      `Pedido detectado: "${input.trim()}"`,
      "Si quieres, el siguiente paso es convertir este plan en tareas concretas o en una automatización revisable.",
    ].join("\n");
  }

  private formatWorkItemSchedule(item: WorkItem) {
    const iso = item.dueAt;
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("es-CR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private normalizeIntentText(text: string) {
    return String(text ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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

  private syncHermesConfigFile(runtimeConfig: ResolvedRuntimeConfig) {
    const filePath = hermesConfigPath();
    if (!existsSync(filePath)) return;

    try {
      let raw = readFileSync(filePath, "utf8");

      if (runtimeConfig.model.trim()) {
        if (/\nmodel:\n/m.test(raw)) {
          if (/(\nmodel:\n(?:[ \t]+.*\n)*)[ \t]+default:\s*.*\n/m.test(raw)) {
            raw = raw.replace(
              /(\nmodel:\n(?:[ \t]+.*\n)*)[ \t]+default:\s*.*\n/m,
              (match) =>
                match.replace(
                  /([ \t]+default:\s*).*/,
                  `$1${runtimeConfig.model.trim()}`,
                ),
            );
          } else {
            raw = raw.replace(/\nmodel:\n/m, `\nmodel:\n  default: ${runtimeConfig.model.trim()}\n`);
          }
        }
      }

      raw = raw.replace(/^[ \t]*model\.context_length:\s*.*\n?/m, "");

      if (runtimeConfig.contextLengthOverride && runtimeConfig.contextLengthOverride > 0) {
        if (/(\nmodel:\n(?:[ \t]+.*\n)*)[ \t]+context_length:\s*.*\n/m.test(raw)) {
          raw = raw.replace(
            /(\nmodel:\n(?:[ \t]+.*\n)*)[ \t]+context_length:\s*.*\n/m,
            (match) =>
              match.replace(
                /([ \t]+context_length:\s*).*/,
                `$1${runtimeConfig.contextLengthOverride}`,
              ),
          );
        } else if (/\nmodel:\n/m.test(raw)) {
          raw = raw.replace(/\nmodel:\n/m, `\nmodel:\n  context_length: ${runtimeConfig.contextLengthOverride}\n`);
        }
      }

      writeFileSync(filePath, raw, "utf8");
    } catch (error) {
      this.logger.warn(
        `[runtime] could not sync Hermes config file ${filePath}: ${formatUnknownError(error)}`,
      );
    }
  }

  private resolveRuntimeConfig(): ResolvedRuntimeConfig {
    const config = this.configService.get();
    const apiServerUrl = (
      this.runtimeConfigOverride.apiServerUrl ?? config.hermesApiServerUrl
    )
      .trim()
      .replace(/\/+$/, "");
    const apiKey = (this.runtimeConfigOverride.apiKey ?? config.hermesApiKey).trim();
    const model = (this.runtimeConfigOverride.model ?? config.hermesModel).trim();
    const contextLengthOverride =
      this.runtimeConfigOverride.contextLengthOverride ?? null;
    const compatibilityMode =
      this.runtimeConfigOverride.compatibilityMode ?? "standard";
    const diagnosticsEnabled =
      this.runtimeConfigOverride.diagnosticsEnabled ?? false;

    return {
      apiServerUrl,
      apiKey,
      model,
      contextLengthOverride,
      compatibilityMode,
      diagnosticsEnabled,
      source: {
        apiServerUrl: this.runtimeConfigOverride.apiServerUrl !== undefined ? "settings" : "env",
        apiKey: this.runtimeConfigOverride.apiKey !== undefined ? "settings" : "env",
        model: this.runtimeConfigOverride.model !== undefined ? "settings" : "env",
        contextLengthOverride:
          this.runtimeConfigOverride.contextLengthOverride !== undefined
            ? "settings"
            : "default",
        compatibilityMode:
          this.runtimeConfigOverride.compatibilityMode !== undefined
            ? "settings"
            : "default",
        diagnosticsEnabled:
          this.runtimeConfigOverride.diagnosticsEnabled !== undefined
            ? "settings"
            : "default",
      } as const,
    };
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
      listener.write(payload);
    }
  }

  private ensureHeartbeat() {
    if (this.heartbeatId) return;
    this.heartbeatId = setInterval(() => {
      void this.broadcastRuntimeHeartbeat();
    }, this.heartbeatMs);
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
