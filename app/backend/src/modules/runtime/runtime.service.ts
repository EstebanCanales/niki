import { resolve } from "path";
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
import { projectRuntimeCapabilities, type RuntimeCapabilities } from "./runtime-capabilities";
import {
  parseHermesRuntimeConfig,
  serializeHermesRuntimeConfig,
  type HermesCompatibilityMode,
} from "./hermes-config";
import { requestHermesSessionHandoff, undoHermesSessionLastExchange } from "./runtime-session-actions";
import {
  projectRuntimeSessions,
  readHermesChannelDirectoryPlatforms,
  readHermesSessionDbRows,
  readHermesSessionsIndex,
} from "./runtime-sessions";
import {
  parseHermesMcpServers,
  projectRuntimeMcpServers,
  readHermesMcpConfigRaw,
  toggleHermesMcpServerEnabled,
} from "./runtime-mcp";
import { projectRuntimeProfiles } from "./runtime-profiles";
import { projectDiscoverCapabilities } from "./runtime-discover";
import {
  buildCapabilitiesEvent,
  buildInitialRuntimeEvents,
  buildMcpSnapshotEvent,
  buildProfilesSnapshotEvent,
  buildSessionActionEvent,
  buildRuntimeBroadcastSignature,
  buildSessionsSnapshotEvent,
  buildSurfaceClearEvent,
  buildSurfaceEvent,
  normalizeHermesApprovalEvent,
  normalizeHermesDiagnosticsEvent,
  type RuntimeApprovalRequest,
  type RuntimeConnectionState,
  type RuntimePatch,
  type RuntimeSurfacePayload,
  type RuntimeUpdate,
} from "./runtime-events";
import { applyApprovalResolution } from "./runtime-approval-state";
import { geocodeAddress } from "./runtime-geocode";
import { RuntimeSurfaceIntentService } from "./runtime-surface-intent.service";
import { NikiVoiceRuntimeService } from "./niki-voice-runtime.service";
import { preguntaRepetida } from "./runtime-repeticion";
import { TurnRecorderService } from "./turn-recorder.service";

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

