# Niki — Agent Guidelines

> Niki is a premium desktop shell for Hermes. It is a personal AI agent control center with a tool-first UI, backend-mediated realtime runtime events, automation capabilities, and a voice pipeline. The project is built desktop-first with Tauri + Next.js on the frontend and NestJS on the backend.

---

## Project Overview

This repository contains three main runtime areas:

- **`frontend/`** — The Niki desktop shell. A Next.js 15 (App Router) React application wrapped in a Tauri 2 native desktop window. It communicates with the backend via HTTP and SSE and can run against a mock runtime for local UI work.
- **`backend/`** — A NestJS 11 service that acts as the BFF and runtime broker: it proxies chat streams to Hermes, manages in-memory state for sessions/intents/automations, handles auth, and exposes a wrapper API for the frontend.
- **`frontend/src-tauri/`** — Minimal Rust code that bundles the Next.js static export into a macOS desktop app.

There is also a legacy **`frontend-bak/`** directory containing an abandoned SwiftUI macOS app (pre-Tauri), which should not be modified.

---

## Technology Stack

### Frontend
- **Framework:** Next.js 15.3.1 (App Router), React 19, TypeScript 5.8 (strict, `noEmit`)
- **Desktop Shell:** Tauri 2.10.3 (Rust, edition 2021)
- **Styling:** Tailwind CSS 3.4.17, `tailwindcss-animate`, `@tailwindcss/typography`
- **UI Components:** shadcn/ui (default style, baseColor `zinc`, RSC enabled, CSS variables)
- **State:** Zustand 5 with `persist` middleware (localStorage key: `niki-preferences`)
- **Server State:** TanStack Query (React Query) 5.66.8
- **Animation:** Framer Motion 12.4.7
- **Icons:** Lucide React 0.511.0
- **Markdown:** `react-markdown` 10.1.0 + `remark-gfm` 4.0.1
- **Toasts:** Sonner 2.0.1
- **AI SDK:** `groq-sdk` 1.1.2
- **Resizable Panels:** `react-resizable-panels` 2.1.7
- **Date:** `date-fns` 4.1.0
- **Calendar:** `react-day-picker` 9.14.0
- **Floating UI:** `@floating-ui/react` 0.27.19
- **Tauri API:** `@tauri-apps/api` 2.3.0

### Backend
- **Framework:** NestJS 11.1.19, Express.js platform
- **Runtime:** Node.js with `tsx` 4.21.0 (TypeScript executed directly; no separate compile step needed in dev/prod)
- **TypeScript:** 6.0.3, strict, CommonJS, decorators, `emitDecoratorMetadata`
- **Target:** ES2022
- **HTTP Client:** Native `fetch()` (Node.js 18+)

### Desktop (Tauri)
- **Rust:** Edition 2021, minimum Rust 1.77.2
- **Crate:** `app_lib` (staticlib/cdylib/rlib)
- **Plugins:** `tauri-plugin-log` 2 (debug only)
- **Build Tool:** `tauri-build` 2.5.6, `@tauri-apps/cli` 2.3.1

---

## Project Structure

### Frontend (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `src/app/` | Next.js App Router routes |
| `src/app/(private)/` | Authenticated pages: `/`, `/agent`, `/sessions`, `/settings`, `/tasks` |
| `src/app/(public)/` | Unauthenticated pages: `/login`, `/setup` |
| `src/app/orb/page.tsx` | Tauri orb window (transparent, clickable sphere, always-on-top) |
| `src/components/` | Reusable UI components |
| `src/components/ui/` | shadcn/ui base components (button, card, input, badge, calendar, etc.) |
| `src/components/layout/` | Shell components: `app-shell.tsx`, `sidebar.tsx`, `topbar.tsx`, `command-palette.tsx`, `activity-inspector.tsx`, etc. |
| `src/components/agent/` | Agent-specific UI: `agent-core.tsx`, `main-composer.tsx`, `voice-button.tsx`, `agent-state-halo.tsx` |
| `src/components/chat/` | Chat UI: `rich-message.tsx`, `session-thread.tsx`, `chat-session-list.tsx` |
| `src/components/desktop/` | Tauri desktop bridge: `desktop-shell-bridge.tsx` (orb window management) |
| `src/components/grid/` | Animated dot-grid canvas: `medium-grid.tsx` |
| `src/features/` | Page-level feature components (the "pages" rendered by routes) |
| `src/core/` | Shared runtime logic, types, and utilities |
| `src/core/mock-data/` | `runtime.ts` — comprehensive mock RuntimeSnapshot for offline development |
| `src/core/runtime/` | `wrapper.ts` — URL and header helpers for backend API calls; `chat-history.ts` — message history helpers, control marker stripping |
| `src/core/theme/` | Theme tokens, navigation items, control specs |
| `src/core/i18n/` | Bilingual dictionary (EN + ES) in `dictionary.ts` |
| `src/core/utils/` | `cn.ts` (clsx + tailwind-merge), `status.ts` (badge variant mapper) |
| `src/hooks/` | Custom React hooks: `use-activities.ts`, `use-automations.ts`, `use-i18n.ts`, `use-memory.ts`, `use-runtime-actions.ts`, `use-runtime.ts`, `use-work-items.ts` |
| `src/stores/` | `use-workspace-store.ts` — Zustand store with persistence |
| `src/providers/` | `root-providers.tsx` — QueryClient, bridge context, toaster, keyboard shortcuts, SSE connection |
| `src/types/` | Domain types: `niki.ts`, `trading.ts` |
| `src/lib/` | `mus.ts` — mouse/click recorder utility (adapted from musjs) |
| `src-tauri/src/` | Rust sources: `main.rs`, `lib.rs` |
| `src-tauri/tauri.conf.json` | Tauri desktop configuration |
| `src-tauri/Cargo.toml` | Rust crate manifest |

