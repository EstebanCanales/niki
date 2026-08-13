import { resolve } from "path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Estado del agente de Niki: `app/backend/agent-home`, no el `~/.hermes` personal.
 */
function nikiAgentHome(): string {
  return (
    process.env.NIKI_AGENT_HOME?.trim() ||
    resolve(__dirname, "..", "..", "..", "agent-home")
  );
}

export type RuntimeSessionSummary = {
  id: string;
  title: string;
  profileId: string;
  model?: string;
  provider?: string;
  resumable: boolean;
  canUndo: boolean;
  canUndoReason?: string;
  canHandoff: boolean;
  updatedAt?: string;
  platform?: string;
  source?: string;
  messageCount?: number;
  apiCallCount?: number;
  suspended?: boolean;
  resumePending?: boolean;
  resumeReason?: string;
  handoffState?: string;
  handoffPlatform?: string;
  handoffError?: string;
  handoffTargets?: string[];
  canHandoffReason?: string;
  endedAt?: string;
};

type HermesSessionIndexEntry = Record<string, unknown>;
type HermesSessionIndex = Record<string, HermesSessionIndexEntry>;
type HermesChannelDirectory = {
  platforms?: Record<string, unknown[]>;
};

export type HermesSessionDbRow = {
  id: string;
  source?: string | null;
  model?: string | null;
  billingProvider?: string | null;
  billingBaseUrl?: string | null;
  title?: string | null;
  messageCount?: number | null;
  apiCallCount?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  handoffState?: string | null;
  handoffPlatform?: string | null;
  handoffError?: string | null;
};

export function readHermesSessionsIndex() {
  const filePath = `${nikiAgentHome()}/sessions/sessions.json`;
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as HermesSessionIndex;
  } catch {
    return {};
  }
}

export function readHermesChannelDirectoryPlatforms() {
  const filePath = `${nikiAgentHome()}/channel_directory.json`;
  if (!existsSync(filePath)) return [] as string[];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as HermesChannelDirectory;
    return Object.entries(parsed.platforms ?? {})
      .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
      .map(([platform]) => platform.trim().toLowerCase())
      .filter(Boolean)
      .sort();
  } catch {
    return [] as string[];
  }
}

