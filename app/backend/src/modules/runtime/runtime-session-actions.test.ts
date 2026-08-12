import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { requestHermesSessionHandoff, undoHermesSessionLastExchange } from "./runtime-session-actions";

test("requestHermesSessionHandoff marks a session as pending", () => {
  const dir = mkdtempSync(join(tmpdir(), "niki-hermes-handoff-"));
  const dbPath = join(dir, "state.db");

  try {
    execFileSync("sqlite3", [
      dbPath,
      [
        "CREATE TABLE sessions (",
        " id TEXT PRIMARY KEY,",
        " handoff_state TEXT,",
        " handoff_platform TEXT,",
        " handoff_error TEXT",
        ");",
        "INSERT INTO sessions (id) VALUES ('session-1');",
      ].join(" "),
    ]);

    const first = requestHermesSessionHandoff(
      { sessionId: "session-1", platform: "telegram" },
      { dbPath },
    );
    assert.equal(first.ok, true);
    assert.equal(first.state, "pending");
    assert.equal(first.platform, "telegram");

    const second = requestHermesSessionHandoff(
      { sessionId: "session-1", platform: "discord" },
      { dbPath },
    );
    assert.equal(second.ok, false);
    assert.equal(second.state, "pending");
    assert.equal(second.platform, "telegram");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requestHermesSessionHandoff rejects invalid platforms", () => {
  assert.throws(
    () => requestHermesSessionHandoff({ sessionId: "session-1", platform: "bad target" }),
    /valid Hermes handoff platform/i,
  );
});

test("undoHermesSessionLastExchange rewrites the transcript through Hermes SessionDB", () => {
  const dir = mkdtempSync(join(tmpdir(), "niki-hermes-undo-"));
  const hermesRoot = join(process.env.HOME ?? "", ".hermes/hermes-agent");
  const dbPath = join(dir, "state.db");
  const sessionsDir = join(dir, "sessions");
  const sessionId = "session-undo-1";

  try {
    execFileSync("mkdir", ["-p", sessionsDir]);
    execFileSync("python3", [
      "-c",
      [
        "import sys",
        "from pathlib import Path",
        "sys.path.insert(0, sys.argv[1])",
        "from hermes_state import SessionDB",
        "db = SessionDB(Path(sys.argv[2]))",
        "db.create_session(session_id=sys.argv[3], source='api_server')",
      ].join("\n"),
      hermesRoot,
      dbPath,
      sessionId,
    ]);
    execFileSync("python3", [
      "-c",
      [
        "from pathlib import Path",
        "import json, sys",
        "path = Path(sys.argv[1]) / f\"{sys.argv[2]}.jsonl\"",
        "messages = [",
        "  {'role': 'system', 'content': 'sys'},",
        "  {'role': 'user', 'content': 'first'},",
        "  {'role': 'assistant', 'content': 'reply'},",
        "  {'role': 'user', 'content': 'remove me'},",
        "  {'role': 'assistant', 'content': 'last reply'},",
        "]",
        "path.write_text(''.join(json.dumps(m) + '\\n' for m in messages), encoding='utf-8')",
      ].join("\n"),
      sessionsDir,
      sessionId,
    ]);

    const result = undoHermesSessionLastExchange(
      { sessionId },
      {
        dbPath,
        sessionsDir,
        processesPath: join(dir, "processes.json"),
        sessionsIndexPath: join(sessionsDir, "sessions.json"),
        hermesRoot,
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.removed, 2);
    assert.equal(result.preview, "remove me");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