### Backend (`backend/src/`)

| Directory | Purpose |
|-----------|---------|
| `src/main.ts` | Entrypoint: NestFactory, CORS, port/host binding |
| `src/server.ts` | TSX CJS registration bootstrap |
| `src/app.module.ts` | Root module importing all feature modules |
| `src/domain/contracts.ts` | Shared domain types (User, Session, Intent, Account, Ledger, WorkItem, Automation, etc.) |
| `src/common/` | Global HTTP request logger middleware |
| `src/modules/common/` | `AppConfigService` (env reader), `RuntimeStateService` (in-memory state), `UserMemoryService` (Upstash Redis), `request-context.ts` |
| `src/modules/health/` | `GET /internal/health` |
| `src/modules/identity/` | `POST /v1/auth/login`, `POST /v1/auth/mfa/verify`, `GET /v1/me` |
| `src/modules/compliance/` | Internal compliance profiles and exceptions |
| `src/modules/audit/` | `GET /v1/activities`, internal audit events |
| `src/modules/automations/` | CRUD + lifecycle for automations |
| `src/modules/runtime/` | Hermes runtime integration: health/status, runs, run events, chat stream proxy, conversation context |
| `src/modules/work-items/` | Task/reminder CRUD with fuzzy matching (service-only, no controller) |
| `src/wrapper/` | **Public-facing wrapper API** — aggregates Runtime, Identity, Audit, Memory, WorkItems, and Automations |

---

## Build, Test, and Development Commands

Run commands per package, **not from the repo root**.

### Frontend

```bash
cd frontend && npm install

# Web dev server (Next.js on port 3000)
npm run dev

# Desktop dev mode (Tauri + Next.js)
npm run tauri:dev

# Validation (required before merging)
npm run lint
npm run typecheck
npm run build

# If you touched Tauri/native code
cargo check --manifest-path src-tauri/Cargo.toml
```

### Backend

```bash
cd backend && npm install

# Development with auto-reload (uses node --watch + tsx)
npm run dev

# Production start (also uses tsx — no compile step required)
npm run start

# Validation (required before merging)
npm run typecheck
npm run build
```

### Notes
- The frontend uses Next.js **static export** (`output: "export"`) into `frontend/out/`.
- Tauri serves `frontend/out` as the frontend dist and loads `http://localhost:3000` in dev mode.
- The backend runs TypeScript directly via `tsx`; the `build` script compiles to `dist/` for deployment flexibility but is not required for local runs.
- There is **no committed unit-test suite**. The minimum merge gate is validation by build and type safety.

---

## Coding Style & Naming Conventions

- **Language:** TypeScript throughout.
- **Indentation:** 2 spaces.
- **Quotes:** Double quotes for strings.
- **Semicolons:** Required.
- **Frontend imports:** Prefer `@/` path aliases (mapped to `./src/*`).
- **React components:** PascalCase (e.g., `AgentView`, `AppShell`).
- **Hooks/helpers:** camelCase (e.g., `useWorkspaceStore`, `wrapperUrl`).
- **Route files & feature modules:** kebab-case (e.g., `trading-panel.tsx`, `chat-sidebar.tsx`, `settings-view.tsx`).
- **Backend files:** Follow NestJS conventions: `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.guard.ts`.
- **Types:** PascalCase for interfaces and type aliases.
- **Zustand store:** Single store in `src/stores/use-workspace-store.ts`.

---

## Testing Guidelines

There is no committed unit-test suite yet. The minimum merge gate is:

- **Frontend:** `npm run lint`, `npm run typecheck`, `npm run build` (and `cargo check` if Tauri code changed).
- **Backend:** `npm run typecheck`, `npm run build`.

If you add tests, colocate them as `*.test.ts`, `*.spec.ts`, `*.test.tsx`, or `*.spec.tsx` next to the code they test.

