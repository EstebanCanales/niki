import assert from "node:assert/strict";
import test from "node:test";

import { projectRuntimeSessions } from "./runtime-sessions";

test("remote sessions merge Hermes index and db metadata with real profile identity", () => {
  const projected = projectRuntimeSessions(
    {
      "agent:main:whatsapp:dm:50686112403": {
        session_id: "20260513_211716_0e860ebf",
        updated_at: "2026-05-13T21:17:59.813540",
        display_name: "Be2o",
        platform: "whatsapp",
        suspended: false,
        resume_pending: false,
      },
    },
    [
      {
        id: "20260513_211716_0e860ebf",
        source: "whatsapp",
        model: "kimi-k2.5",
        billingProvider: "kimi-coding",
        billingBaseUrl: "https://api.kimi.com/coding",
        title: "Study Guide",
        messageCount: 7,
        apiCallCount: 3,
        startedAt: 1781402775.68,
        endedAt: null,
        handoffState: null,
        handoffPlatform: null,
        handoffError: null,
      },
      {
        id: "20260513_211716_0e860ebf-title",
        source: "api_server",
        model: "kimi-k2.5",
        billingProvider: "kimi-coding",
        billingBaseUrl: "https://api.kimi.com/coding",
        title: null,
        messageCount: 2,
        apiCallCount: 1,
        startedAt: 1781402775.0,
        endedAt: null,
        handoffState: null,
        handoffPlatform: null,
        handoffError: null,
      },
    ],
    { handoffSupported: true, undoSupported: true, availableHandoffTargets: ["telegram", "whatsapp"] },
  );

  assert.equal(projected[0]?.id, "20260513_211716_0e860ebf");
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.profileId, "main");
  assert.equal(projected[0]?.title, "Study Guide");
  assert.equal(projected[0]?.provider, "kimi-coding");
  assert.equal(projected[0]?.model, "kimi-k2.5");
  assert.equal(projected[0]?.canUndo, true);
  assert.equal(projected[0]?.canHandoff, true);
  assert.deepEqual(projected[0]?.handoffTargets, ["telegram"]);
  assert.equal(projected[0]?.source, "whatsapp");
  assert.equal(projected[0]?.messageCount, 7);
  assert.equal(projected[0]?.handoffState, undefined);
  assert.equal(projected[0]?.handoffPlatform, undefined);
});

test("remote sessions block handoff while one is already in flight", () => {
  const projected = projectRuntimeSessions(
    {
      "agent:main:discord:channel:123": {
        session_id: "session-discord-1",
        updated_at: "2026-06-13T20:50:00.000000",
        display_name: "Ops",
        platform: "discord",
        suspended: false,
        resume_pending: false,
      },
    },
    [
      {
        id: "session-discord-1",
        source: "discord",
        model: "kimi-k2.5",
        billingProvider: "kimi-coding",
        title: "Operator Console",
        messageCount: 10,
        apiCallCount: 5,
        startedAt: 1781402775.68,
        endedAt: null,
        handoffState: "running",
        handoffPlatform: "whatsapp",
        handoffError: null,
      },
    ],
    { handoffSupported: true, undoSupported: false, availableHandoffTargets: ["discord", "whatsapp"] },
  );

  assert.equal(projected[0]?.canHandoff, false);
  assert.equal(projected[0]?.canHandoffReason, "A handoff is already in progress for this session.");
  assert.deepEqual(projected[0]?.handoffTargets, ["whatsapp"]);
});
