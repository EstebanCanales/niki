# Niki Web and Cloud Design

## Objective

Build a connected Niki web product for personal users. It combines a public private-access landing page with an authenticated portal for credits, usage, conversations, devices, and privacy controls. The existing Swift app remains the personal desktop experience; its local backend reports trusted usage to a separate cloud backend.

## Projects

Two isolated projects will be created at the repository root:

- `niki-web/`: Next.js App Router, TypeScript, responsive public landing and authenticated portal.
- `niki-cloud/`: NestJS API with PostgreSQL persistence, authentication, metering, credits, conversation synchronization, and device management.

The existing `app/backend/` remains Niki's local runtime broker. It will gain a small cloud-sync client but will not become the public cloud API.

## Product experience

### Public landing

The landing uses the approved “Presence” direction: an obsidian interface, restrained cyan light, and a signature notch/orb interaction. Its single conversion goal is joining the private-access waitlist.

Page sequence:

1. Hero with animated semantic orb, headline “Tu Mac, ahora más cerca de ti.”, and email waitlist form.
2. Three connected moments: speak naturally, retain context, and act through tools.
3. Privacy and local-execution explanation.
4. Product demonstration featuring the notch and desktop control center.
5. Final waitlist form and compact footer.

The page will not include fabricated testimonials, pricing, or a generic feature grid.

### Authentication

Private users authenticate using email and a one-time magic code. A successful waitlist invitation enables portal access. Sessions use secure HTTP-only cookies. The Swift app links to the same account through a device-link code generated in the portal.

### Portal routes

- `/dashboard`: credits, usage summary, connected devices, and recent activity.
- `/usage`: token, voice, tool, and runtime consumption over selectable periods.
- `/credits`: current balance and an immutable ledger of grants and debits.
- `/conversations`: synchronized conversation history when explicitly enabled.
- `/devices`: linked Macs, health, last synchronization, and revoke action.
- `/settings`: profile, privacy, and conversation-sync controls.

## Connected architecture

The approved architecture uses the existing local backend as a trusted mediator:

1. Swift sends chat, voice, and tool requests to `app/backend/` as it does today.
2. The local backend measures usage after real runtime outcomes are known.
3. It writes events to a durable local outbox before attempting delivery.
4. It submits signed, idempotent event batches to `niki-cloud/`.
5. `niki-cloud/` validates device identity, stores usage, and computes credit debits.
6. `niki-web/` reads account data only from `niki-cloud/`.

Swift never receives a cloud signing secret and never calculates its own balance. Failed cloud deliveries remain in the local outbox and retry with bounded exponential backoff.

## Cloud data model

- `users`: personal account and access state.
- `waitlist_entries`: normalized email, source, status, and timestamps.
- `magic_codes`: hashed one-time codes with expiry and attempt limits.
- `sessions`: hashed web session tokens and expiry.
- `devices`: linked Mac identity, public credential, status, and last seen time.
- `usage_events`: immutable idempotent metering events with category, quantity, model, and timestamps.
- `credit_ledger`: immutable grants, debits, adjustments, and resulting balance metadata.
- `conversations`: optional synchronized thread metadata.
- `messages`: optional encrypted synchronized message content.
- `sync_cursors`: per-device delivery and conversation synchronization progress.

Credit balance is derived from the ledger. Usage events carry a unique event ID; duplicate delivery cannot debit twice.

## Privacy

Usage totals, credit consumption, and operational metadata synchronize by default after a device is linked. Full conversation content is opt-in. When enabled, message content is encrypted before storage and can be disabled without preventing usage metering. Revoking a device invalidates future signed uploads from that device.

## API boundaries

Public endpoints cover waitlist submission, magic-code authentication, and session logout. Authenticated portal endpoints expose dashboard summaries, usage, credit ledger, conversations, devices, and settings. Device endpoints cover link completion, heartbeat, event batches, conversation batches, and sync acknowledgements.

All mutation endpoints validate schemas, enforce rate limits, and support idempotency where retries are expected. Browser requests use secure cookies and CSRF protection; device requests use per-device signatures and timestamps to prevent replay.

## Error handling

- Duplicate waitlist submissions return success without creating duplicate records.
- Invalid or expired magic codes provide a retry path without revealing whether an unrelated account exists.
- Metering batches are transactional: accepted events and credit entries commit together.
- Invalid signatures and stale timestamps are rejected and audited.
- Portal empty states explain how to link the first Mac or enable conversation sync.
- Network failures in the local backend preserve events for later delivery.

## Testing and validation

- Unit tests for normalization, magic-code expiry, signature validation, idempotency, credit calculations, and privacy settings.
- API integration tests for waitlist, authentication, device linking, metering, and conversation sync.
- Next.js component and route tests for public and authenticated states.
- End-to-end browser coverage for waitlist submission, login, dashboard, and privacy toggling.
- Contract tests shared between `app/backend/` and `niki-cloud/` for event payloads.
- Responsive and accessibility checks, including keyboard focus and reduced motion.

## Local ports

- `niki-web`: `http://localhost:3001`
- `niki-cloud`: `http://localhost:4001`

The projects will include environment templates and scripts, but neither service will assume production secrets in source control.

## Initial delivery

The first implementation delivers the complete route structure, functional waitlist and magic-code login, a persistent PostgreSQL schema, seeded portal data, device-link and metering contracts, dashboard visualizations, credits ledger, optional conversation sync, tests, and a local preview on the agreed ports.
