import { resolve } from "path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export type RuntimeSessionHandoffResult = {
  ok: boolean;
  sessionId: string;
  state?: string;
  platform?: string;
  error?: string;
};

export type RuntimeSessionUndoResult = {
  ok: boolean;
  sessionId: string;
  removed: number;
  preview?: string;
  error?: string;
};

type HandoffStateRow = {
  state?: string | null;
  platform?: string | null;
  error?: string | null;
};

type HermesSessionIndexEntry = Record<string, unknown>;
type HermesSessionIndex = Record<string, HermesSessionIndexEntry>;
type HermesProcessEntry = {
  session_key?: unknown;
  exited?: unknown;
};

/**
 * Estado del agente de Niki. Apunta al runtime interno (`app/backend/agent-home`), no al
 * Hermes personal de `~/.hermes`: la última fuga que quedaba hacia afuera. Se detectó
 * buscando referencias a ".hermes" en el código después de dar el corte por terminado.
 */
function nikiAgentHome(): string {
  return (
    process.env.NIKI_AGENT_HOME?.trim() ||
    resolve(__dirname, "..", "..", "..", "agent-home")
  );
}

export function requestHermesSessionHandoff(
  input: { sessionId?: string; platform?: string },
  options?: { dbPath?: string },
): RuntimeSessionHandoffResult {
  const sessionId = normalizeSessionId(input.sessionId);
  const platform = normalizePlatform(input.platform);
  const dbPath = options?.dbPath?.trim() || `${nikiAgentHome()}/state.db`;
  if (!existsSync(dbPath)) {
    return {
      ok: false,
      sessionId,
      platform,
      error: "Hermes state.db is not available.",
    };
  }

  const escapedSessionId = escapeSqlString(sessionId);
  const escapedPlatform = escapeSqlString(platform);
  const updated = readSqlJson<{ changes?: number }>(
    dbPath,
    [
      "BEGIN IMMEDIATE;",
      "UPDATE sessions",
      "SET handoff_state = 'pending',",
      `    handoff_platform = '${escapedPlatform}',`,
      "    handoff_error = NULL",
      `WHERE id = '${escapedSessionId}' AND (handoff_state IS NULL OR handoff_state IN ('completed', 'failed'));`,
      "SELECT changes() AS changes;",
      "COMMIT;",
    ].join(" "),
  );

  const state = readHandoffState(dbPath, sessionId);
  if (!state) {
    return {
      ok: false,
      sessionId,
      platform,
      error: "Hermes session was not found.",
    };
  }

  const changes = Number(updated[0]?.changes ?? 0);
  if (changes <= 0) {
    return {
      ok: false,
      sessionId,
      state: normalizeNullable(state.state) ?? undefined,
      platform: normalizeNullable(state.platform) ?? platform,
      error:
        normalizeNullable(state.error) ??
        (normalizeNullable(state.state)
          ? `Handoff is already ${state.state}.`
          : "Hermes rejected the handoff request."),
    };
  }

  return {
    ok: true,
    sessionId,
    state: normalizeNullable(state.state) ?? "pending",
    platform: normalizeNullable(state.platform) ?? platform,
  };
}

function readHandoffState(dbPath: string, sessionId: string) {
  const rows = readSqlJson<HandoffStateRow>(
    dbPath,
    [
      "SELECT handoff_state AS state,",
      "       handoff_platform AS platform,",
      "       handoff_error AS error",
      "FROM sessions",
      `WHERE id = '${escapeSqlString(sessionId)}'`,
      "LIMIT 1;",
    ].join(" "),
  );
  return rows[0] ?? null;
}

