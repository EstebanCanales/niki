# Niki Web and Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a functional Next.js landing and personal portal connected through a separate NestJS cloud backend to Niki's existing local Swift backend.

**Architecture:** `niki-web` owns the public and authenticated browser experience. `niki-cloud` owns identity, PostgreSQL persistence, usage metering, credits, devices, and optional conversation synchronization. `app/backend` publishes signed idempotent events through a durable outbox after real local runtime work completes.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Framer Motion, NestJS, Prisma, PostgreSQL, Zod, Vitest, Supertest, Playwright.

## Global Constraints

- Create isolated root projects at `niki-web/` and `niki-cloud/`.
- Use local ports `3001` for `niki-web` and `4001` for `niki-cloud`.
- Use Spanish product copy and the approved dark “Presence” visual direction.
- Authenticate users with email and a one-time magic code stored only as a hash.
- Derive balances from an immutable credit ledger; clients never submit balances.
- Synchronize full conversation content only after explicit opt-in.
- Keep secrets in `.env` files and commit only `.env.example` templates.
- Preserve all unrelated existing worktree changes.

---

### Task 1: Scaffold the cloud API and database boundary

**Files:**
- Create: `niki-cloud/package.json`
- Create: `niki-cloud/tsconfig.json`
- Create: `niki-cloud/tsconfig.build.json`
- Create: `niki-cloud/src/main.ts`
- Create: `niki-cloud/src/app.module.ts`
- Create: `niki-cloud/src/config/app-config.service.ts`
- Create: `niki-cloud/src/database/prisma.service.ts`
- Create: `niki-cloud/prisma/schema.prisma`
- Create: `niki-cloud/.env.example`
- Test: `niki-cloud/src/health/health.controller.spec.ts`

**Interfaces:**
- Produces: `PrismaService extends PrismaClient`, `AppConfigService`, `GET /healthz -> { ok: true }`.
- Consumes: `DATABASE_URL`, `PORT=4001`, `WEB_ORIGIN=http://localhost:3001`.

- [ ] **Step 1: Write the health test**

```ts
it("returns cloud health", async () => {
  await request(app.getHttpServer()).get("/healthz").expect(200, { ok: true });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd niki-cloud && npm test -- health.controller.spec.ts`
Expected: FAIL because the project and controller do not exist.

- [ ] **Step 3: Scaffold NestJS and Prisma**

Create a strict NestJS application, enable validation, credentialed CORS only for `WEB_ORIGIN`, and define PostgreSQL models for `User`, `WaitlistEntry`, `MagicCode`, `WebSession`, `Device`, `UsageEvent`, `CreditEntry`, `Conversation`, `Message`, and `SyncCursor`. Every table uses UUID IDs and UTC timestamps; `UsageEvent.eventId` and `WaitlistEntry.emailNormalized` are unique.

- [ ] **Step 4: Add the health controller and run validation**

Run: `cd niki-cloud && npm test -- health.controller.spec.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add niki-cloud
git commit -m "feat: scaffold Niki cloud API"
```

### Task 2: Implement waitlist and magic-code authentication

**Files:**
- Create: `niki-cloud/src/auth/auth.module.ts`
- Create: `niki-cloud/src/auth/auth.controller.ts`
- Create: `niki-cloud/src/auth/auth.service.ts`
- Create: `niki-cloud/src/auth/auth.schemas.ts`
- Create: `niki-cloud/src/auth/session.guard.ts`
- Create: `niki-cloud/src/auth/mailer.service.ts`
- Test: `niki-cloud/src/auth/auth.service.spec.ts`
- Test: `niki-cloud/src/auth/auth.controller.spec.ts`

**Interfaces:**
- Produces: `POST /v1/waitlist`, `POST /v1/auth/request-code`, `POST /v1/auth/verify-code`, `POST /v1/auth/logout`, `GET /v1/me`.
- Produces: HTTP-only cookie `niki_session`; `AuthUser { id: string; email: string; displayName: string | null }`.
- Consumes: `MAGIC_CODE_PEPPER`, `SESSION_COOKIE_SECRET`, optional `RESEND_API_KEY`, `MAIL_FROM`, `NIKI_CLOUD_DEV_AUTH`.