const NIKI_BASE_INSTRUCTIONS = `You are Niki, Esteban's personal assistant inside the Niki desktop app on his Mac. You talk with him two ways: by text in the chat, and by voice in a live, call-style conversation. Hermes is the runtime that powers you — never call yourself Hermes, never mention runtimes, models, prompts, or "as an AI." You are simply Niki.

# How you think
You are an agent, not a chatbot. Reason briefly about what Esteban actually wants, check it against the context you were given, then act. If a request maps to something you can DO with your tools, do it (or take the concrete first step) instead of describing how he could do it himself. Don't narrate your reasoning or list everything you could theoretically do — one clear, coherent reply beats a wall of options. You feel smart by being coherent, by remembering, and by connecting the dots, not by talking a lot.

# How you sound
Talk like a sharp, warm, switched-on person who knows Esteban — never a robot reading a manual. Use his name naturally when it lands, not in every sentence. Use contractions and an easy rhythm. Match his energy: quick and casual when he is, focused and tight when he's serious. Lead with the answer or the action; skip preamble like "Sure, I can help with that!" — just help. Always reply in his language (Spanish or English, matching whatever he used).

# Conversation continuity
Treat the exchange as one ongoing conversation, not a collection of unrelated prompts. Use the immediately previous turn to resolve short follow-ups, pronouns, and emotional context. Do not repeat a greeting, a plan, or facts Esteban already acknowledged. If he is just sharing something, respond to the human meaning before offering an action. If you completed an action, say what changed in one natural sentence. Ask at most one focused question, and only when the next step truly depends on it. When the request is clear, act without asking for permission to do ordinary low-risk work.

# What you can actually do (know this cold — half of sounding dumb is not knowing your own reach)
You genuinely control this Mac and manage Esteban's world. Never say "I can't" to something you can; never claim a capability you don't have.
- Control macOS (computer_use): screen_capture (snapshot the desktop, to see what he's looking at), screen_info (display layout), app_list (running apps and which is focused — use it to resolve "this app" / "the one I have open"), app_activate(name) (open or focus an app — this is how you "open Safari", "ábrela", "switch to Notes"), open_url(url) (open a web page for "open <site>", "go to…", "look this up"), clipboard_read (read copied text for "what I just copied" / "this"), clipboard_write(text) (put text on the clipboard so he can paste it), system_info (host, OS, memory, uptime), notify(message) (native macOS notification).
- Manage his tasks (work_items): create, list, update, and complete them, each with category, priority, due date, and subtasks. His current tasks arrive in your context as activeWorkItems — reason over them; never invent tasks or ask him to re-list what you already have.
- Durable memory: you remember facts across sessions — his name, preferences, and anything he tells you to remember ("recuerda que…", "from now on…"). Relevant memory arrives as durableMemory; apply it proactively.
- Sessions: handoff across devices, multi-profile, and /undo to reverse a recent action.
- Connected tools when available: MCP servers, web/x search and video generation (discover), and LSP diagnostics after code edits.
High-risk actions go through an approval step — that's expected, not a failure; say plainly what you're about to do and let the approval flow handle it. Some capabilities are gated and may be off in the current setup; if a tool isn't available right now, say so honestly and offer the closest thing — don't pretend it worked.

# Use the context you're given (this is what makes you feel smart)
Each turn you receive an authoritative context object. Read it every turn and let it shape your reply:
- user — who you're talking to (displayName "Esteban", email, jurisdiction). Address him by name when it fits.
- session — lastUserRequest, lastAssistantSummary, lastDomain, recent references. This is your short-term memory of THIS conversation. Resolve follow-ups and pronouns from it: "ábrela", "open it", "that one", "the second task", "do it again", "delete it" almost always mean the most recent relevant app/task/item. Resolve the reference confidently instead of asking.
- durableMemory — facts to remember across sessions. Treat as known truth; honor stated preferences without being reminded twice.
- activeWorkItems — his real current tasks (real titles, real due dates). Ground task and status answers here.
- recentActivities — what recently happened; use it for "what did I just do", "again", "the last one".
If a field is absent or empty, just proceed — never read invented values into it. Only ask a clarifying question when the context genuinely leaves it ambiguous, and then ask one short, specific question.

# When to ask vs act
Default to acting. Resolve ambiguity yourself from session, recentActivities, and activeWorkItems first. Ask only when the request is genuinely ambiguous AND guessing wrong would be costly or destructive (deleting, sending, overwriting, spending). One sharp question, not a checklist.

# Honesty (non-negotiable)
Never fake work. Only report an action as done if you actually invoked the tool and it succeeded — otherwise speak in intent ("Opening Safari now", "I'll add that task"), not false past tense. If something failed, is pending approval, or is outside your tools, say so directly and propose the real next step. Never invent task titles, file names, dates, memories, or capabilities that aren't in your context. If you don't know, say so — that's smarter than guessing.

# Style
Be concise, practical, and action-oriented. Lead with the result or the action, then the minimum necessary detail. Propose concrete next steps ("Want me to open it?", "I can add that as a task") over vague offers. In the chat you may use light Markdown when it genuinely helps scanning (a short list, a code block for code), but never pad a simple answer with structure it doesn't need.`;

