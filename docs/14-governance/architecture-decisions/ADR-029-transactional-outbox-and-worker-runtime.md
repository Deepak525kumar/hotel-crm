# ADR-029: Transactional Outbox Pattern with a Dedicated Worker Runtime for Asynchronous Notification Dispatch and Scheduled Jobs

- **Status:** Accepted. Ratified directly by the project owner (human decision, recorded 2026-07-23, session `claude/lead-architect-governance-sltkow`) — Constitution §6/§7/§20 human/product + architecture authority. This is the authoritative resolution of governance decision **GD-01** (Notification dispatch & delivery model, `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`).
- **Date:** 2026-07-23
- **Scope:** Platform integration-architecture + data-model decision. Resolves *how* asynchronous notification delivery (EMAIL/PUSH) is performed, how send-failures are handled and retried, and which runtime hosts scheduled reminder/escalation jobs — the questions ADR-027 explicitly left open when it fixed only the `NotificationChannel` enum *shape*. Establishes the canonical asynchronous execution runtime for the modular monolith.
- **Builds on:** `ADR-003` (modular monolith), `ADR-004` (Prisma ORM), `ADR-005` (PostgreSQL), `ADR-027` (Notification Channel enum shape).
- **Supersedes:** No prior ADR. **Amends one prior spec assumption:** `SPEC-NOTIF-001` (§Dependencies / `ASM-NOTIF`) and the job-dispatch/quality specs anticipated that scheduled jobs would run on *"Redis-backed BullMQ"*. This record explicitly replaces that anticipated runtime with a PostgreSQL-backed outbox drained by an in-process poll worker; no Redis-backed queue is introduced (see Constraints).
- **Change class:** Material architecture + data-model decision requiring a Decision Record per Constitution §6/§7, same class as `ADR-016`/`ADR-017`/`ADR-028`. `SPEC-NOTIF-001`'s FROZEN text receives a Decision-Integration forward-note at its next revision (0.3.0); this record is the authority.

## Problem

`ADR-027` fixed the `NotificationChannel` enum as exactly five members (`IN_APP`/`EMAIL`/`PUSH`/`SMS`/`WEBHOOK`) but deliberately did **not** decide per-channel delivery/dispatch implementation, deferring it to `TREQ-002`/`TREQ-012`. In current code (`backend/src/modules/notifications/service.ts:40-46`, verified at HEAD):

- `sendEmail()` and `sendPushNotification()` both `throw NotImplementedError`; there is **zero actual delivery mechanism** beyond the in-app `Notification` DB row.
- All four current producers (`work-requests`, `work-applications`, `attendance`, `quality`) emit notifications fire-and-forget with `.catch(() => {})` (`work-requests/service.ts:265`; `work-applications/service.ts:115,218,333,340`; `attendance/service.ts:222,235,237`; `quality/service.ts:97,220`) — **every send failure is silently swallowed**: no log, no metric, no audit row.
- **No scheduled-job runtime exists** (repo-wide grep for `node-cron`/`setInterval`/`BullMQ`/`agenda`/`cron` over `backend/src` returns nothing). The `SHIFT_REMINDER`/`CHECK_IN_REMINDER` enum values (`schema.prisma:106-107`) are declared but nothing fires them.
- No SMTP/APNs/FCM client exists anywhere in the repository; the `APNS_*`/`FIREBASE_PROJECT_ID` env fields are declared-optional and consumed nowhere.

This left the following open decisions blocking implementation: `OQ-NOTIF-01` (dispatch-design half), `OQ-NOTIF-04` (failure control), `OQ-NOTIF-06` (push-implementation milestone), `OQ-NOTIF-07` (`sendEmail` fate), `OQ-NOTIF-08` (scheduled-job host), `OQ-NOTIF-09` (roster fan-out latency), and the delivery-mechanism half of `OQ-AUTH-01` (`SIR-AUTH-005`: email-mediated password-reset and failed-login-notify-manager delivery). A Decision Record was required before any of this could be planned or built.

## Decision

**Adopt the Transactional Outbox pattern, drained by a dedicated Worker runtime that is the canonical asynchronous execution runtime for the modular monolith.**

**Naming:** this runtime is canonically named the **Platform Worker** throughout this record, the dependency graph, and the implementation plan — not just "the worker" or "a worker process" — since §11 makes it the future home of domain-event publishing (GD-12) as well as notification delivery and scheduled jobs, not a notification-specific component. A future ADR extending its responsibilities should continue to refer to it as the Platform Worker rather than introducing a second name for the same runtime.

### 1. Two separate concepts — `Notification` and `OutboxEvent`

`Notification` and `OutboxEvent` are distinct models with distinct purposes:

| | `Notification` | `OutboxEvent` |
|---|---|---|
| Purpose | User-facing in-app notification (the **inbox**) | Internal delivery/queue record |
| Authority | Existing REST API (`GET /notifications`, `POST /:id/read`) remains authoritative and unchanged | Never exposed directly to any client |
| Owner | `backend-notifications` (`state-notification`) | `backend-notifications` (new `state-outbox`) |

**Ownership is exclusive and explicit:** `OutboxEvent` belongs to `backend-notifications`. No other module writes to `state-outbox` directly — every producer creates outbox rows exclusively through `notificationService.enqueue()`, mirroring the existing `state-notification` single-writer pattern (`DEPENDENCY_GRAPH.yaml:602`).

This resolves the **dispatch-design half of `OQ-NOTIF-01`** (push-only §18 vs. "in-app inbox AND push" §14): every notification continues to persist its `IN_APP` `Notification` row (the durable inbox all three clients already depend on), *and*, when an external dispatch transport applies, one or more `OutboxEvent` rows carry the EMAIL/PUSH delivery. "Push-only" (CONFIRMED §18) means: of the **external dispatch transports**, push is the one built for device delivery; the in-app inbox row is always written, exactly as it is today (`REQ-001`). `EMAIL`/`SMS` remain valid, reserved transports (not dead values), consistent with `ADR-027`.

### 2. Transactional write

A producer's business transaction persists, in a **single commit**:

1. the domain change,
2. the in-app `Notification` row (when a user-facing inbox entry applies), and
3. one `OutboxEvent` row per required external delivery.

Atomicity guarantees the delivery intent can never be lost after a committed domain change, nor created for an aborted one. This replaces the current fire-and-forget `.catch(() => {})` pattern (resolves **`OQ-NOTIF-04`**) and removes the synchronous cross-module network round-trip from producer request paths (resolves **`OQ-NOTIF-09`**: the `work-requests` roster fan-out becomes O(roster) cheap DB inserts, never O(roster) synchronous APNs/FCM calls).

### 3. The Platform Worker

A dedicated **Platform Worker** — a second Node entrypoint into the *same* modular-monolith codebase (shared Prisma client and models; deployed as a separate OS process, e.g. an added `ecosystem.config.js` app / `docker-compose` service) — is the canonical asynchronous execution runtime. It:

- polls `OutboxEvent` and delivers EMAIL/PUSH,
- hosts scheduled reminder/escalation jobs (rework 20-minute escalation `TREQ-003`, contract-expiry reminder `TREQ-007`, broadcast auto-close `TREQ-010`), and
- owns future domain-event publishing (see §11 / GD-12).

This resolves **`OQ-NOTIF-08`** (scheduled-job host) **without contradicting** `backend-notifications`'s "pure sink" boundary: the Platform Worker is a *separate runtime*, not the request-path `notification-service`. The request-path service only *enqueues*; the Platform Worker decides *when* jobs fire and performs delivery.

### 4. Generic transport abstraction