- [ ] **Step 1: Write failing service tests**

```ts
it("normalizes duplicate waitlist emails into one record", async () => {
  await service.joinWaitlist(" Person@Example.com ");
  await service.joinWaitlist("person@example.com");
  expect(await prisma.waitlistEntry.count()).toBe(1);
});

it("accepts a valid unexpired code once", async () => {
  const code = await service.issueMagicCode("person@example.com");
  await expect(service.verifyMagicCode("person@example.com", code)).resolves.toMatchObject({ email: "person@example.com" });
  await expect(service.verifyMagicCode("person@example.com", code)).rejects.toThrow();
});
```

- [ ] **Step 2: Run tests and verify failures**

Run: `cd niki-cloud && npm test -- auth.service.spec.ts`
Expected: FAIL because `AuthService` does not exist.

- [ ] **Step 3: Implement auth semantics**

Normalize emails with `trim().toLowerCase()`. Hash codes using HMAC-SHA256 with `MAGIC_CODE_PEPPER`, expire after ten minutes, cap attempts at five, consume codes transactionally, and store only SHA-256 session-token hashes. In development, return `debugCode` only when `NIKI_CLOUD_DEV_AUTH=1`; production sends through `MailerService`.

- [ ] **Step 4: Add HTTP integration tests**

Assert duplicate waitlist success, invalid email rejection, code expiry, secure cookie creation, authenticated `/v1/me`, and logout cookie clearing.

- [ ] **Step 5: Run auth tests and commit**

Run: `cd niki-cloud && npm test -- auth && npm run typecheck`
Expected: PASS.

```bash
git add niki-cloud/src/auth
git commit -m "feat: add waitlist and magic-code auth"
```

### Task 3: Implement devices, usage metering, and credit ledger

**Files:**
- Create: `niki-cloud/src/devices/devices.module.ts`
- Create: `niki-cloud/src/devices/devices.controller.ts`
- Create: `niki-cloud/src/devices/devices.service.ts`
- Create: `niki-cloud/src/metering/metering.module.ts`
- Create: `niki-cloud/src/metering/metering.controller.ts`
- Create: `niki-cloud/src/metering/metering.service.ts`
- Create: `niki-cloud/src/metering/device-signature.service.ts`
- Create: `niki-cloud/src/metering/metering.types.ts`
- Test: `niki-cloud/src/metering/metering.service.spec.ts`
- Test: `niki-cloud/src/metering/device-signature.service.spec.ts`

**Interfaces:**
- Produces: `POST /v1/devices/link-code`, `POST /v1/devices/link`, `GET /v1/devices`, `DELETE /v1/devices/:id`.
- Produces: `POST /v1/device-events/batch` accepting `DeviceUsageBatch`.
- Defines: `UsageCategory = "chat.input_tokens" | "chat.output_tokens" | "voice.stt_seconds" | "voice.tts_seconds" | "tool.call"`.
- Defines: `DeviceUsageEvent { eventId; occurredAt; category; quantity; model?: string; conversationId?: string; metadata?: Record<string, string> }`.

- [ ] **Step 1: Write failing idempotency and ledger tests**

```ts
it("does not debit the same event twice", async () => {
  await service.ingest(device, { events: [event] });
  await service.ingest(device, { events: [event] });
  expect(await prisma.usageEvent.count()).toBe(1);
  expect(await prisma.creditEntry.count({ where: { sourceEventId: event.eventId } })).toBe(1);
});
```

- [ ] **Step 2: Write failing signature tests**

Verify HMAC over `${timestamp}.${rawBody}`, reject timestamps older than five minutes, use constant-time comparison, and reject revoked devices.

- [ ] **Step 3: Implement device linking and metering**

Generate six-character link codes with ten-minute expiry. On link completion, issue a random per-device secret exactly once. Ingest event batches transactionally and calculate integer credit micros using a server-owned rate table.

- [ ] **Step 4: Run metering tests**

Run: `cd niki-cloud && npm test -- metering devices && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add niki-cloud/src/devices niki-cloud/src/metering niki-cloud/prisma
git commit -m "feat: add device metering and credits"
```

### Task 4: Implement dashboard and optional conversation synchronization APIs

