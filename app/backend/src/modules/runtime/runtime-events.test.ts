import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeBroadcastSignature,
  buildCapabilitiesEvent,
  buildInitialRuntimeEvents,
  buildMcpSnapshotEvent,
  buildProfilesSnapshotEvent,
  buildSessionActionEvent,
  buildSessionsSnapshotEvent,
  normalizeHermesDiagnosticsEvent,
} from "./runtime-events";
import { projectRuntimeCapabilities } from "./runtime-capabilities";
import type { RuntimeProfileSummary } from "./runtime-profiles";
import type { RuntimeSessionSummary } from "./runtime-sessions";
import type { RuntimeMcpServer } from "./runtime-mcp";

test("buildCapabilitiesEvent wraps projected capabilities in an app event envelope", () => {
  const capabilities = projectRuntimeCapabilities({
    hermes: {
      computerUse: true,
      approvals: false,
      mcpCatalog: false,
      xSearch: true,
      videoGenerate: false,
      remoteSessions: true,
      lspDiagnostics: false,
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

  const event = buildCapabilitiesEvent(capabilities);

  assert.equal(event.kind, "capabilities");
  assert.equal(event.payload.modules.computer.state, "ready");
  assert.equal(event.payload.modules.approvals.state, "hidden");
});

test("buildInitialRuntimeEvents appends capability snapshot after the runtime patch", () => {
  const capabilities = projectRuntimeCapabilities({
    hermes: {
      computerUse: true,
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

  const events = buildInitialRuntimeEvents({
    status: {
      state: "ready",
      apiServerUrl: "http://127.0.0.1:8642",
      resolvedModel: "kimi-k2.6",
      detail: "Hermes ready.",
    },
    capabilities,
    sessions: [
      {
        id: "session-1",
        title: "Ops",
        profileId: "main",
        resumable: true,
        canUndo: true,
        canHandoff: false,
      },
    ] satisfies RuntimeSessionSummary[],
    mcpServers: [
      {
        id: "server-1",
        name: "filesystem",
        status: "ready",
        enabled: true,
        supportsParallelToolCalls: false,
        resourcesEnabled: true,
        promptsEnabled: false,
        includeCount: 1,
        excludeCount: 0,
      },
    ] satisfies RuntimeMcpServer[],
    profiles: [
      {
        id: "main",
        label: "main",
        sessionCount: 1,
        lastSeenAt: "2026-06-13T20:00:00.000Z",
        providers: ["kimi-coding"],
        models: ["kimi-k2.6"],
      },
    ] satisfies RuntimeProfileSummary[],
  });

  assert.equal(events[0]?.kind, "partial");
  assert.equal(events[1]?.kind, "capabilities");
  assert.equal(events[1]?.payload.modules.approvals.state, "ready");
  assert.equal(events[2]?.kind, "sessions_snapshot");
  assert.equal(events[3]?.kind, "mcp_snapshot");
  assert.equal(events[4]?.kind, "profiles_snapshot");
});

test("buildSessionsSnapshotEvent wraps projected sessions in an app event envelope", () => {
  const event = buildSessionsSnapshotEvent([
    {
      id: "session-1",
      title: "Ops",
      profileId: "main",
      resumable: true,
      canUndo: true,
      canHandoff: true,
    },
  ]);

  assert.equal(event.kind, "sessions_snapshot");
  assert.equal(event.payload.sessions[0]?.profileId, "main");
});

test("buildMcpSnapshotEvent wraps projected MCP servers in an app event envelope", () => {
  const event = buildMcpSnapshotEvent([
    {
      id: "server-1",
      name: "filesystem",
      status: "ready",
      enabled: true,
      supportsParallelToolCalls: false,
      resourcesEnabled: true,
      promptsEnabled: false,
      includeCount: 1,
      excludeCount: 0,
    },
  ]);

  assert.equal(event.kind, "mcp_snapshot");
  assert.equal(event.payload.servers[0]?.name, "filesystem");
});

test("buildProfilesSnapshotEvent wraps projected profiles in an app event envelope", () => {
  const event = buildProfilesSnapshotEvent([
    {
      id: "main",
      label: "main",
      sessionCount: 2,
      lastSeenAt: "2026-06-13T22:00:00.000Z",
      providers: ["kimi-coding"],
      models: ["kimi-k2.5"],
    },
  ]);

  assert.equal(event.kind, "profiles_snapshot");
  assert.equal(event.payload.profiles[0]?.sessionCount, 2);
});

test("buildSessionActionEvent wraps session orchestration feedback in an app event envelope", () => {
  const event = buildSessionActionEvent({
    sessionId: "session-1",
    action: "handoff",
    status: "success",
    summary: "Handoff requested to ios.",
    detail: "Hermes marked the session as pending handoff.",
    platform: "ios",
  });

  assert.equal(event.kind, "session_action");
  assert.equal(event.payload.sessionId, "session-1");
  assert.equal(event.payload.action, "handoff");
  assert.equal(event.payload.status, "success");
});

test("post-write diagnostics are normalized into diagnostics envelopes", () => {
  const event = normalizeHermesDiagnosticsEvent("lsp_diagnostics", {
    run_id: "run-123",
    session_id: "session-1",
    file: "src/main.ts",
    severity: "error",
    message: "cannot find name X",
  });

  assert.equal(event?.kind, "diagnostics");
  assert.equal(event?.payload.runId, "run-123");
  assert.equal(event?.payload.filePath, "src/main.ts");
  assert.equal(event?.payload.severity, "error");
});

test("buildRuntimeBroadcastSignature changes when sessions change even if runtime status stays stable", () => {
  const capabilities = projectRuntimeCapabilities({
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
      computer: true,
      approvals: true,
      mcp: true,
      discover: true,
      sessions: true,
      diagnostics: true,
    },
  });

  const base = buildRuntimeBroadcastSignature({
    status: {
      state: "ready",
      apiServerUrl: "http://127.0.0.1:8642",
      resolvedModel: "kimi-k2.5",
      detail: "Hermes ready.",
    },
    capabilities,
    sessions: [
      {
        id: "session-1",
        title: "Ops",
        profileId: "main",
        resumable: true,
        canUndo: true,
        canHandoff: false,
      },
    ],
    mcpServers: [],
    profiles: [
      {
        id: "main",
        label: "main",
        sessionCount: 1,
        lastSeenAt: "2026-06-13T20:00:00.000Z",
        providers: ["kimi-coding"],
        models: ["kimi-k2.5"],
      },
    ],
  });

  const changed = buildRuntimeBroadcastSignature({
    status: {
      state: "ready",
      apiServerUrl: "http://127.0.0.1:8642",
      resolvedModel: "kimi-k2.5",
      detail: "Hermes ready.",
    },
    capabilities,
    sessions: [
      {
        id: "session-2",
        title: "New Session",
        profileId: "main",
        resumable: true,
        canUndo: true,
        canHandoff: false,
      },
    ],
    mcpServers: [],
    profiles: [
      {
        id: "main",
        label: "main",
        sessionCount: 1,
        lastSeenAt: "2026-06-13T20:00:00.000Z",
        providers: ["kimi-coding"],
        models: ["kimi-k2.5"],
      },
    ],
  });

  assert.notEqual(base, changed);
});