export function undoHermesSessionLastExchange(
  input: { sessionId?: string },
  options?: {
    dbPath?: string;
    sessionsDir?: string;
    processesPath?: string;
    sessionsIndexPath?: string;
    hermesRoot?: string;
  },
): RuntimeSessionUndoResult {
  const sessionId = normalizeSessionId(input.sessionId);
  const hermesHome = nikiAgentHome();
  const dbPath = options?.dbPath?.trim() || `${hermesHome}/state.db`;
  const sessionsDir = options?.sessionsDir?.trim() || `${hermesHome}/sessions`;
  const processesPath = options?.processesPath?.trim() || `${hermesHome}/processes.json`;
  const sessionsIndexPath = options?.sessionsIndexPath?.trim() || `${sessionsDir}/sessions.json`;
  const hermesRoot = options?.hermesRoot?.trim() || resolve(__dirname, "..", "..", "..", "..", "agent-runtime");

  if (!existsSync(dbPath)) {
    return { ok: false, sessionId, removed: 0, error: "Hermes state.db is not available." };
  }
  if (!existsSync(hermesRoot)) {
    return { ok: false, sessionId, removed: 0, error: "Hermes source is not available for undo support." };
  }

  const sessionKey = findSessionKeyBySessionId(sessionId, sessionsIndexPath);
  if (sessionKey && hasActiveProcessForSessionKey(sessionKey, processesPath)) {
    return {
      ok: false,
      sessionId,
      removed: 0,
      error: "Hermes session is busy. Interrupt the current turn before using undo.",
    };
  }

  const script = `
import json
import sys
from pathlib import Path

hermes_root, db_path, sessions_dir, session_id = sys.argv[1:5]
sys.path.insert(0, hermes_root)
from hermes_state import SessionDB

db = SessionDB(Path(db_path))
transcript_path = Path(sessions_dir) / f"{session_id}.jsonl"

messages = []
if transcript_path.exists():
    for line in transcript_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            messages.append(json.loads(line))
else:
    messages = db.get_messages_as_conversation(session_id)

last_user_idx = None
for i in range(len(messages) - 1, -1, -1):
    if messages[i].get("role") == "user":
        last_user_idx = i
        break

if last_user_idx is None:
    print(json.dumps({"ok": False, "removed": 0, "error": "Nothing to undo."}))
    raise SystemExit(0)

removed_msg = str(messages[last_user_idx].get("content", ""))
removed = len(messages) - last_user_idx
truncated = messages[:last_user_idx]
db.replace_messages(session_id, truncated)
transcript_path.write_text("".join(json.dumps(m, ensure_ascii=False) + "\\n" for m in truncated), encoding="utf-8")

preview = removed_msg[:40] + "..." if len(removed_msg) > 40 else removed_msg
print(json.dumps({"ok": True, "removed": removed, "preview": preview}))
`.trim();

  try {
    const raw = execFileSync("python3", ["-c", script, hermesRoot, dbPath, sessionsDir, sessionId], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
    if (!raw) {
      return { ok: false, sessionId, removed: 0, error: "Hermes undo returned an empty response." };
    }
    const parsed = JSON.parse(raw) as RuntimeSessionUndoResult;
    return {
      ok: Boolean(parsed.ok),
      sessionId,
      removed: Number(parsed.removed ?? 0),
      preview: typeof parsed.preview === "string" ? parsed.preview : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      sessionId,
      removed: 0,
      error: error instanceof Error && error.message ? error.message : "Hermes undo failed.",
    };
  }
}

function readSqlJson<T>(dbPath: string, sql: string) {
  try {
    const raw = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
    if (!raw) return [] as T[];
    return JSON.parse(raw) as T[];
  } catch {
    return [] as T[];
  }
}

function normalizeSessionId(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error("A valid Hermes sessionId is required.");
  }
  return normalized;
}

function normalizePlatform(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || !/^[a-z0-9_-]+$/.test(normalized)) {
    throw new Error("A valid Hermes handoff platform is required.");
  }
  return normalized;
}

function escapeSqlString(value: string) {
  return value.replace(/'/g, "''");
}

function normalizeNullable(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function findSessionKeyBySessionId(sessionId: string, sessionsIndexPath: string) {
  if (!existsSync(sessionsIndexPath)) return "";
  try {
    const parsed = JSON.parse(readFileSync(sessionsIndexPath, "utf8")) as HermesSessionIndex;
    return (
      Object.entries(parsed).find(([, entry]) => String(entry.session_id ?? "").trim() === sessionId)?.[0] ?? ""
    );
  } catch {
    return "";
  }
}

function hasActiveProcessForSessionKey(sessionKey: string, processesPath: string) {
  if (!sessionKey || !existsSync(processesPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(processesPath, "utf8")) as HermesProcessEntry[];
    return parsed.some(
      (entry) => String(entry.session_key ?? "").trim() === sessionKey && entry.exited !== true,
    );
  } catch {
    return false;
  }
}