**Files:**
- Create: `niki-cloud/src/portal/portal.module.ts`
- Create: `niki-cloud/src/portal/portal.controller.ts`
- Create: `niki-cloud/src/portal/portal.service.ts`
- Create: `niki-cloud/src/conversations/conversations.module.ts`
- Create: `niki-cloud/src/conversations/conversations.controller.ts`
- Create: `niki-cloud/src/conversations/conversations.service.ts`
- Create: `niki-cloud/src/conversations/content-crypto.service.ts`
- Test: `niki-cloud/src/portal/portal.service.spec.ts`
- Test: `niki-cloud/src/conversations/conversations.service.spec.ts`

**Interfaces:**
- Produces: `GET /v1/dashboard`, `GET /v1/usage`, `GET /v1/credits`.
- Produces: `GET /v1/conversations`, `GET /v1/conversations/:id`, `PATCH /v1/settings/conversation-sync`.
- Produces: `POST /v1/device-conversations/batch` for linked devices.
- Consumes: `CONVERSATION_ENCRYPTION_KEY` as a 32-byte base64 key.

- [ ] **Step 1: Write failing dashboard aggregation tests**

Assert UTC period boundaries, per-category totals, current ledger balance, and exclusion of another user's events.

- [ ] **Step 2: Write failing conversation privacy tests**

```ts
it("rejects message content while sync is disabled", async () => {
  await expect(service.ingestBatch(userWithoutSync, batch)).rejects.toThrow("Conversation sync is disabled");
});

it("stores encrypted content and returns decrypted content to its owner", async () => {
  await service.ingestBatch(userWithSync, batch);
  expect((await prisma.message.findFirstOrThrow()).contentCiphertext).not.toContain(batch.messages[0].content);
  expect((await service.getConversation(userWithSync.id, batch.conversationId)).messages[0].content).toBe(batch.messages[0].content);
});
```

- [ ] **Step 3: Implement portal queries and AES-256-GCM content storage**

Store nonce, ciphertext, and authentication tag separately. Bind encryption additional data to user ID, conversation ID, and message ID. Never return content for users other than the owner.

- [ ] **Step 4: Run portal and conversation tests**

Run: `cd niki-cloud && npm test -- portal conversations && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add niki-cloud/src/portal niki-cloud/src/conversations
git commit -m "feat: add portal and conversation APIs"
```

### Task 5: Build the Next.js landing and shared visual system

**Files:**
- Create: `niki-web/package.json`
- Create: `niki-web/next.config.ts`
- Create: `niki-web/tsconfig.json`
- Create: `niki-web/src/app/layout.tsx`
- Create: `niki-web/src/app/page.tsx`
- Create: `niki-web/src/app/globals.css`
- Create: `niki-web/src/components/landing/niki-orb.tsx`
- Create: `niki-web/src/components/landing/waitlist-form.tsx`
- Create: `niki-web/src/components/landing/product-demo.tsx`
- Create: `niki-web/src/lib/cloud-client.ts`
- Create: `niki-web/.env.example`
- Test: `niki-web/src/components/landing/waitlist-form.test.tsx`

**Interfaces:**
- Produces: responsive landing at `/` and reusable `NikiOrb` semantic-state canvas.
- Consumes: `NEXT_PUBLIC_NIKI_CLOUD_URL=http://localhost:4001`, `POST /v1/waitlist`.

- [ ] **Step 1: Write the waitlist form test**

