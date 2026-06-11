# Niki Hermes Operator Console — Design Spec

> Drafted on 2026-06-11 from current repo state and verified Hermes release notes through v0.16.0-era local checkout and v0.14.0 public release notes.

## Objective

Turn Niki into a Hermes-first operator console that can absorb recent Hermes capabilities without hardcoding product behavior per feature. The app must stay adaptable: Hermes remains the authority for runtime capabilities, sessions, approvals, tools, and remote state; Niki renders modules based on capabilities and product flags instead of assuming a fixed product surface.

This design covers these Hermes-aligned feature families:

1. `computer_use` with `cua-driver` backend and non-Anthropic support
2. API-server approval events and end-user approve/reject flows
3. post-write LSP diagnostics surfaced back into Niki
4. MCP catalog and admin surface
5. `x_search`, `video_generate`, and remote profile-aware tools
6. `/undo`, multi-profile remote sessions, and desktop-style session management

## Current State

### Repo

- Backend lives in `app/backend` as the Hermes-facing bridge.
- Desktop shell lives in `app/Niki`.
- The current direction is already Hermes-first for runtime config and chat transport, but only partially.

### What is already true

- Backend chat stream proxies Hermes-only.
- Runtime config is sourced from `~/.hermes/config.yaml` plus env fallbacks.
- Backend now watches `~/.hermes/config.yaml` and refreshes runtime heartbeat when it changes.
- Legacy wrapper memory/work-items surfaces were removed from the public app path.
- The desktop shell has already been reduced away from legacy tasks as a primary surface.

### Remaining gap

Niki still behaves mostly like a chat shell with some runtime plumbing. Hermes now exposes capability families that need first-class operator surfaces, but the app does not yet have:

- capability-driven module loading
- a stable feature registry
- a unified approval protocol
- a session/profile contract aligned to remote Hermes state
- a module system that can hide, disable, or promote features as Hermes evolves

## Design Direction

### Product shape

Niki should evolve from a chat-first shell into a **control center / operator console** where chat remains important, but is only one module among several top-level operational surfaces.

### Adaptability principle

Every feature in the app must pass through two gates:

1. **Hermes capability truth**
   The backend determines what Hermes actually supports right now.
2. **Niki rollout flag**
   The product can still hide or constrain a supported capability until the Niki experience is ready.

This avoids both kinds of failure:

- Niki showing a feature Hermes cannot actually execute
- Hermes gaining a capability and Niki exposing it prematurely with weak UX

## Architecture

### Block 0: App Adaptation Layer

This is the shared base for every later subplan. It is the first implementation phase because all later feature work depends on it.

It provides five cross-cutting contracts.

#### 1. Capability Registry

Backend projects Hermes support into a stable app-facing contract:

- `computer_use`
- `approval_events`
- `lsp_post_write_diagnostics`
- `mcp_catalog`
- `x_search`
- `video_generate`
- `undo`
- `remote_profiles`
- `remote_sessions`

Each capability carries:

- `available`
- `enabled`
- `requires_setup`
- `visibility`
- `reason`
- optional metadata such as provider constraints or transport mode

#### 2. Feature Module Contract

Every Niki surface declares:

- module id
- required capabilities
- optional product flags
- primary route/panel target
- state model: `hidden`, `disabled`, `flagged`, `beta`, `ready`

This lets Niki render modules by availability instead of by hardcoded navigation assumptions.

#### 3. Unified Run and Event Protocol

Niki needs one normalized stream for:

- run lifecycle
- tool activity
- approval requests
- approval resolution
- diagnostics
- session mutations

The backend should normalize Hermes API-server events into one app-facing SSE/event schema instead of forcing each UI surface to parse raw Hermes event diversity.

#### 4. Session and Profile Contract

Niki local session affordances must map to Hermes remote session identity.

The contract needs:

- remote session id
- local display state
- active profile/model/provider identity
- resumability
- undo eligibility
- handoff/profile-switch eligibility

#### 5. Rollout Flags Layer

Separate from capability truth. This is Niki product control.

Examples:

- Hermes supports approval events, but Niki approval center is still `flagged`.
- Hermes supports `video_generate`, but Niki only exposes it inside chat, not in a dedicated module yet.

## UI Module Map

Niki should move toward this operator-console structure:

### 1. Chat

- still a core entry surface
- shows session thread, assistant output, inline tools, and contextual jumps
- can launch into `Computer`, `Approvals`, or `Sessions`

### 2. Computer

First-level surface, not just a contextual panel.

Contains:

- current control mode
- viewport/screenshot/live target state
- recent actions
- focus/permission state
- takeover/manual recovery affordances

### 3. Approvals

First-level operational inbox.

Contains:

- active approvals
- expired approvals
- recent decisions
- per-run context and tool payload preview

### 4. Sessions

First-level remote session manager.

Contains:

- active sessions
- recent sessions
- profile/model/provider identity
- resume
- `/undo`
- handoff/profile switch

### 5. MCP / Tools

Admin/catalog surface for:

- available MCP servers
- tools catalog
- enabled/disabled status
- health/setup state

### 6. Discover / Media

Surface for capability-driven discover/search/generation tools.

It can begin as chat/tool actions and later graduate into a full module. The design allows both without changing the shared architecture.

### 7. Settings / Runtime

Keeps:

- `~/.hermes/config.yaml` projection
- runtime connectivity
- capability diagnostics
- rollout flags
- remote profile configuration

## Feature Exposure Rules

