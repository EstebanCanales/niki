# Niki Hermes Operator Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Niki into an adaptive Hermes-first operator console with a shared capability layer plus five Hermes-aligned feature families: `computer_use`, approvals, remote sessions, MCP admin, LSP diagnostics, and search/media tools.

**Architecture:** Add a shared adaptation foundation first: backend capability projection, normalized runtime events, remote session/profile contracts, and frontend feature-module gating. Then deliver each feature vertically behind capability truth plus rollout flags, so the app can expose only what Hermes actually supports while keeping product control over visibility.

**Tech Stack:** NestJS 11 backend in `app/backend`, SwiftUI macOS shell in `app/Niki`, Hermes API server/gateway, SSE for runtime events, `node:test` for backend contract tests, Xcode/macOS validation for the desktop shell.

**Spec:** `docs/superpowers/specs/2026-06-11-niki-hermes-operator-console-design.md`

---

## File Map

### Backend

- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/modules/runtime/runtime.controller.ts`
- Modify: `app/backend/src/modules/runtime/runtime.module.ts`
- Modify: `app/backend/src/wrapper/wrapper.controller.ts`
- Modify: `app/backend/src/wrapper/wrapper.service.ts`
- Modify: `app/backend/src/wrapper/wrapper.types.ts`
- Modify: `app/backend/src/modules/computer/computer-control.service.ts`
- Modify: `app/backend/src/modules/runtime/conversation-context.service.ts`
- Create: `app/backend/src/modules/runtime/runtime-capabilities.ts`
- Create: `app/backend/src/modules/runtime/runtime-events.ts`
- Create: `app/backend/src/modules/runtime/runtime-capabilities.test.ts`
- Create: `app/backend/src/modules/runtime/runtime-events.test.ts`
- Create: `app/backend/src/modules/runtime/runtime-approvals.test.ts`
- Create: `app/backend/src/modules/runtime/runtime-sessions.test.ts`

### Desktop shell

- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiModels.swift`
- Modify: `app/Niki/Sources/Desktop/Models/DockItem.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiDockView.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiSidebarPanels.swift`
- Modify: `app/Niki/Sources/Desktop/ContentView.swift`
- Create: `app/Niki/Sources/Desktop/Core/NikiFeatureRegistry.swift`
- Create: `app/Niki/Sources/Desktop/Core/NikiOperatorContracts.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiComputerPanel.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiApprovalsPanel.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiSessionsPanel.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiMcpPanel.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiDiagnosticsPanel.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiDiscoverPanel.swift`

### Validation

- Backend tests: `node --import tsx --test ...`
- Backend type/build: `npm run typecheck`, `npm run build`
- Desktop validation: `xcodebuild` against `app/Niki/Niki.xcodeproj` when environment permits

---

## Task 0: Shared Adaptation Foundation

**Files:**
- Create: `app/backend/src/modules/runtime/runtime-capabilities.ts`
- Create: `app/backend/src/modules/runtime/runtime-events.ts`
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/wrapper/wrapper.controller.ts`
- Modify: `app/backend/src/wrapper/wrapper.types.ts`
- Create: `app/backend/src/modules/runtime/runtime-capabilities.test.ts`
- Create: `app/backend/src/modules/runtime/runtime-events.test.ts`
- Create: `app/Niki/Sources/Desktop/Core/NikiFeatureRegistry.swift`
- Create: `app/Niki/Sources/Desktop/Core/NikiOperatorContracts.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiModels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`

- [ ] **Step 1: Write the failing backend capability tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { projectRuntimeCapabilities } from "./runtime-capabilities";

test("projectRuntimeCapabilities hides unsupported modules", () => {
  const projected = projectRuntimeCapabilities({
    hermes: {
      computerUse: false,
      approvals: true,
      mcpCatalog: false,
    },
    flags: {
      computer: true,
      approvals: true,
      mcp: true,
    },
  });

  assert.equal(projected.modules.computer.state, "hidden");
  assert.equal(projected.modules.approvals.state, "ready");
  assert.equal(projected.modules.mcp.state, "hidden");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/modules/runtime/runtime-capabilities.test.ts`
Expected: FAIL because `projectRuntimeCapabilities` does not exist yet.

- [ ] **Step 3: Add capability projection and event contracts**

