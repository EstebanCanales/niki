import assert from "node:assert/strict";
import test from "node:test";

import { projectRuntimeCapabilities } from "./runtime-capabilities";

test("projectRuntimeCapabilities hides unsupported modules", () => {
  const projected = projectRuntimeCapabilities({
    hermes: {
      computerUse: false,
      approvals: true,
      mcpCatalog: false,
      xSearch: false,
      videoGenerate: false,
      remoteSessions: true,
      lspDiagnostics: true,
    },
    flags: {
      computer: true,
      approvals: true,
      mcp: true,
      discover: true,
      sessions: true,
      diagnostics: true,
    },
  });

  assert.equal(projected.modules.computer.state, "hidden");
  assert.equal(projected.modules.approvals.state, "ready");
  assert.equal(projected.modules.mcp.state, "hidden");
  assert.equal(projected.modules.sessions.state, "ready");
  assert.equal(projected.modules.discover.state, "hidden");
  assert.equal(projected.modules.diagnostics.state, "ready");
});

test("projectRuntimeCapabilities flags disabled rollout modules even when Hermes supports them", () => {
  const projected = projectRuntimeCapabilities({
    hermes: {
      computerUse: true,
      approvals: true,
      mcpCatalog: true,
      xSearch: true,
      videoGenerate: false,
      remoteSessions: true,
      lspDiagnostics: true,
    },
    flags: {
      computer: false,
      approvals: true,
      mcp: false,
      discover: true,
      sessions: true,
      diagnostics: true,
    },
  });

  assert.equal(projected.modules.computer.state, "flagged");
  assert.equal(projected.modules.mcp.state, "flagged");
  assert.equal(projected.modules.discover.state, "ready");
  assert.equal(projected.capabilities.video_generate.available, false);
  assert.equal(projected.capabilities.x_search.available, true);
});