Every module resolves through this matrix:

- Hermes unsupported: `hidden`
- Hermes supported but not configured: `disabled-with-setup`
- Hermes supported and Niki gated: `flagged`
- Hermes supported and partially ready: `beta`
- Hermes supported and fully integrated: `ready`

This keeps the app adaptable as Hermes adds or changes features over time.

## Recommended Delivery Strategy

### Recommended execution model

Use **vertical Hermes-first delivery** with a small shared foundation phase.

That means:

- first build the adaptation layer and shared contracts
- then deliver feature families end-to-end one by one
- keep each feature behind capabilities plus rollout flags

This is preferred over a pure foundation-first approach because it produces visible working value sooner without losing architecture quality.

## Master Plan Shape

The implementation should be organized as one master plan with five embedded subplans, executed in this order.

### Subplan 0: Shared Adaptation Foundation

Purpose:

- define capability registry
- define module contract
- define unified event schema
- define session/profile contract
- add rollout-flag layer

Outputs:

- backend capability projection
- frontend feature registry
- module state resolution logic
- shared event typing
- test harness for capability-based rendering

### Subplan 1: Computer Use + Approvals

Purpose:

- make `computer_use` a first-class Niki module
- surface API-server approval events without run stalls

Scope:

- backend normalization of approval events
- approval action endpoints or reply mechanism
- computer state contract
- first-level `Computer` module
- first-level `Approvals` module
- jump flows between chat/run/approval/computer

Acceptance:

- approval-required runs do not silently stall in Niki
- users can approve/reject from the app
- computer-use runs can be initiated and observed through a dedicated module

### Subplan 2: Remote Sessions + Undo + Multi-Profile

Purpose:

- align Niki session management to Hermes remote sessions
- support profile-aware resume/handoff/undo

Scope:

- session listing contract
- active session metadata
- remote profile identity
- `/undo` affordance
- profile switch / handoff affordance
- desktop-style sessions surface

Acceptance:

- Niki can browse and resume remote sessions with profile context
- `/undo` is shown only when supported and valid
- multi-profile switching does not fork local session truth away from Hermes

### Subplan 3: MCP Catalog / Admin Surface

Purpose:

- expose MCP state as an operator-facing module instead of hidden infrastructure

Scope:

- backend capability projection for MCP inventory and health
- tools/server listing
- setup/health/error states
- enablement visibility and diagnostics

Acceptance:

- users can see what MCP/tool integrations exist, what is healthy, and what is unavailable
- hidden integrations do not need code changes in Niki to stay hidden

### Subplan 4: LSP Diagnostics Post-Write

Purpose:

- surface Hermes semantic write diagnostics in the app shell

Scope:

- diagnostics event normalization
- run/thread attachment of diagnostics
- inline post-edit diagnostics panel or thread section
- severity mapping and actionability

Acceptance:

- edits performed through Hermes can show semantic diagnostics in Niki
- the app distinguishes successful write from successful code health

### Subplan 5: Search / Media / Remote Tool Surfaces

Purpose:

- expose `x_search`, `video_generate`, and remote profile-driven tools in a way that can start compact and expand later

Scope:

- capability-driven tool exposure
- chat actions first, optional dedicated discover/media module later
- provider/profile awareness
- generated artifact/result display

Acceptance:

- tools appear only when supported by Hermes and allowed by Niki flags
- results and artifacts display without forcing hardcoded vertical UI for every new tool family

## Testing Strategy

The master plan should require testing in every subplan, not only at the end.

### Backend

- capability projection tests
- unified event normalization tests
- approval event and decision flow tests
- session/profile contract tests
- cache and config invalidation tests

### Desktop app

- module visibility resolution tests
- capability/flag rendering tests
- session navigation tests
- approval UI state tests
- computer-use surface state tests

### Integration

- Hermes capability present vs absent scenarios
- approval-required run scenario
- remote session resume/undo scenario
- diagnostics after write scenario
- discover/media capability gating scenario

## Non-Goals

This design does not require:

- rebuilding Niki around mocked features
- exposing unsupported Hermes features optimistically
- preserving old local-only state paths just because the UI already had a shape for them

## Assumptions

- Hermes capability truth will continue evolving, so Niki must bind to normalized app contracts rather than raw feature-specific assumptions.
- The backend remains the only desktop-facing bridge to Hermes.
- Capability and rollout separation is mandatory for safe delivery.
- `computer_use` and approvals are first-priority because they change the app from chat shell to operator console.

## Risks

### Risk: overfitting to current Hermes event payloads

Mitigation:

- normalize events in backend
- version app-facing event schema separately from raw Hermes payloads

### Risk: UI explosion per feature

Mitigation:

- feature module contract
- module states
- capability-driven visibility

### Risk: session truth drifting between shell and Hermes

Mitigation:

- remote session ids are authoritative
- local state is projection only

### Risk: partial Hermes support creating broken UI

Mitigation:

- support `disabled-with-setup`, `flagged`, and `beta`, not only visible/hidden

## Recommendation

Proceed with:

1. a short shared adaptation foundation
2. vertical feature rollout in the fixed order:
   - `computer_use + approvals`
   - `remote sessions + /undo + multi-profile`
   - `MCP catalog/admin`
   - `LSP diagnostics`
   - `x_search + video_generate + remote profiles`

This produces a Niki app that is not merely “compatible with Hermes”, but structurally designed to keep absorbing Hermes feature growth without re-architecting the shell each time.