```ts
export type RuntimeModuleState = "hidden" | "disabled" | "flagged" | "beta" | "ready";

export type RuntimeCapabilities = {
  modules: Record<string, { state: RuntimeModuleState; reason?: string }>;
  capabilities: Record<string, { available: boolean; enabled: boolean; requiresSetup: boolean }>;
};
```

```ts
export type RuntimeEventEnvelope =
  | { kind: "capabilities"; payload: RuntimeCapabilities }
  | { kind: "approval_request"; payload: RuntimeApprovalRequest }
  | { kind: "approval_resolved"; payload: RuntimeApprovalResolution }
  | { kind: "diagnostics"; payload: RuntimeDiagnosticsPayload }
  | { kind: "session_update"; payload: RuntimeSessionUpdate };
```

- [ ] **Step 4: Project capabilities from backend runtime state**

Implementation notes:
- Keep raw Hermes interpretation inside `runtime.service.ts`.
- Export only normalized app-facing capability names.
- Add `/runtime/capabilities` to wrapper routes.
- Include capability snapshots in the SSE bootstrap payload.

- [ ] **Step 5: Add the frontend feature registry**

```swift
enum NikiModuleID: String, CaseIterable {
    case chat
    case computer
    case approvals
    case sessions
    case mcp
    case discover
    case settings
}

struct NikiModuleAvailability: Codable {
    let state: String
    let reason: String?
}
```

- [ ] **Step 6: Run backend tests and compile checks**

Run: `node --import tsx --test src/modules/runtime/runtime-capabilities.test.ts src/modules/runtime/runtime-events.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/src/modules/runtime app/backend/src/wrapper app/Niki/Sources/Desktop/Core
git commit -m "feat: add hermes capability adaptation foundation"
```

---

## Task 1: Computer Use + Approvals