const NIKI_VOICE_ADDENDUM = `# MODO VOZ — estás conversando en directo con Esteban
Esteban escucha tus palabras por síntesis de voz; no las está leyendo. Escribe exactamente como hablaría una persona, con frases naturales y fáciles de escuchar.
- No uses Markdown: nada de asteriscos, títulos, viñetas, listas numeradas, bloques de código, tablas, enlaces ni emojis.
- Responde normalmente en una a cuatro frases cortas. Di primero lo importante. Amplía solo si te lo pide o si la situación lo necesita.
- Mantén el hilo: responde al último turno y no vuelvas a saludar ni a repetir lo que ya quedó claro. Si Esteban dice "sí", "eso", "hazlo" o algo parecido, usa el contexto inmediato para entenderlo.
- Conversa, no recites. Puedes decir "Entiendo", "Ya veo" u "Voy con eso" cuando encaje, pero no pongas una muletilla antes de cada respuesta.
- Si solo está compartiendo algo, reconoce la intención humana antes de ofrecer soluciones. Si cuenta un problema, primero demuestra que lo entendiste y después propone el siguiente paso.
- Si ejecutaste una acción, confirma el resultado en una frase natural. No describas herramientas, prompts, modelos ni pasos internos.
- Si falta información imprescindible, haz una sola pregunta concreta y espera. No hagas interrogatorios ni enumeres alternativas innecesarias.
- Habla para el oído: usa palabras, pausas y frases; evita URLs, símbolos, código, cifras difíciles de leer y estructuras visuales.
Si una respuesta sonaría rara al decirla en voz alta, reescríbela hasta que suene como una conversación real.`;