export function readHermesSessionDbRows(): HermesSessionDbRow[] {
  const filePath = `${nikiAgentHome()}/state.db`;
  if (!existsSync(filePath)) return [];

  const query = [
    "select",
    " id,",
    " source,",
    " model,",
    " billing_provider as billingProvider,",
    " billing_base_url as billingBaseUrl,",
    " title,",
    " message_count as messageCount,",
    " api_call_count as apiCallCount,",
    " started_at as startedAt,",
    " ended_at as endedAt,",
    " handoff_state as handoffState,",
    " handoff_platform as handoffPlatform,",
    " handoff_error as handoffError",
    " from sessions",
    " order by started_at desc",
  ].join("");

  try {
    const raw = execFileSync("sqlite3", ["-json", filePath, query], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
    if (!raw) return [];
    return JSON.parse(raw) as HermesSessionDbRow[];
  } catch {
    return [];
  }
}

export function projectRuntimeSessions(
  index: HermesSessionIndex,
  dbRows: HermesSessionDbRow[],
  options: { handoffSupported: boolean; undoSupported: boolean; availableHandoffTargets?: string[] },
): RuntimeSessionSummary[] {
  const dbById = new Map(
    dbRows
      .filter((row) => typeof row.id === "string" && row.id.length > 0 && !row.id.endsWith("-title"))
      .map((row) => [row.id, row]),
  );

  const indexedSummaries = Object.entries(index).map(([sessionKey, entry]) =>
    projectIndexedSession(sessionKey, entry, dbById.get(readString(entry.session_id))),
  );
  const dbOnlySummaries = dbRows
    .filter((row) => row.id && !row.id.endsWith("-title") && !hasIndexSession(index, row.id))
    .map((row) => projectDbOnlySession(row));

  return [...indexedSummaries, ...dbOnlySummaries]
    .filter((entry): entry is RuntimeSessionSummary & { id: string } => Boolean(entry?.id))
    .map((entry) => {
      const handoffTargets = resolveHandoffTargets(entry, options.availableHandoffTargets ?? []);
      const canUndo = options.undoSupported && (entry.messageCount ?? 0) > 1 && entry.suspended !== true;
      const activeHandoff = isInFlightHandoff(entry.handoffState);
      const canHandoff =
        options.handoffSupported &&
        entry.suspended !== true &&
        !activeHandoff &&
        handoffTargets.length > 0;
      return {
        ...entry,
        canUndo,
        canUndoReason: canUndo
          ? undefined
          : options.undoSupported
            ? "Undo is only valid when the session has a reversible exchange and is not suspended."
            : "Undo is not exposed by the current Hermes API path yet.",
        canHandoff,
        canHandoffReason: canHandoff
          ? undefined
          : !options.handoffSupported
            ? "Session handoff is unavailable until Hermes gateway compatibility is ready."
            : entry.suspended === true
              ? "Suspended sessions cannot be handed off."
              : activeHandoff
                ? "A handoff is already in progress for this session."
                : "No eligible Hermes handoff targets are available right now.",
        handoffTargets,
      };
    })
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function projectIndexedSession(
  sessionKey: string,
  entry: HermesSessionIndexEntry,
  dbRow?: HermesSessionDbRow,
): RuntimeSessionSummary | null {
  const sessionId = readString(entry.session_id);
  if (!sessionId || sessionId.endsWith("-title")) return null;

  const displayName = readString(entry.display_name);
  const updatedAt = readString(entry.updated_at) || isoFromSeconds(dbRow?.startedAt ?? null) || undefined;
  const platform = readString(entry.platform) || normalizeNullable(dbRow?.source) || undefined;
  const suspended = readBoolean(entry.suspended);
  const resumePending = readBoolean(entry.resume_pending);
  const resumeReason = readNullableString(entry.resume_reason);
  const parsedProfileId = parseProfileId(sessionKey);

  return {
    id: sessionId,
    title: normalizeNullable(dbRow?.title) || displayName || sessionId || "Hermes session",
    profileId: parsedProfileId,
    model: normalizeNullable(dbRow?.model) || undefined,
    provider: normalizeNullable(dbRow?.billingProvider) || undefined,
    resumable: suspended !== true,
    updatedAt,
    platform,
    source: normalizeNullable(dbRow?.source) || platform,
    messageCount: toOptionalNumber(dbRow?.messageCount),
    apiCallCount: toOptionalNumber(dbRow?.apiCallCount),
    suspended,
    resumePending,
    resumeReason: resumeReason || undefined,
    handoffState: normalizeNullable(dbRow?.handoffState) || undefined,
    handoffPlatform: normalizeNullable(dbRow?.handoffPlatform) || undefined,
    handoffError: normalizeNullable(dbRow?.handoffError) || undefined,
    endedAt: isoFromSeconds(dbRow?.endedAt ?? null) || undefined,
    canUndo: false,
    canHandoff: false,
  };
}

function projectDbOnlySession(row: HermesSessionDbRow): RuntimeSessionSummary {
  return {
    id: row.id,
    title: normalizeNullable(row.title) || row.id,
    profileId: row.source === "cli" ? "main" : "default",
    model: normalizeNullable(row.model) || undefined,
    provider: normalizeNullable(row.billingProvider) || undefined,
    resumable: true,
    updatedAt: isoFromSeconds(row.startedAt ?? null) || undefined,
    platform: normalizeNullable(row.source) || undefined,
    source: normalizeNullable(row.source) || undefined,
    messageCount: toOptionalNumber(row.messageCount),
    apiCallCount: toOptionalNumber(row.apiCallCount),
    suspended: false,
    resumePending: false,
    resumeReason: undefined,
    handoffState: normalizeNullable(row.handoffState) || undefined,
    handoffPlatform: normalizeNullable(row.handoffPlatform) || undefined,
    handoffError: normalizeNullable(row.handoffError) || undefined,
    endedAt: isoFromSeconds(row.endedAt ?? null) || undefined,
    canUndo: false,
    canHandoff: false,
  };
}

function hasIndexSession(index: HermesSessionIndex, sessionId: string) {
  return Object.values(index).some((entry) => readString(entry.session_id) === sessionId);
}

function parseProfileId(sessionKey: string) {
  const parts = sessionKey.split(":").filter(Boolean);
  if (parts[0] === "agent" && parts[1]) return parts[1];
  return "default";
}

function resolveHandoffTargets(entry: RuntimeSessionSummary, availableTargets: string[]) {
  const currentSource = String(entry.source ?? entry.platform ?? "").trim().toLowerCase();
  const uniqueTargets = new Set<string>();
  for (const target of availableTargets) {
    const normalized = String(target).trim().toLowerCase();
    if (!normalized || normalized === currentSource) continue;
    uniqueTargets.add(normalized);
  }
  return [...uniqueTargets];
}

function isInFlightHandoff(value: string | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "pending" || normalized === "running";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown) {
  return value === true;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeNullable(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toOptionalNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isoFromSeconds(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}