**Files:**
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/modules/computer/computer-control.service.ts`
- Modify: `app/backend/src/wrapper/wrapper.controller.ts`
- Modify: `app/backend/src/wrapper/wrapper.service.ts`
- Create: `app/backend/src/modules/runtime/runtime-approvals.test.ts`
- Create: `app/Niki/Sources/Desktop/Components/NikiComputerPanel.swift`
- Create: `app/Niki/Sources/Desktop/Components/NikiApprovalsPanel.swift`
- Modify: `app/Niki/Sources/Desktop/Models/DockItem.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiDockView.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiSidebarPanels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`

- [ ] **Step 1: Write failing approval-event normalization tests**

```ts
test("approval request events are surfaced to the app stream", async () => {
  const events = normalizeHermesRunEvents([
    { type: "approval_requested", id: "appr_1", tool_name: "execute_command" },
  ]);

  assert.equal(events[0]?.kind, "approval_request");
  assert.equal(events[0]?.payload.id, "appr_1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/modules/runtime/runtime-approvals.test.ts`
Expected: FAIL because approval mapping does not exist yet.

- [ ] **Step 3: Normalize Hermes approval events and add action endpoints**

Implementation notes:
- Add backend endpoints for `approve`, `reject`, and `expire` handling if Hermes requires response posting.
- Preserve raw Hermes ids in the app contract.
- Add current approval queue to `/runtime/status` and SSE snapshots.

```ts
type RuntimeApprovalRequest = {
  id: string;
  runId: string;
  title: string;
  toolName: string;
  detail: string;
  expiresAt?: string;
};
```

- [ ] **Step 4: Add Computer module state projection**

Implementation notes:
- Project availability from Hermes capability truth plus current computer-control config.
- Include permission/setup reasons such as accessibility or focus constraints.
- Keep `computer/capabilities` and `computer/config` aligned to the new module contract.

- [ ] **Step 5: Add first-level desktop modules**

```swift
case computer
case approvals
```

```swift
struct NikiComputerPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    var body: some View {
        Text("Computer")
    }
}
```

```swift
struct NikiApprovalsPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    var body: some View {
        Text("Approvals")
    }
}
```

- [ ] **Step 6: Add app-model approval and computer state**

Implementation notes:
- `NikiAppModel` should hold `pendingApprovals`, `computerAvailability`, `recentComputerActions`.
- Runtime SSE updates should mutate those models from normalized envelopes.
- Chat messages should deep-link into `Computer` and `Approvals` rather than embed bespoke logic.

- [ ] **Step 7: Run backend and desktop validation**

Run: `node --import tsx --test src/modules/runtime/runtime-approvals.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/backend/src/modules/runtime app/backend/src/modules/computer app/backend/src/wrapper app/Niki/Sources/Desktop
git commit -m "feat: add computer use and approvals modules"
```

---

## Task 2: Remote Sessions + Undo + Multi-Profile

**Files:**
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/modules/runtime/conversation-context.service.ts`
- Create: `app/backend/src/modules/runtime/runtime-sessions.test.ts`
- Create: `app/Niki/Sources/Desktop/Components/NikiSessionsPanel.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiModels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiSidebarPanels.swift`

- [ ] **Step 1: Write failing session-contract tests**

```ts
test("remote sessions expose profile identity and undo eligibility", () => {
  const projected = projectRuntimeSessions([
    { id: "sess_1", profile: "research", canUndo: true, resumable: true },
  ]);

  assert.equal(projected[0]?.profileId, "research");
  assert.equal(projected[0]?.canUndo, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/modules/runtime/runtime-sessions.test.ts`
Expected: FAIL because the session projection does not exist yet.

- [ ] **Step 3: Add session/profile backend contracts**

```ts
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
};

export function projectRuntimeSessions(rawSessions: HermesSessionSummary[]): RuntimeSessionSummary[] {
  return rawSessions.map((session) => ({
    id: session.id,
    title: session.title ?? "Untitled session",
    profileId: session.profile ?? "default",
    model: session.model,
    provider: session.provider,
    resumable: session.resumable !== false,
    canUndo: Boolean(session.capabilities?.undo),
    canUndoReason: session.capabilities?.undo ? undefined : "Undo is unavailable for this profile.",
    canHandoff: Boolean(session.capabilities?.handoff),
  }));
}
```

- [ ] **Step 4: Add sessions panel and model bindings**

```swift
struct NikiRemoteSession: Identifiable, Codable {
    let id: String
    let title: String
    let profileId: String
    let canUndo: Bool
    let canHandoff: Bool
}
```

- [ ] **Step 5: Add UI actions for resume, undo, and profile switching**

```swift
@MainActor
func resumeSession(_ sessionID: String) async throws {
    activeSessionID = sessionID
    try await refreshSessionTranscript(sessionID: sessionID)
}

@MainActor
func undoLastAction(in sessionID: String) async throws {
    try await apiClient.undoSessionAction(sessionID: sessionID)
    try await refreshRuntimeState()
}

@MainActor
func switchRemoteProfile(to profileID: String) async throws {
    try await apiClient.updateActiveProfile(profileID: profileID)
    try await refreshRuntimeState()
}
```

- [ ] **Step 6: Run validation**

Run: `node --import tsx --test src/modules/runtime/runtime-sessions.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/src/modules/runtime app/Niki/Sources/Desktop
git commit -m "feat: add remote sessions and profile-aware session controls"
```

---

## Task 3: MCP Catalog / Admin Surface

**Files:**
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/wrapper/wrapper.controller.ts`
- Modify: `app/backend/src/wrapper/wrapper.service.ts`
- Create: `app/Niki/Sources/Desktop/Components/NikiMcpPanel.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiModels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`

- [ ] **Step 1: Write a failing MCP capability test**

```ts
test("mcp module is flagged when Hermes supports catalog but Niki rollout is disabled", () => {
  const projected = projectRuntimeCapabilities({
    hermes: { mcpCatalog: true },
    flags: { mcp: false },
  });

  assert.equal(projected.modules.mcp.state, "flagged");
});
```

- [ ] **Step 2: Run test to verify it fails if needed**

Run: `node --import tsx --test src/modules/runtime/runtime-capabilities.test.ts`
Expected: FAIL or require extension of the foundation projection.

- [ ] **Step 3: Add backend MCP inventory projection**

```ts
export type RuntimeMcpServer = {
  id: string;
  name: string;
  status: "ready" | "disabled" | "degraded";
  enabled: boolean;
  reason?: string;
};

export function projectMcpServers(rawServers: HermesMcpServer[]): RuntimeMcpServer[] {
  return rawServers.map((server) => ({
    id: server.id,
    name: server.name,
    status: server.healthy ? "ready" : server.enabled ? "degraded" : "disabled",
    enabled: Boolean(server.enabled),
    reason: server.healthy ? undefined : server.reason ?? "Server is unavailable.",
  }));
}
```

- [ ] **Step 4: Add MCP admin panel**

```swift
struct NikiMcpServer: Identifiable, Codable {
    let id: String
    let name: String
    let status: String
    let reason: String?
}
```

- [ ] **Step 5: Add module gating and diagnostics**

```swift
var body: some View {
    if appModel.moduleAvailability(for: .mcp).state == "hidden" {
        EmptyView()
    } else if appModel.moduleAvailability(for: .mcp).state == "disabled" {
        ContentUnavailableView("MCP setup required", systemImage: "shippingbox")
    } else {
        List(appModel.mcpServers) { server in
            Label(server.name, systemImage: server.status == "ready" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
        }
    }
}
```

- [ ] **Step 6: Run validation**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/src/modules/runtime app/backend/src/wrapper app/Niki/Sources/Desktop
git commit -m "feat: add mcp catalog operator surface"
```

---

## Task 4: Post-Write LSP Diagnostics

**Files:**
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Create: `app/Niki/Sources/Desktop/Components/NikiDiagnosticsPanel.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiModels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiChatSidebar.swift`

- [ ] **Step 1: Write failing diagnostics-event tests**

```ts
test("post-write diagnostics are normalized into diagnostics envelopes", () => {
  const events = normalizeHermesRunEvents([
    { type: "lsp_diagnostics", file: "src/main.ts", severity: "error", message: "cannot find name X" },
  ]);

  assert.equal(events[0]?.kind, "diagnostics");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/modules/runtime/runtime-events.test.ts`
Expected: FAIL because diagnostics mapping is missing.

- [ ] **Step 3: Add diagnostics normalization**

```ts
export type RuntimeDiagnosticsPayload = {
  id: string;
  runId: string;
  sessionId?: string;
  filePath: string;
  severity: "error" | "warning" | "info";
  message: string;
};

function normalizeDiagnosticsEvent(event: HermesRunEvent): RuntimeEventEnvelope | null {
  if (event.type !== "lsp_diagnostics") {
    return null;
  }

  return {
    kind: "diagnostics",
    payload: {
      id: `${event.run_id}:${event.file}:${event.message}`,
      runId: event.run_id,
      sessionId: event.session_id,
      filePath: event.file,
      severity: event.severity,
      message: event.message,
    },
  };
}
```

- [ ] **Step 4: Add diagnostics UI surface**

```swift
struct NikiRuntimeDiagnostic: Identifiable, Codable {
    let id: String
    let filePath: String
    let severity: String
    let message: String
}
```

- [ ] **Step 5: Add inline and panel visibility**

```swift
if let diagnostic = appModel.latestDiagnostic {
    Label(diagnostic.message, systemImage: diagnostic.severity == "error" ? "xmark.octagon.fill" : "exclamationmark.circle.fill")
        .font(.caption)
        .foregroundStyle(diagnostic.severity == "error" ? .red : .yellow)
}
```

- [ ] **Step 6: Run validation**

Run: `node --import tsx --test src/modules/runtime/runtime-events.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/src/modules/runtime app/Niki/Sources/Desktop
git commit -m "feat: surface hermes post-write diagnostics"
```

---

## Task 5: Search / Media / Remote Tool Surfaces

**Files:**
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/wrapper/wrapper.types.ts`
- Create: `app/Niki/Sources/Desktop/Components/NikiDiscoverPanel.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiModels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAPIClient.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiSidebarPanels.swift`

- [ ] **Step 1: Write failing capability tests for discover/media tools**

```ts
test("discover module can be ready even when only x_search is enabled", () => {
  const projected = projectRuntimeCapabilities({
    hermes: { xSearch: true, videoGenerate: false },
    flags: { discover: true },
  });

  assert.equal(projected.modules.discover.state, "ready");
  assert.equal(projected.capabilities.video_generate.available, false);
});
```

- [ ] **Step 2: Run test to verify it fails if the projection is missing**

Run: `node --import tsx --test src/modules/runtime/runtime-capabilities.test.ts`
Expected: FAIL or require expansion.

- [ ] **Step 3: Add capability-aware search/media projection**

```ts
export type RuntimeDiscoverCapability = {
  id: "x_search" | "video_generate";
  title: string;
  available: boolean;
  reason?: string;
};

export function projectDiscoverCapabilities(input: {
  xSearch: boolean;
  videoGenerate: boolean;
  profileLabel?: string;
}): RuntimeDiscoverCapability[] {
  return [
    {
      id: "x_search",
      title: "X Search",
      available: input.xSearch,
      reason: input.xSearch ? undefined : `Unavailable for profile ${input.profileLabel ?? "default"}.`,
    },
    {
      id: "video_generate",
      title: "Video Generate",
      available: input.videoGenerate,
      reason: input.videoGenerate ? undefined : `Unavailable for profile ${input.profileLabel ?? "default"}.`,
    },
  ];
}
```

- [ ] **Step 4: Add discover/media UI**

```swift
struct NikiDiscoverCapability: Codable {
    let id: String
    let title: String
    let available: Bool
    let reason: String?
}
```

- [ ] **Step 5: Add remote-profile-aware tool exposure**

```swift
@MainActor
func refreshDiscoverCapabilities() async throws {
    discoverCapabilities = try await apiClient.fetchDiscoverCapabilities(profileID: activeProfileID)
}
```

- [ ] **Step 6: Run validation**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/backend/src/modules/runtime app/backend/src/wrapper app/Niki/Sources/Desktop
git commit -m "feat: add discover and media capability surfaces"
```

---

## Task 6: Final Integration Sweep

**Files:**
- Modify: `app/Niki/Sources/Desktop/ContentView.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiDockView.swift`
- Modify: `app/Niki/Sources/Desktop/Components/NikiSidebarPanels.swift`
- Modify: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`

- [ ] **Step 1: Ensure module visibility is capability-driven everywhere**

Checklist:
- Dock only shows modules in `ready`, `beta`, or `flagged`.
- Hidden modules do not appear.
- Disabled modules show setup state, not broken interactivity.

- [ ] **Step 2: Run backend tests**

Run:
```bash
node --import tsx --test \
  src/modules/runtime/hermes-config.test.ts \
  src/modules/runtime/hermes-probe-cache.test.ts \
  src/modules/runtime/runtime-capabilities.test.ts \
  src/modules/runtime/runtime-events.test.ts \
  src/modules/runtime/runtime-approvals.test.ts \
  src/modules/runtime/runtime-sessions.test.ts
```

Expected: PASS

- [ ] **Step 3: Run backend compile gates**

Run:
```bash
npm run typecheck
npm run build
```

Expected: PASS

- [ ] **Step 4: Run desktop validation when environment permits**

Run:
```bash
xcodebuild -project app/Niki/Niki.xcodeproj -scheme Niki -configuration Debug -derivedDataPath /tmp/niki-derived-data CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS, or explicit environment-only blocker if sandboxed package/cache restrictions prevent build resolution.

- [ ] **Step 5: Diff hygiene**

Run:
```bash
git diff --check -- app/backend app/Niki
```

Expected: PASS

- [ ] **Step 6: Final commit**

```bash
git add app/backend app/Niki
git commit -m "feat: deliver hermes operator console foundation"
```

---

## Coverage Check

Spec coverage against `docs/superpowers/specs/2026-06-11-niki-hermes-operator-console-design.md`:

- Adaptive capability layer: covered by Task 0
- Operator console module map: covered by Tasks 1-5 plus Task 6 sweep
- `computer_use`: covered by Task 1
- approval events: covered by Task 1
- remote sessions and `/undo`: covered by Task 2
- MCP admin: covered by Task 3
- LSP diagnostics: covered by Task 4
- `x_search`, `video_generate`, remote-profile-aware exposure: covered by Task 5
- rollout flag separation from capability truth: covered by Task 0 and Task 6

No intentional gaps remain in the plan.

## Notes

- This plan assumes the public desktop-facing surface remains backend-first and does not bypass Hermes from Swift.
- If Hermes raw event shapes differ from the assumptions above, adapt the backend normalization layer rather than the desktop shell contracts.
- The plan intentionally prioritizes visibility control and safe degradation over optimistic UI exposure.
