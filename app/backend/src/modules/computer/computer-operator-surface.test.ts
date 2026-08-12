import assert from "node:assert/strict";
import test from "node:test";

import { projectComputerOperatorSurface } from "./computer-operator-surface";

test("projectComputerOperatorSurface returns safe recommended actions from available capabilities", () => {
  const surface = projectComputerOperatorSurface({
    capabilities: [
      { name: "screen_capture", description: "capture", risk: "low" },
      { name: "screen_info", description: "screen info", risk: "low" },
      { name: "clipboard_read", description: "clipboard", risk: "low" },
      { name: "app_list", description: "apps", risk: "low" },
      { name: "system_info", description: "system", risk: "low" },
      { name: "shell_exec", description: "shell", risk: "high" },
    ],
    permissions: {
      inputHelper: { available: false },
    },
  });

  assert.deepEqual(
    surface.recommendedActions.map((action) => action.capability),
    ["screen_capture", "screen_info", "clipboard_read", "app_list", "system_info"],
  );
  assert.equal(surface.recommendedActions.every((action) => action.risk !== "high"), true);
  assert.match(surface.summary, /Read-only inspection actions are available/i);
});

test("projectComputerOperatorSurface disables helper-driven actions when local helper is unavailable", () => {
  const surface = projectComputerOperatorSurface({
    capabilities: [
      { name: "app_activate", description: "activate", risk: "medium" },
      { name: "screen_capture", description: "capture", risk: "low" },
    ],
    permissions: {
      inputHelper: { available: false },
    },
  });

  const activate = surface.recommendedActions.find((action) => action.capability === "app_activate");
  assert.equal(activate?.state, "disabled");
  assert.match(activate?.reason ?? "", /Input helper is not ready/i);
});

test("projectComputerOperatorSurface promotes helper-driven actions once helper is ready", () => {
  const surface = projectComputerOperatorSurface({
    capabilities: [
      { name: "app_activate", description: "activate", risk: "medium" },
      { name: "clipboard_write", description: "write clipboard", risk: "low" },
      { name: "notify", description: "notify", risk: "low" },
      { name: "open_url", description: "open url", risk: "medium" },
      { name: "screen_capture", description: "capture", risk: "low" },
    ],
    permissions: {
      inputHelper: { available: true, path: "/tmp/helper" },
    },
  });

  const activate = surface.recommendedActions.find((action) => action.capability === "app_activate");
  const clipboardWrite = surface.recommendedActions.find((action) => action.capability === "clipboard_write");
  const notify = surface.recommendedActions.find((action) => action.capability === "notify");
  const openUrl = surface.recommendedActions.find((action) => action.capability === "open_url");
  assert.equal(activate?.state, "ready");
  assert.deepEqual(activate?.inputs?.map((input) => input.key), ["name"]);
  assert.equal(clipboardWrite?.state, "ready");
  assert.deepEqual(clipboardWrite?.inputs?.map((input) => input.key), ["text"]);
  assert.equal(notify?.state, "ready");
  assert.deepEqual(notify?.inputs?.map((input) => input.key), ["message"]);
  assert.equal(openUrl?.state, "ready");
  assert.deepEqual(openUrl?.inputs?.map((input) => input.key), ["url"]);
  assert.match(surface.summary, /guided takeover controls can expand/i);
});