---

## Runtime Architecture & Communication Flow

```
+-------------------------------------------------------------+
|  Desktop App (Tauri)                                        |
|  +-----------------------------------------------------+    |
|  |  Next.js Frontend (static export)                   |    |
|  |  - Zustand store (persisted to localStorage)        |    |
|  |  - TanStack Query for server state                  |    |
|  |  - SSE/HTTP runtime updates from backend            |    |
|  |  - Direct fetch() to backend wrapper API            |    |
|  +-----------------------------------------------------+    |
+-------------------------------------------------------------+
                              |
                              v HTTP/fetch
+-------------------------------------------------------------+
|  NestJS Backend (localhost:8000)                            |
|  +-----------------------------------------------------+    |
|  |  WrapperController (public routes)                  |    |
|  |  - GET  /healthz                                    |    |
|  |  - GET  /config/public                              |    |
|  |  - GET  /runtime/config                             |    |
|  |  - POST /runtime/config                             |    |
|  |  - GET  /runtime/status                             |    |
|  |  - GET  /runtime/events                             |    |
|  |  - POST /chat/stream  <- SSE proxy to Hermes        |    |
|  |  - GET  /v1/me                                      |    |
|  |  - GET  /v1/activities                              |    |
|  |  - GET/POST/DELETE /v1/memory (Upstash Redis)       |    |
|  |  - GET/POST/PATCH/DELETE /v1/work-items             |    |
|  +-----------------------------------------------------+    |
|  +-----------------------------------------------------+    |
|  |  RuntimeController (/internal/runtime)              |    |
|  |  - status, tools, audit-summary, runtime events     |    |
|  |  - automations CRUD                                 |    |
|  +-----------------------------------------------------+    |
|  +-----------------------------------------------------+    |
|  |  Other modules: identity, audit, automations, etc.  |    |
|  |  (in-memory state via RuntimeStateService)          |    |
|  +-----------------------------------------------------+    |
+-------------------------------------------------------------+
                              |
                              v HTTP/fetch
+-------------------------------------------------------------+
|  Hermes API Server (localhost:8642 or configured)           |
|  - /v1/models                                               |
|  - /v1/runs                                                 |
|  - /v1/runs/{id}/events                                     |
|  - Backend proxies chat streams from here                   |
+-------------------------------------------------------------+
                              |
                              v WebSocket (optional)
+-------------------------------------------------------------+
|  Frontend Runtime Feed                                      |
|  - `GET /runtime/events` Server-Sent Events from backend    |
|  - Live status sync, tool events, and agent status          |
|  - Frontend connects only to the backend                    |
+-------------------------------------------------------------+
```

### Key Connection Points

1. **Frontend -> Backend Wrapper API:** Direct `fetch()` using `wrapperUrl()` and `wrapperHeaders()` helpers. Base URL from `NIKI_BACKEND_BASE_URL` or `NEXT_PUBLIC_NIKI_BACKEND_BASE_URL` (default `http://127.0.0.1:8000`).
2. **Frontend -> Backend Runtime Events:** Live runtime connection via `GET /runtime/events` Server-Sent Events. Product mode is backend-first; `NEXT_PUBLIC_NIKI_RUNTIME_TRANSPORT=mock` is only a dev override for local UI work.
3. **Backend -> Hermes API Server:** `RuntimeService.proxyChatStream()` forwards chat requests to the Hermes API Server at `HERMES_API_SERVER_URL` and consumes run events from `/v1/runs/{id}/events`. In local Hermes setups this is typically exposed by `hermes gateway` after enabling `API_SERVER_ENABLED=true`.
4. **Backend -> Upstash Redis:** Memory storage via REST API (optional, configured via env vars).

---

## Authentication Flow

1. **Setup** (`/setup`) — Configure backend URL and API key. Tests connection via `GET /healthz`.
2. **Login** (`/login`) — Email/password login with MFA (6-digit code).
3. **Private Routes** (`/(private)/*`) — Protected by `PrivateLayout` which checks `accessToken` in Zustand store; redirects to `/login` if missing.
4. **Seeded User:** The backend has a single hardcoded user: `operator@niki.com` / `demo-password` (user ID: `user-demo`). MFA code is `123456`.

---

## Environment Variables

### Root `.env.example` (used by frontend at build time)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_NIKI_RUNTIME_TRANSPORT` | Dev-only override; set to `mock` for offline UI work, otherwise omit and Niki uses backend mode |
| `NIKI_BACKEND_BASE_URL` | Backend wrapper URL (default `http://127.0.0.1:8000`) |
| `NIKI_BACKEND_API_KEY` | API key for backend authentication |
| `NEXT_PUBLIC_NIKI_BACKEND_BASE_URL` | Public alias for client-side backend URL injection |
| `NEXT_PUBLIC_NIKI_BACKEND_API_KEY` | Public alias for client-side backend API key injection |
| `CLAWBOT_DEFAULT_VOICE` | Default TTS voice (default `carla`) |
| `CLAWBOT_STT_LANGUAGE` | STT language (default `es`) |
| `TTS_PROVIDER` | `vibevoice`, `nvidia`, or the local backend voice bridge |
| `NIKI_PROMPT_PROFILE` | Prompt profile (default `conversational`) |