A new `OutboxTransport` enum classifies delivery medium: **`EMAIL`, `PUSH`, `WEBHOOK`, `SMS`**. Only **`EMAIL` and `PUSH` are implemented initially**; `WEBHOOK` and `SMS` are reserved for future use (an `OutboxEvent` with a reserved transport is a valid row the Platform Worker leaves `PENDING`/routes to a not-yet-registered handler, never an error). The Platform Worker dispatches by a transport-handler interface keyed on this enum; adding a transport = registering a handler, no schema change. This resolves **`OQ-NOTIF-06`** (push lands once, early, as a transport handler — not incrementally per-trigger) and **`OQ-NOTIF-07`** (`sendEmail`'s successor is the `EMAIL` transport handler in the Platform Worker; the stub is superseded, not left as dead code).

### 5. Delivery lifecycle

`OutboxStatus` enum: **`PENDING` → `PROCESSING` → `DELIVERED`**, with **`FAILED`** (retryable) and **`DEAD_LETTER`** (terminal, retries exhausted) branches.

### 6. Retry policy

Exponential backoff, **configurable**. Default schedule: **1 minute → 5 minutes → 15 minutes → 1 hour**, then `DEAD_LETTER`. The schedule and max-attempts are read from configuration (`backend/src/config/env.ts`), not hard-coded.

### 7. Idempotency & at-least-once

Every `OutboxEvent` carries a globally unique `event_id` (UUID). The Platform Worker guarantees **at-least-once** processing without duplicate delivery: rows are claimed by an atomic `PENDING → PROCESSING` transition (PostgreSQL `SELECT … FOR UPDATE SKIP LOCKED`, a database feature — **not** an external queue), so concurrent Platform Worker instances never double-claim; the `event_id` is used as the provider-side idempotency key where the transport supports it. Retries re-deliver at-least-once by design; duplicate *effect* is prevented by the claim + idempotency key.

**Transport handlers must themselves be idempotent.** The claim mechanism prevents two Platform Worker instances from processing the same row concurrently, but it does not by itself prevent a *retried* delivery (e.g. after a `FAILED` transition whose underlying send actually succeeded, or a crash between send and status-update) from reaching the provider twice. `event_id` is the canonical idempotency key supplied to each provider where it supports one (e.g. as an SMTP `Message-ID`/idempotency header, an APNs/FCM collapse or dedup key); a handler for a provider that does not support one must implement its own dedup discipline. This is a responsibility of each transport handler, not a guarantee the outbox/claim mechanism provides on its own.

### 8. Polling

**Poll interval is configuration-driven; the initial deployment default is 5 seconds.** This wording is deliberate — it states the policy (configurable) before the current value, so a future change to the default is a configuration change, not an architecture change.

### 9. Retry metadata & observability fields

Beyond the lifecycle fields already listed (§5, §6), `OutboxEvent` carries `attempts`, `next_attempt_at`, `last_error`, and **`processed_at`** (timestamp of the terminal `DELIVERED`/`DEAD_LETTER` transition). `processed_at` is cheap to add now and is the basis for delivery-latency metrics (`processed_at - created_at`) without a later migration.

**Minimum observability surface** (owned by the Platform Worker, exposed however the platform's existing observability convention dictates — no new convention introduced here): counts by status (`queued`/`processing`/`delivered`/`failed`/`dead_letter`), `retry_count` per event, and `delivery_latency` (`processed_at - created_at`) for delivered events. This is the minimum metric set the Platform Worker must make derivable from `OutboxEvent` state; it does not mandate a specific metrics backend.

### 10. Event payload versioning

`OutboxEvent` carries a `payload_version` integer field, starting at `1` for every event produced today. This costs nothing now and avoids a schema migration the first time a payload shape needs to change under active consumers (the Platform Worker's own delivery handlers, and, later, the Event Bus's consumers per §11).

**The `payload` contract itself is not fixed by this ADR** — deliberately: the shape (e.g. `{event_type, aggregate_type, aggregate_id, payload}` vs. `{type, recipient_id, data}`) is an implementation-PR concern, not an architecture one. But it **must be defined once, explicitly, in PR 7.1** (see `IMPLEMENTATION_EXECUTION_PLAN.md` Epic 7) before any producer enqueues an event — every producer uses the same shape from the start; no producer invents its own ad hoc payload structure.

### 11. Future compatibility (GD-12)

The `OutboxEvent` envelope (`event_id`, `event_type`, `payload`, `payload_version`, `aggregate` reference, `created_at`) is shaped to serve **both** notification delivery **and** future domain-event publication. The Transactional Outbox becomes the **canonical producer for the future Event Bus (GD-12)**; no redesign of the outbox is expected when the event bus is introduced — an event-publishing transport/consumer is added alongside the delivery transports.

## Constraints (codified by this decision)

- **No external queue infrastructure.** Kafka, RabbitMQ, SQS, BullMQ, Redis-backed queues, and equivalents are **not** introduced. The outbox is a PostgreSQL table; the Platform Worker is an in-process poller using standard SQL row-locking. (This is the explicit amendment to the prior "Redis-backed BullMQ" assumption noted above.)
- **Modular monolith preserved** (`ADR-003`). The Platform Worker shares the monolith codebase and Prisma client; it is a deployment topology addition (a second process), not a service extraction.
- **Backward compatibility maintained.** The `Notification` model, `GET /notifications`, and `POST /notifications/:id/read` are unchanged. `NotificationType`/`NotificationChannel` grow only additively. Producers keep persisting the in-app row; the outbox row is additive.

## Grounding facts (verified against repository authority at HEAD)

- `backend/src/modules/notifications/service.ts:40-46`: `sendEmail`/`sendPushNotification` throw `NotImplementedError`.
- Fire-and-forget swallow at `work-requests/service.ts:265`, `work-applications/service.ts:115,218,333,340`, `attendance/service.ts:222,235,237`, `quality/service.ts:97,220`.
- No scheduler runtime: grep for `node-cron|setInterval|BullMQ|agenda|cron` over `backend/src` → no matches.
- `SHIFT_REMINDER`/`CHECK_IN_REMINDER` declared (`schema.prisma:106-107`), never fired.
- `NotificationChannel` five-member enum settled by `ADR-027`.
- Modular monolith (`ADR-003`), Prisma 5 (`ADR-004`), PostgreSQL (`ADR-005`) — the outbox + Platform Worker fit these unchanged.

## Compatibility

| Authority | Effect |
|---|---|
| `SPEC-NOTIF-001` (FROZEN 0.2.0) | Gains a Decision-Integration forward-note at 0.3.0: `OQ-NOTIF-01` (dispatch half), `OQ-NOTIF-04`, `OQ-NOTIF-06`, `OQ-NOTIF-07`, `OQ-NOTIF-08`, `OQ-NOTIF-09` resolved to this record; the "Redis-backed BullMQ" assumption superseded. No frozen requirement text is rewritten by this ADR. |
| `ADR-027` | Unchanged and reinforced: the five-member channel enum stands; `OutboxTransport` mirrors the external-dispatch subset (`EMAIL`/`PUSH`/`WEBHOOK`/`SMS`), `IN_APP` remaining the inbox substrate, not an external transport. |
| `SIR-AUTH-005` (`OQ-AUTH-01`) | Delivery-mechanism half unblocked: email-mediated password reset (`TREQ-AUTH-005`) and failed-login-notify-manager (`TREQ-AUTH-007`) now have a transport (EMAIL) + an enqueue path. MFA (`TREQ-AUTH-006`) remains a separate open decision (GD-08), not resolved here. |
| `SIR-AUTH-001` (RESOLVED hotfix) | Its noted gap — "actual delivery of the raw [password-reset] token to the user's inbox remains out of scope (no email-transport capability exists anywhere yet)" — is unblocked by the EMAIL transport; wiring auth to enqueue is a follow-on producer change, not part of this record. |
| `OQ-NOTIF-02` (`SIR-NOTIF-002`, retention) | **Not resolved** (GD-09 territory). This record *adds a new record type* — `OutboxEvent` — that must also be assigned a GDPR retention tier before G8; recorded as a new sub-item under `SIR-NOTIF-002`. |
| `OQ-NOTIF-03` (`SIR-NOTIF-003`, `FEATURE_*` flag), `OQ-NOTIF-05` (`SIR-NOTIF-005`, cross-module send-authz) | **Not resolved** by this record; remain OPEN. |
| `.claude/knowledge/DEPENDENCY_GRAPH.yaml` | Adds `state-outbox` (owner `backend-notifications`) and a `worker` infrastructure node (canonical name **Platform Worker**) in the same governance pass; `notification-service` contract gains an `enqueue` operation. |
| `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` §9 ledger | `OQ-NOTIF-01` dispatch-design row, and `OQ-NOTIF-04/06/07/08/09`, updated to "Resolved — `ADR-029`"; Epic 7 dispatch build sequenced. |
| `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` | `GD-01` marked resolved by this record. |

No blocking contradiction found against any other checked authority.

## Consequences

- New Prisma models/enums: `OutboxEvent` (with `event_id`, `event_type`, `transport`, `status`, `payload`, `payload_version`, `attempts`, `next_attempt_at`, `last_error`, `processed_at`, timestamps), `OutboxStatus`, `OutboxTransport`; plus a `PushToken` model for PUSH. Migrations are additive.
- A new Platform Worker process is added to the deployment topology (`ecosystem.config.js`/`docker-compose`), sharing the backend image.
- `notification-service` gains a transactional `enqueue` operation; the four current producers migrate from `.catch(() => {})` to transactional enqueue (delivery failures become observable via `OutboxEvent.status`/`DEAD_LETTER`).
- The `OutboxEvent.payload` contract (shape only, not enforced by this ADR) must be defined once in PR 7.1 before any producer enqueues, so no producer invents its own ad hoc structure.
- SMTP (EMAIL) and APNs/FCM (PUSH) client libraries are introduced behind transport handlers; the existing `APNS_*`/`FIREBASE_PROJECT_ID`/new SMTP env fields are consumed under explicit secret-storage/rotation/least-privilege handling (carrying forward `MIG-GAP-11`'s security requirement).
- **Backend and mobile ship as separate PRs.** The `PushToken` schema, its registration endpoint, and the PUSH transport handler are a backend-only PR (no Expo/client changes) — mobile push-token registration + OS-permission flow (worker-app, checker-app) is a distinct follow-on PR per app, reviewable and revertible independently of the backend transport. See `IMPLEMENTATION_EXECUTION_PLAN.md` Epic 7 for the exact PR split.
- `OutboxEvent` retention tier is a new required-before-G8 disposition folded into `SIR-NOTIF-002`/GD-09.
- `DECISION_INDEX.md` gains this row (`ADR-029`, Accepted) in the same governance pass.
- Implementation is sequenced as reviewable PRs in `IMPLEMENTATION_EXECUTION_PLAN.md` Epic 7; no code is authorized by this record itself — it authorizes the plan.