```tsx
it("submits a normalized email and shows confirmation", async () => {
  render(<WaitlistForm />);
  await user.type(screen.getByLabelText("Correo"), "Person@Example.com ");
  await user.click(screen.getByRole("button", { name: "Solicitar acceso" }));
  expect(await screen.findByText("Estás en la lista privada.")).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd niki-web && npm test -- waitlist-form.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the Presence visual system**

Use named CSS variables for obsidian, graphite, frost, cyan, and muted steel. Pair a restrained display face with a readable body face and a monospaced utility face. The signature interaction is a 2D semantic particle orb emerging from a notch silhouette; support reduced motion and keyboard navigation.

- [ ] **Step 4: Implement the page narrative and functional form**

Build the approved hero, three-moment sequence, privacy section, product demo, final CTA, and footer with real Spanish copy. Handle invalid email, duplicate success, network failure, loading, and success states.

- [ ] **Step 5: Run frontend tests and commit**

Run: `cd niki-web && npm test && npm run typecheck && npm run build`
Expected: PASS.

```bash
git add niki-web
git commit -m "feat: build Niki private-access landing"
```

### Task 6: Build magic-code login and portal shell

**Files:**
- Create: `niki-web/src/app/login/page.tsx`
- Create: `niki-web/src/app/(portal)/layout.tsx`
- Create: `niki-web/src/components/auth/magic-code-form.tsx`
- Create: `niki-web/src/components/portal/portal-shell.tsx`
- Create: `niki-web/src/components/portal/portal-nav.tsx`
- Create: `niki-web/src/hooks/use-current-user.ts`
- Test: `niki-web/src/components/auth/magic-code-form.test.tsx`

**Interfaces:**
- Produces: two-step login, authenticated portal layout, logout action.
- Consumes: `/v1/auth/request-code`, `/v1/auth/verify-code`, `/v1/me`, `/v1/auth/logout` with credentials included.

- [ ] **Step 1: Write failing login tests**

Cover request-code state, six-digit code validation, invalid-code error, successful redirect, and development `debugCode` display.

- [ ] **Step 2: Implement login and session-aware portal shell**

Use semantic form labels, visible focus, resend cooldown, and redirect unauthenticated portal visitors to `/login` without flashing private data.

- [ ] **Step 3: Run tests and commit**

Run: `cd niki-web && npm test -- magic-code && npm run typecheck`
Expected: PASS.

```bash
git add niki-web/src/app/login niki-web/src/app/\(portal\) niki-web/src/components/auth niki-web/src/components/portal
git commit -m "feat: add Niki web authentication"
```

### Task 7: Build dashboard, usage, credits, conversations, devices, and settings

**Files:**
- Create: `niki-web/src/app/(portal)/dashboard/page.tsx`
- Create: `niki-web/src/app/(portal)/usage/page.tsx`
- Create: `niki-web/src/app/(portal)/credits/page.tsx`
- Create: `niki-web/src/app/(portal)/conversations/page.tsx`
- Create: `niki-web/src/app/(portal)/conversations/[id]/page.tsx`
- Create: `niki-web/src/app/(portal)/devices/page.tsx`
- Create: `niki-web/src/app/(portal)/settings/page.tsx`
- Create: `niki-web/src/components/portal/usage-chart.tsx`
- Create: `niki-web/src/components/portal/credit-ledger.tsx`
- Create: `niki-web/src/components/portal/conversation-list.tsx`
- Create: `niki-web/src/components/portal/device-list.tsx`
- Test: `niki-web/src/app/(portal)/dashboard/page.test.tsx`
- Test: `niki-web/src/app/(portal)/settings/page.test.tsx`

**Interfaces:**
- Produces: all portal routes defined in the design.
- Consumes: dashboard, usage, credits, conversations, devices, and settings cloud endpoints.

- [ ] **Step 1: Write failing dashboard and privacy tests**

Assert credit balance and usage totals render, empty device state guides linking, conversation content stays hidden when sync is off, and toggling sync requires explicit confirmation.

- [ ] **Step 2: Implement portal data states**

Every page must render loading, loaded, empty, and actionable error states. Charts use accessible summaries in addition to graphics. Credits display immutable entries and never expose an editable balance.

- [ ] **Step 3: Run portal tests and build**

Run: `cd niki-web && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add niki-web/src/app/\(portal\) niki-web/src/components/portal
git commit -m "feat: add Niki personal portal"
```

### Task 8: Connect the existing local backend through a durable outbox

**Files:**
- Create: `app/backend/src/modules/cloud-sync/cloud-sync.module.ts`
- Create: `app/backend/src/modules/cloud-sync/cloud-sync.service.ts`
- Create: `app/backend/src/modules/cloud-sync/cloud-sync.types.ts`
- Create: `app/backend/src/modules/cloud-sync/cloud-outbox.service.ts`
- Create: `app/backend/src/modules/cloud-sync/cloud-signature.service.ts`
- Test: `app/backend/src/modules/cloud-sync/cloud-outbox.service.test.ts`
- Test: `app/backend/src/modules/cloud-sync/cloud-sync.service.test.ts`
- Modify: `app/backend/src/app.module.ts`
- Modify: `app/backend/src/modules/runtime/runtime.service.ts`
- Modify: `app/backend/src/modules/voice/voice.service.ts`
- Modify: `app/backend/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `CloudSyncService.recordUsage(event: DeviceUsageEvent): Promise<void>` and `recordConversation(batch: DeviceConversationBatch): Promise<void>`.
- Consumes: `NIKI_CLOUD_URL`, `NIKI_CLOUD_DEVICE_ID`, `NIKI_CLOUD_DEVICE_SECRET`, `NIKI_CLOUD_SYNC_ENABLED`.
- Persists: `app/backend/.niki/cloud-outbox.json` using atomic temporary-file replacement.

