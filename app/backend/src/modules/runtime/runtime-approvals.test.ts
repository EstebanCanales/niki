import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHermesApprovalEvent } from "./runtime-events";

test("approval request events are surfaced to the app stream", () => {
  const event = normalizeHermesApprovalEvent("approval.request", {
    run_id: "run_123",
    approval_id: "appr_1",
    command: "rm -rf /tmp/demo",
    description: "Dangerous command",
    choices: ["once", "session", "always", "deny"],
  });

  assert.equal(event?.kind, "approval_request");
  assert.equal(event?.payload.id, "appr_1");
  assert.equal(event?.payload.runId, "run_123");
  assert.equal(event?.payload.toolName, "command");
});

test("approval responded events are normalized into resolution envelopes", () => {
  const event = normalizeHermesApprovalEvent("approval.responded", {
    run_id: "run_123",
    approval_id: "appr_1",
    choice: "once",
    resolved: 1,
  });

  assert.equal(event?.kind, "approval_resolved");
  assert.equal(event?.payload.id, "appr_1");
  assert.equal(event?.payload.decision, "once");
});