### Backend `.env.example`

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | HTTP server binding (default `127.0.0.1:8000`) |
| `PUBLIC_BASE_URL` | Self-referencing URLs |
| `WRAPPER_API_KEY` / `INTERNAL_API_KEY` | Route guards |
| `HERMES_API_SERVER_URL` | Hermes API Server base URL |
| `HERMES_API_KEY` | Optional Hermes API key |
| `HERMES_MODEL` | Default Hermes model for runs |
| `SUPABASE_URL` / `SUPABASE_*_KEY` | Supabase (configured but unused in current code) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis for memory |
| `NIKI_NO_LISTEN` | If `1`, skips `app.listen()` (useful for testing) |

Keep secrets in local env files (`.env.local` for frontend, `.env` for backend) and commit only `.env.example` templates.

---

## Important Implementation Notes

- **In-memory state only:** `RuntimeStateService` holds all business data (users, sessions, intents, ledger, audit events, work items, automations, etc.) in a private `state` object. There is no database persistence for core business data yet.
- **Single seeded user:** `user-demo` with email `operator@niki.com` and hardcoded password `demo-password`.
- **Policy engine:** Inline in `RuntimeStateService` — evaluates KYC, jurisdiction, exposure limits, and kill switches before intent creation.
- **Simulated execution:** Intents auto-execute through a "sandbox-clob" provider with immediate reserve -> fill journal entries.
- **Two API surface layers:**
  - **Public/Wrapper routes** (`wrapper.controller.ts`) — used by the frontend, guarded by `wrapperApiKey`.
  - **Internal routes** (`/internal/*`) — used by runtime operators, guarded by `internalApiKey`.
- **CORS:** Wide open (`origin: "*"`) with specific allowed headers for API keys and idempotency.
- **Tauri CSP:** Restrictive Content Security Policy allows connections to `http://127.0.0.1:8000`, the configured Hermes API Server, `https://api.coingecko.com`, Google Fonts, and inline scripts/styles.
- **i18n:** Bilingual (EN/ES) via a simple dictionary object in `src/core/i18n/dictionary.ts` — not a full i18n library.
- **Calendar routes:** `/calendar/apple` and `/calendar/google` exist as empty directories with no page files (placeholders).
- **Trading feature:** Has full type definitions (`src/types/trading.ts`) and a dashboard panel, but appears to be a work-in-progress.
- **Voice pipeline:** Routes through local ClawBot API or NVIDIA/VibeVoice TTS providers. STT, chat stream (SSE), and TTS are all supported.
- **No NestJS guards/interceptors:** API key checks are done manually in service methods (`assertWrapperAuthorized`, `assertInternal`) rather than via NestJS guards or interceptors.
- **Work items NLP:** `RuntimeService` has extensive Spanish/English regex-based NLP for task/reminder commands (create, list, complete, delete) with fuzzy matching.
- **Conversation context:** `ConversationContextService` maintains per-session short-term context and captures explicit facts ("my name is...", "remember that...") into Upstash memory.
- **Runtime config override:** The wrapper supports `POST /runtime/config` to override `apiServerUrl`, `apiKey`, and `model` at runtime without restarting. These overrides are stored in-memory in `RuntimeService.runtimeConfigOverride`.

---

## Commit & Pull Request Guidelines

- Follow **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` with short, imperative subjects.
- Keep commits scoped to one concern.
- PRs should include:
  - Summary of changes
  - Affected area (`frontend`, `backend`, or `src-tauri`)
  - Validation commands run
  - Linked issue/task
  - Screenshots or recordings for UI work
- Document any transport, gateway, or port changes in the PR so other contributors can reproduce the environment.

---

## Security Considerations

- **API keys** (`WRAPPER_API_KEY`, `INTERNAL_API_KEY`, `CLAWBOT_API_KEY`) are used for route-level authorization. Never commit real keys.
- **CORS is permissive** (`origin: "*"`) — acceptable for local desktop use but must be tightened for any remote deployment.
- **No HTTPS** in local development — all traffic is over plain HTTP/WebSocket.
- **In-memory data** is ephemeral; restarting the backend resets all state (users, intents, ledger, etc.).
- **Tauri CSP** restricts external connections; if you add new external APIs, update `src-tauri/tauri.conf.json` `csp` accordingly.
- **Supabase env vars** are configured but the current codebase does not instantiate a Supabase client or enforce RLS.