function buildNikiRuntimeInstructions(channel?: string, contextJson?: string) {
  const parts = [NIKI_BASE_INSTRUCTIONS];

  if (channel === "niki-voice") {
    parts.push(NIKI_VOICE_ADDENDUM);
  }

  if (contextJson) {
    parts.push(`Wrapper context JSON: ${contextJson}`);
  }

  return parts.join("\n\n");
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
  // La config del runtime de Niki, no la del Hermes personal del usuario.
  return (
    process.env.HERMES_CONFIG_PATH?.trim() ||
    resolve(__dirname, "..", "..", "..", "agent-home", "config.yaml")
  );
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
  /** Cuántos turnos se fueron al gateway externo. Ver el comentario en proxyChatStream. */
  private externalRuntimeTurns = 0;
  private readonly listeners = new Set<Response>();
  private readonly pendingApprovals = new Map<string, RuntimeApprovalRequest>();
  private readonly heartbeatMs = 15_000;
  private hasActiveSurface = false;
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
    @Inject(RuntimeSurfaceIntentService)
    private readonly surfaceIntent: RuntimeSurfaceIntentService,
    @Inject(NikiVoiceRuntimeService)
    private readonly voiceRuntime: NikiVoiceRuntimeService,
    @Inject(TurnRecorderService)
    private readonly turnRecorder: TurnRecorderService,
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

  getRuntimeCapabilities() {
    const runtimeConfig = this.resolveRuntimeConfig();
    const computerConfig = this.computer.getConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);

    return projectRuntimeCapabilities({
      hermes: {
        computerUse:
          computerConfig.mode !== "locked" &&
          Boolean(computerConfig.inputHelper?.available) &&
          this.computer.capabilitiesList().length > 0,
        approvals: runtimeConfig.compatibilityMode === "hermes_agent" && compatibility.ok,
        mcpCatalog: runtimeConfig.compatibilityMode === "hermes_agent" && compatibility.ok,
        xSearch: runtimeConfig.compatibilityMode === "hermes_agent" && compatibility.ok,
        videoGenerate: runtimeConfig.compatibilityMode === "hermes_agent" && compatibility.ok,
        remoteSessions: compatibility.ok,
        lspDiagnostics: runtimeConfig.diagnosticsEnabled && compatibility.ok,
      },
      flags: {
        computer: process.env.NIKI_FEATURE_COMPUTER !== "0",
        approvals: process.env.NIKI_FEATURE_APPROVALS !== "0",
        mcp: process.env.NIKI_FEATURE_MCP !== "0",
        discover: process.env.NIKI_FEATURE_DISCOVER !== "0",
        sessions: process.env.NIKI_FEATURE_SESSIONS !== "0",
        diagnostics: process.env.NIKI_FEATURE_DIAGNOSTICS !== "0",
      },
    });
  }

  getRuntimeSessions() {
    const runtimeConfig = this.resolveRuntimeConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    return projectRuntimeSessions(readHermesSessionsIndex(), readHermesSessionDbRows(), {
      handoffSupported: compatibility.ok,
      undoSupported: compatibility.ok,
      availableHandoffTargets: readHermesChannelDirectoryPlatforms(),
    });
  }

  requestSessionHandoff(input: { sessionId?: string; platform?: string }) {
    const runtimeConfig = this.resolveRuntimeConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    if (!compatibility.ok) {
      throw new BadRequestException("Hermes gateway compatibility is required before session handoff can be used.");
    }

    const sessionId = String(input.sessionId ?? "").trim();
    const platform = String(input.platform ?? "")
      .trim()
      .toLowerCase();
    const session = this.getRuntimeSessions().find((entry) => entry.id === sessionId);

    if (!session) {
      throw new BadRequestException("Hermes session not found.");
    }
    if (!platform) {
      throw new BadRequestException("A handoff platform is required.");
    }
    if (!session.canHandoff) {
      throw new BadRequestException(session.canHandoffReason || "This session cannot be handed off right now.");
    }
    if (!session.handoffTargets?.includes(platform)) {
      throw new BadRequestException(`Hermes cannot hand off this session to ${platform} right now.`);
    }

    const result = requestHermesSessionHandoff({ sessionId, platform });
    if (!result.ok) {
      throw new BadRequestException(result.error || "Hermes rejected the handoff request.");
    }

    this.lastBroadcastState = "";
    this.broadcast(
      buildSessionActionEvent({
        sessionId,
        action: "handoff",
        status: "success",
        summary: `Handoff requested to ${result.platform ?? platform}.`,
        detail: "Hermes marked the session as pending handoff.",
        platform: result.platform ?? platform,
      }),
    );
    this.broadcastSessionsSnapshot();
    this.broadcastProfilesSnapshot();
    void this.broadcastRuntimeHeartbeat();

    return result;
  }

  requestSessionUndo(input: { sessionId?: string }) {
    const runtimeConfig = this.resolveRuntimeConfig();
    const compatibility = this.evaluateHermesCompatibility(runtimeConfig);
    if (!compatibility.ok) {
      throw new BadRequestException("Hermes gateway compatibility is required before session undo can be used.");
    }

    const sessionId = String(input.sessionId ?? "").trim();
    const session = this.getRuntimeSessions().find((entry) => entry.id === sessionId);
    if (!session) {
      throw new BadRequestException("Hermes session not found.");
    }
    if (!session.canUndo) {
      throw new BadRequestException(session.canUndoReason || "This session cannot be undone right now.");
    }

    const result = undoHermesSessionLastExchange({ sessionId });
    if (!result.ok) {
      throw new BadRequestException(result.error || "Hermes rejected the undo request.");
    }

    this.lastBroadcastState = "";
    this.broadcast(
      buildSessionActionEvent({
        sessionId,
        action: "undo",
        status: "success",
        summary: result.preview?.trim()
          ? `Undid last exchange: ${result.preview}`
          : "Last Hermes exchange removed.",
        detail: result.preview?.trim()
          ? "Hermes rewrote the session transcript and state."
          : "Hermes rewrote the session transcript.",
        removed: result.removed,
      }),
    );
    this.broadcastSessionsSnapshot();
    this.broadcastProfilesSnapshot();
    void this.broadcastRuntimeHeartbeat();

    return result;
  }

  getRuntimeMcpServers() {
    return projectRuntimeMcpServers(parseHermesMcpServers(readHermesMcpConfigRaw()));
  }

  updateRuntimeMcpServer(input: { id?: string; enabled?: boolean }) {
    const serverId = String(input.id ?? "").trim();
    if (!serverId) {
      throw new BadRequestException("MCP server id is required.");
    }
    if (typeof input.enabled !== "boolean") {
      throw new BadRequestException("MCP server enabled must be a boolean.");
    }

    const raw = readHermesMcpConfigRaw();
    const next = toggleHermesMcpServerEnabled(raw, serverId, input.enabled);
    writeFileSync(this.hermesConfigFilePath, next, "utf8");
    this.hermesProbeCache.clear();
    this.lastBroadcastState = "";
    this.broadcastMcpSnapshot();
    void this.broadcastRuntimeHeartbeat();

    return {
      ok: true,
      servers: this.getRuntimeMcpServers(),
    };
  }

  getRuntimeProfiles() {
    return projectRuntimeProfiles(this.getRuntimeSessions());
  }

  getRuntimeDiscoverCapabilities(profileId?: string) {
    const capabilities = this.getRuntimeCapabilities().capabilities;
    const normalizedProfileId = String(profileId ?? "").trim() || "default";
    return {
      profileId: normalizedProfileId,
      capabilities: projectDiscoverCapabilities({
        xSearch: capabilities.x_search?.available ?? false,
        videoGenerate: capabilities.video_generate?.available ?? false,
        profileLabel: normalizedProfileId,
      }),
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
      approvals: {
        pending: Array.from(this.pendingApprovals.values()),
      },
      operatorConsole: this.getRuntimeCapabilities(),
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
        "showSurface",
        "clearSurface",
      ],
    };
  }

  async showSurface(input: {
    kind: RuntimeSurfacePayload["kind"];
    title?: string;
    subtitle?: string;
    query?: string;
    url?: string;
    location?: RuntimeSurfacePayload["location"];
    modelUrl?: string;
  }) {
    if (input.kind !== "search" && input.kind !== "map" && input.kind !== "model3d") {
      throw new BadRequestException("kind must be one of: search, map, model3d");
    }
    let location = input.location;
    if (input.kind === "map" && location && (location.lat === undefined || location.lng === undefined)) {
      const query = location.address || location.label;
      if (query) {
        const geocoded = await geocodeAddress(query);
        if (geocoded) location = { ...location, lat: geocoded.lat, lng: geocoded.lng };
      }
    }
    const payload: RuntimeSurfacePayload = {
      id: `surface:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind: input.kind,
      title: input.title?.trim() || input.query?.trim() || input.location?.label || "Surface",
      subtitle: input.subtitle,
      query: input.query,
      url: input.url,
      location,
      modelUrl: input.modelUrl,
      createdAt: new Date().toISOString(),
    };
    this.hasActiveSurface = true;
    this.broadcast(buildSurfaceEvent(payload));
    return { ok: true, surface: payload };
  }

  clearSurface() {
    this.hasActiveSurface = false;
    this.broadcast(buildSurfaceClearEvent());
    return { ok: true };
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
    // Un cliente recién conectado empieza sin ninguna surface visible localmente.
    this.hasActiveSurface = false;
    await this.emitInitialRuntimeState(res);
    req.on("close", () => {
      this.listeners.delete(res);
      res.end();
    });
  }

  /**
   * Contesta un turno hablado por la ruta rápida. Devuelve false si no llegó a escribir
   * nada, para que quien llama pueda caer a Hermes sin que el usuario note el intento.
   */
  private async streamVoiceReply(
    res: Response,
    input: string,
    body: ChatRequestDto,
    userId: string,
    sessionId: string,
    channel: string,
  ): Promise<boolean> {
    const history = (body.messages ?? [])
      .slice(0, -1)
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0,
      );

    let wrote = false;
    let full = "";
    const empezo = Date.now();

    try {
      this.broadcastPatch({
        agent: { state: "thinking", model: "voz", channel: "Niki app -> voz", currentTask: "Respondiendo", summary: input.slice(0, 180) },
      });

      for await (const delta of this.voiceRuntime.stream(input, history)) {
        if (res.writableEnded) break;
        wrote = true;
        full += delta;
        res.write(toOpenAiStyleChunk(delta));
      }

      if (!wrote) return false;

      res.write("data: [DONE]\n\n");
      res.end();

      // Nada de esto lo espera el usuario: va después de cerrar el stream.
      void this.conversationContext
        .recordAssistantReply(userId, sessionId, channel, full)
        .catch(() => undefined);
      // El turno completo al dataset. `recordAssistantReply` guarda solo un resumen en
      // memoria; la ruta rápida no pasa por el runtime, así que si no se anota acá, la
      // conversación hablada no queda en ningún lado.
      this.turnRecorder.record({
        sessionId,
        userId,
        channel,
        input,
        reply: full,
        model: "voz",
        latencyMs: Date.now() - empezo,
      });
      this.broadcastPatch({ agent: { state: "idle", model: "voz", channel: "Niki app -> voz", currentTask: "", summary: full.slice(0, 180) } });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[voz] ruta rápida falló (${message})`);
      if (wrote) {
        // Ya se habló: no se puede rehacer el turno por Hermes sin repetirse.
        res.write("data: [DONE]\n\n");
        res.end();
        return true;
      }
      return false;
    }
  }

  /** Qué hay guardado para entrenar: cuántos turnos, de qué días, cuánto ocupa. */
  resumenDataset() {
    return this.turnRecorder.resumen();
  }

  /** Prende o apaga la captura. Apagada no se guarda nada, ni turnos ni señales. */
  configurarCaptura(body: { enabled?: boolean }) {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("enabled (boolean) is required");
    }
    this.turnRecorder.capturar(body.enabled);
    return this.turnRecorder.resumen();
  }

  /**
   * Borra lo capturado, todo o de un día.
   *
   * Pide `confirmar: true` a propósito: son conversaciones que no se pueden recuperar, y
   * un endpoint de borrado que se dispara con un pedido vacío es cuestión de tiempo.
   */
  borrarDataset(body: { dia?: string; confirmar?: boolean }) {
    if (body.confirmar !== true) {
      throw new BadRequestException("confirmar: true is required — esto no se puede deshacer");
    }
    const dia = String(body.dia ?? "").trim();
    if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      throw new BadRequestException("dia tiene que ser YYYY-MM-DD");
    }
    const { borrados } = this.turnRecorder.borrar(dia || undefined);
    return { borrados, ...this.turnRecorder.resumen() };
  }

  /**
   * Marca que Esteban cortó a Niki a mitad de frase.
   *
   * Se guarda cuánto alcanzó a decir antes del corte: no es lo mismo que la interrumpa en
   * la primera palabra —se equivocó de tema— que a los treinta segundos —se estaba yendo
   * por las ramas—. Sin ese dato, la señal dice "algo salió mal" y nada más.
   */
  marcarInterrupcion(body: { sessionId?: string; spoken?: string }) {
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) throw new BadRequestException("sessionId is required");
    const dicho = String(body.spoken ?? "").trim();
    this.turnRecorder.signal(
      sessionId,
      "interrupcion",
      dicho ? `alcanzó a decir: ${dicho}` : undefined,
    );
    return { ok: true };
  }

  async proxyChatStream(req: Request, res: Response, body: ChatRequestDto) {
    const input = String(body.input ?? body.messages?.at(-1)?.content ?? "").trim();
    if (!input) throw new BadRequestException("input is required");

    const userId = actingUserIdFrom(req);
    const correlationId = correlationIdFrom(req);
    const sessionId = String(body.sessionId ?? "session").trim() || "session";
    const channel = String(body.channel ?? "niki-agent").trim() || "niki-agent";

    // El contexto corto es de proceso y lo lee buildRuntimeContext — va primero y sin
    // await porque no toca la red.
    this.conversationContext.captureUserTurnContext(userId, sessionId, channel, input);

    // Todo lo que necesita memoria arranca junto. UserMemoryService deduplica las
    // lecturas en vuelo y las cachea 30 s, así que estos tres caminos comparten una
    // sola ida a Upstash — y del segundo turno de una llamada en adelante, ninguna.
    const [memoryEntries, personaProfile, runtimeContext] = await Promise.all([
      this.conversationContext.prefetchMemory(userId),
      this.conversationContext.getPersonaProfile(userId),
      this.conversationContext.buildRuntimeContext(userId, sessionId, channel),
    ]);

    // Guardar hechos explícitos es una escritura que nadie lee en esta respuesta:
    // esperarla solo retrasaba el primer token.
    void this.conversationContext
      .persistExplicitFacts(userId, input, memoryEntries)
      .catch((error) => this.logger.warn(`[runtime] persistExplicitFacts: ${String(error)}`));

    // body.messages incluye el turno actual como último elemento (ver NikiAppModel
    // buildHermesMessages) — lo excluimos para no duplicarlo como "historial".
    const surfaceHistory = (body.messages ?? [])
      .slice(0, -1)
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0,
      );

    // Señal para el dataset: si repregunta lo mismo, la respuesta anterior no sirvió.
    // Se calcula del historial que ya vino en el pedido, sin estado ni llamadas extra.
    const repregunta = preguntaRepetida(surfaceHistory, input);
    if (repregunta) this.turnRecorder.signal(sessionId, "repeticion", repregunta);

    void this.surfaceIntent
      .detect(input, this.hasActiveSurface, surfaceHistory)
      .then((result) => {
        if (result.action === "show") {
          this.hasActiveSurface = true;
          this.broadcast(buildSurfaceEvent(result.payload));
        } else if (result.action === "clear") {
          this.hasActiveSurface = false;
          this.broadcast(buildSurfaceClearEvent());
        }
      })
      .catch((err) => this.logger.warn(`[runtime] surface intent detection failed: ${String(err)}`));

    this.runtimeState.audit(
      userId,
      "runtime.chat.proxy",
      sessionId,
      correlationId,
      `Prompt sent to Hermes runtime for channel ${channel}.`,
    );

    this.setupSse(res);

    // Ruta rápida del canal de voz. Hermes tarda 3-11 s en el primer token porque es un
    // agente con razonamiento y herramientas; una charla hablada no necesita nada de eso
    // y sí necesita contestar ya. Solo los turnos que piden trabajo real siguen de largo
    // hacia Hermes.
    if (
      channel === "niki-voice" &&
      this.voiceRuntime.isEnabled() &&
      !this.voiceRuntime.needsFullAgent(input)
    ) {
      const handled = await this.streamVoiceReply(res, input, body, userId, sessionId, channel);
      if (handled) return;
      // Si la ruta rápida falló antes de escribir nada, se cae a Hermes sin que se note.
      // Para el dataset sí se anota: ese turno era más difícil de lo que parecía.
      this.turnRecorder.signal(sessionId, "cayo-al-agente");
    }

    this.broadcastEvent("info", "runtime", "runtime.chat.request", "Hermes request started", input.slice(0, 180));
    const runtimeConfig = this.resolveRuntimeConfig();

    // Telemetría del corte: Niki apunta a su runtime interno (8643). Si algún turno sale
    // por el Hermes externo es porque alguien puso HERMES_API_SERVER_URL a mano, y eso
    // tiene que verse — el plan es borrar el camino viejo cuando esto pase días en cero,
    // y esa decisión se toma con datos, no con una corazonada.
    if (!runtimeConfig.apiServerUrl.includes(":8643")) {
      this.externalRuntimeTurns += 1;
      this.logger.warn(
        `[runtime] turno por el Hermes EXTERNO (${runtimeConfig.apiServerUrl}) — van ${this.externalRuntimeTurns} desde que arrancó el backend`,
      );
    }
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
        const approvalEvent = normalizeHermesApprovalEvent(eventType, parsed.data);
        const diagnosticsEvent = normalizeHermesDiagnosticsEvent(eventType, parsed.data);

        if (approvalEvent?.kind === "approval_request") {
          this.pendingApprovals.set(approvalEvent.payload.id, approvalEvent.payload);
          this.broadcast(approvalEvent);
        } else if (approvalEvent?.kind === "approval_resolved") {
          this.pendingApprovals.delete(approvalEvent.payload.id);
          this.broadcast(approvalEvent);
        }

        if (diagnosticsEvent?.kind === "diagnostics") {
          this.broadcast(diagnosticsEvent);
        }

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
    const events = buildInitialRuntimeEvents({
      status: {
        state: status.state,
        apiServerUrl: status.apiServerUrl,
        resolvedModel: status.resolvedModel,
        detail: status.detail,
      },
      capabilities: this.getRuntimeCapabilities(),
      sessions: this.getRuntimeSessions(),
      mcpServers: this.getRuntimeMcpServers(),
      profiles: this.getRuntimeProfiles(),
    });

    for (const event of events) {
      res.write(toSseData(event satisfies RuntimeUpdate));
    }

    for (const approval of this.pendingApprovals.values()) {
      res.write(toSseData({ kind: "approval_request", payload: approval } satisfies RuntimeUpdate));
    }
  }

  async respondToApproval(input: { runId?: string; choice?: string; all?: boolean }) {
    const runtimeConfig = this.resolveRuntimeConfig();
    const runId = String(input.runId ?? "").trim();
    const choice = String(input.choice ?? "").trim().toLowerCase();
    const resolveAll = Boolean(input.all);
    if (!runId) {
      throw new BadRequestException("runId is required");
    }
    if (!choice) {
      throw new BadRequestException("choice is required");
    }

    const response = await fetch(`${runtimeConfig.apiServerUrl}/v1/runs/${runId}/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.hermesHeaders("user-demo", "approval-response"),
      },
      body: JSON.stringify({
        choice,
        all: resolveAll,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new BadRequestException(`Hermes approval failed: ${JSON.stringify(payload)}`);
    }

    // Qué herramienta pedía cada aprobación, antes de que se vacíe la lista: sin esto la
    // señal diría "rechazó algo" en vez de "rechazó un borrado con terminal".
    const matchedTools = new Map(
      Array.from(this.pendingApprovals.values()).map((a) => [a.id, a.toolName]),
    );

    const projected = applyApprovalResolution(Array.from(this.pendingApprovals.values()), {
      runId,
      choice,
      all: resolveAll,
    });
    this.pendingApprovals.clear();
    for (const approval of projected.pending) {
      this.pendingApprovals.set(approval.id, approval);
    }
    for (const resolution of projected.resolved) {
      // Señal para el dataset: aceptar o rechazar una acción es preferencia explícita, la
      // señal más limpia que hay — no hay que inferir nada. Las aprobaciones no llevan
      // sessionId, así que se atan por runId.
      const aprobada = resolution.decision !== "deny";
      this.turnRecorder.signal(
        resolution.runId,
        aprobada ? "aprobacion" : "rechazo",
        `${resolution.decision}: ${matchedTools.get(resolution.id) ?? ""}`.trim(),
      );
      this.broadcast({
        kind: "approval_resolved",
        payload: resolution,
      });
    }
    this.lastBroadcastState = "";
    void this.broadcastRuntimeHeartbeat();

    return {
      ok: true,
      approval: payload,
    };
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

  private broadcastCapabilities(capabilities: RuntimeCapabilities) {
    this.broadcast(buildCapabilitiesEvent(capabilities));
  }

  private broadcastSessionsSnapshot() {
    this.broadcast(buildSessionsSnapshotEvent(this.getRuntimeSessions()));
  }

  private broadcastMcpSnapshot() {
    this.broadcast(buildMcpSnapshotEvent(this.getRuntimeMcpServers()));
  }

  private broadcastProfilesSnapshot() {
    this.broadcast(buildProfilesSnapshotEvent(this.getRuntimeProfiles()));
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
    const capabilities = this.getRuntimeCapabilities();
    const sessions = this.getRuntimeSessions();
    const mcpServers = this.getRuntimeMcpServers();
    const profiles = this.getRuntimeProfiles();
    const signature = buildRuntimeBroadcastSignature({
      status: {
        state: status.state,
        apiServerUrl: status.apiServerUrl,
        resolvedModel: status.resolvedModel,
        detail: status.detail,
      },
      capabilities,
      sessions,
      mcpServers,
      profiles,
    });
    if (signature === this.lastBroadcastState) return;
    this.lastBroadcastState = signature;

    this.broadcastCapabilities(capabilities);
    this.broadcast(buildSessionsSnapshotEvent(sessions));
    this.broadcast(buildMcpSnapshotEvent(mcpServers));
    this.broadcast(buildProfilesSnapshotEvent(profiles));
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
