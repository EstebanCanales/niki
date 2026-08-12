import assert from "node:assert/strict";
import test from "node:test";

import { applyApprovalResolution } from "./runtime-approval-state";

test("applyApprovalResolution removes the first pending approval for a run by default", () => {
  const state = applyApprovalResolution(
    [
      { id: "appr_1", runId: "run_1", title: "A", toolName: "approval", detail: "A", choices: ["once"] },
      { id: "appr_2", runId: "run_1", title: "B", toolName: "approval", detail: "B", choices: ["once"] },
      { id: "appr_3", runId: "run_2", title: "C", toolName: "approval", detail: "C", choices: ["once"] },
    ],
    { runId: "run_1", choice: "once", all: false },
  );

  assert.deepEqual(
    state.pending.map((approval) => approval.id),
    ["appr_2", "appr_3"],
  );
  assert.deepEqual(state.resolved, [
    {
      id: "appr_1",
      runId: "run_1",
      decision: "once",
      resolved: 1,
    },
  ]);
});

test("applyApprovalResolution removes every pending approval for a run when all=true", () => {
  const state = applyApprovalResolution(
    [
      { id: "appr_1", runId: "run_1", title: "A", toolName: "approval", detail: "A", choices: ["session"] },
      { id: "appr_2", runId: "run_1", title: "B", toolName: "approval", detail: "B", choices: ["session"] },
      { id: "appr_3", runId: "run_2", title: "C", toolName: "approval", detail: "C", choices: ["session"] },
    ],
    { runId: "run_1", choice: "session", all: true },
  );

  assert.deepEqual(
    state.pending.map((approval) => approval.id),
    ["appr_3"],
  );
  assert.deepEqual(
    state.resolved.map((approval) => approval.id),
    ["appr_1", "appr_2"],
  );
  assert.deepEqual(
    state.resolved.map((approval) => approval.resolved),
    [1, 2],
  );
});