- [ ] **Step 1: Write failing outbox tests**

Assert events survive service re-instantiation, duplicate event IDs collapse, successful acknowledgements remove only acknowledged events, and corrupt files are quarantined without data overwrite.

- [ ] **Step 2: Write failing signature and retry tests**

Assert exact signature compatibility with `niki-cloud`, exponential delays are bounded, offline errors preserve events, and HTTP 401 disables delivery until credentials change.

- [ ] **Step 3: Implement cloud sync**

Record events before network delivery. Flush bounded batches in the background without blocking chat or voice. Emit chat token events from completed runtime responses, voice duration events after STT/TTS completion, and tool events after actual tool outcomes.

- [ ] **Step 4: Add optional conversation batches**

Only enqueue message content when the local account setting enables conversation sync. Usage metering remains active independently.

- [ ] **Step 5: Run backend tests and commit**

Run: `cd app/backend && node --import tsx --test src/modules/cloud-sync/*.test.ts && npm run typecheck && npm run build`
Expected: PASS.

```bash
git add app/backend/src/modules/cloud-sync app/backend/src/app.module.ts app/backend/src/modules/runtime/runtime.service.ts app/backend/src/modules/voice/voice.service.ts app/backend/.env.example .gitignore
git commit -m "feat: sync Niki usage with cloud"
```

### Task 9: Add end-to-end contracts, seed data, and local launch

**Files:**
- Create: `contracts/cloud-sync.ts`
- Create: `niki-cloud/src/contracts/cloud-sync.contract.spec.ts`
- Create: `app/backend/src/modules/cloud-sync/cloud-sync.contract.test.ts`
- Create: `niki-cloud/prisma/seed.ts`
- Create: `niki-web/e2e/private-access.spec.ts`
- Create: `niki-web/playwright.config.ts`
- Create: `docs/NIKI_WEB_LOCAL_SETUP.md`

**Interfaces:**
- Produces: one shared schema for `DeviceUsageBatch` and `DeviceConversationBatch`.
- Produces: development user, initial 500-credit grant, linked-device fixture, and representative usage data.

- [ ] **Step 1: Add shared contract tests**

Validate identical payload fixtures in cloud and local backend tests. Reject unknown categories, negative quantities, malformed timestamps, and duplicate IDs inside one batch.

- [ ] **Step 2: Add seed and browser test**

The browser test submits a waitlist email, requests and verifies a development code, opens the dashboard, confirms credits and usage, enables conversation sync, and visits the devices page.

- [ ] **Step 3: Run the full verification matrix**

Run: `cd niki-cloud && npm test && npm run typecheck && npm run build`
Run: `cd niki-web && npm test && npm run typecheck && npm run build && npm run test:e2e`
Run: `cd app/backend && node --import tsx --test src/modules/cloud-sync/*.test.ts && npm run typecheck && npm run build`
Expected: all commands PASS.

- [ ] **Step 4: Launch the requested local preview**

Run `niki-cloud` on `127.0.0.1:4001` and `niki-web` on `127.0.0.1:3001`. Verify `GET http://127.0.0.1:4001/healthz` and open `http://localhost:3001` in the browser.

- [ ] **Step 5: Commit**

```bash
git add contracts niki-cloud niki-web docs/NIKI_WEB_LOCAL_SETUP.md
git commit -m "test: verify Niki web cloud flow"
```
