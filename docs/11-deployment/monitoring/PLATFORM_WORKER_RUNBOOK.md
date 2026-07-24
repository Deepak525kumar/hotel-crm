# Platform Worker — Delivery Observability & Dead-Letter Runbook

| Field | Value |
|---|---|
| Build item | Epic 7 PR 7.6 — Delivery observability + dead-letter operability |
| Decisions | [ADR-029 (Transactional Outbox + Platform Worker)](../../14-governance/architecture-decisions/ADR-029-transactional-outbox-and-worker-runtime.md) §5, §6, §9 |
| Runtime | [`backend/src/worker.ts`](../../../backend/src/worker.ts) (pm2 app `hotel-crm-worker`) |
| Operator surface | `backend/src/modules/notifications/outbox-admin-{service,controller}.ts` |
| Data | `OutboxEvent` (`state-outbox`), owned by `backend-notifications` |

## What the Platform Worker does

A second Node process over the same monolith codebase (ADR-029 §3). Every poll
tick (default 5s, `OUTBOX_POLL_INTERVAL_MS`) it claims due `OutboxEvent` rows
with `SELECT … FOR UPDATE SKIP LOCKED`, dispatches each to its transport
handler, and records the outcome. It delivers; it never enqueues.

## Delivery lifecycle

```
PENDING ──claim──> PROCESSING ──success──> DELIVERED        (terminal)
   ▲                    │
   │                    └──failure──> FAILED ──retries exhausted──> DEAD_LETTER (terminal)
   │                                    │                                  │
   └────────── backoff elapsed ─────────┘                                  │
   └───────────────────── operator requeue ────────────────────────────────┘
```

- **Backoff schedule** (`OUTBOX_BACKOFF_SCHEDULE_MS`, default `1m, 5m, 15m, 1h`).
  Its *length* is also the retry count: once a row has failed more times than
  there are entries, it is dead-lettered.
- **Stale `PROCESSING` reclaim** (`OUTBOX_PROCESSING_TIMEOUT_MS`, default 5m): a
  row left `PROCESSING` longer than this is treated as abandoned (worker crashed
  mid-delivery) and reclaimed. Handlers are idempotent (ADR-029 §7), so an
  occasional re-delivery of an already-sent row is safe.

## Metrics

`GET /api/v1/notifications/outbox/metrics` (admin only). This is ADR-029 §9's
minimum surface, derived from `OutboxEvent` — it does not mandate or assume any
metrics backend.

| Field | Meaning | Watch for |
|---|---|---|
| `counts` | Row count per status, zero-filled | `dead_letter` climbing at all; `failed` climbing steadily |
| `backlog_count` | Rows not yet terminal (`PENDING` + `PROCESSING` + `FAILED`) | Sustained growth = delivery slower than production |
| `oldest_pending_age_ms` | Age of the oldest non-terminal event | **The wedge detector.** A steady `backlog_count` looks identical whether the queue is flowing or stuck; a growing oldest-age does not. |
| `delivery_latency_ms.average` | Mean `processed_at - created_at` over `DELIVERED` rows | Step changes after a deploy or provider incident |
| `attempts` (per row, in the dead-letter listing) | ADR-029 §9's `retry_count` | — |

`oldest_pending_age_ms` is `null` when the backlog is empty (not `0` — an empty
queue is not a zero-age queue).

## Triage: what a `DEAD_LETTER` row means

The event exhausted its full retry schedule. Its `last_error` holds the final
failure, `attempts` the number of tries. **Dead-lettering is not audited** — the
`OutboxEvent` row already records status, attempts, last error, and
`processed_at` in full. Operator *interventions* are audited (below).

Common causes by transport:

| Transport | Typical `last_error` | Usual meaning |
|---|---|---|
| `EMAIL` | `401`/`403` from SendGrid/Resend | API key revoked, rotated, or scoped wrong |
| `EMAIL` | `4xx` on the recipient | Bad or bouncing address on the `User` row |
| `PUSH` | `PushTransportHandler: delivery failed on every registered device` | Provider outage, or every device token stale |
| `PUSH` | provider `5xx` | APNs/FCM incident — usually resolves; requeue after |
| any | DB/connection errors | Worker lost the database mid-delivery |

A permanently invalid push token is **not** a dead-letter cause: the handler
deletes such tokens automatically (PR 7.5) and does not count them as failures.

## Operator actions

Both are admin-only and **both write one `AuditLog` row** (`resource_type:
OUTBOX_EVENT`, `resource_id`: the event's `event_id`, with the transport,
source module, attempts, and last error captured in `details`). The `event_id`
is used rather than the table row id so the trail stays meaningful after a
discard removes the row.

### List

```
GET /api/v1/notifications/outbox/dead-letters?page=1&per_page=20
```

Newest terminal transition first. Each row carries `attempts` and `last_error`.

### Requeue — "the cause is fixed, try again"

```
POST /api/v1/notifications/outbox/dead-letters/<id>/requeue
```

Moves `DEAD_LETTER → PENDING` with `next_attempt_at = now`, so the very next
drain claims it. Audited as `outbox.requeue`.

**`attempts` and `last_error` are preserved, deliberately.** They are the
event's failure history, and keeping them means a requeued event re-enters the
schedule at its existing attempt count — so an event whose schedule is already
exhausted dead-letters again after its next failure instead of looping forever.
A requeue is therefore *one more attempt*, not a fresh budget of them.

Fix the underlying cause **before** requeueing; otherwise the event simply
dead-letters again.

### Discard — "this can never be delivered"

```
DELETE /api/v1/notifications/outbox/dead-letters/<id>
```

**Permanently deletes the row.** Audited as `outbox.discard`, and that audit
entry is the only remaining record of the event — which is why it captures the
full snapshot. Use when the event is genuinely undeliverable and re-attempting
is pointless (recipient deleted, notification long stale, malformed legacy row).

Neither action can touch an event that is not `DEAD_LETTER`: both are guarded on
that status, so an in-flight event can never be requeued or discarded out from
under the worker, and two operators racing the same row cannot double-apply
(the loser gets `404`).

## Standard triage sequence

1. `GET .../outbox/metrics` — is `oldest_pending_age_ms` growing? Is `dead_letter` non-zero?
2. If the backlog is growing but nothing is dead-lettering: check the worker is
   alive (`pm2 status hotel-crm-worker`) and its logs for `Platform Worker tick failed`.
3. If events are dead-lettering: `GET .../outbox/dead-letters`, group by
   `transport` and `last_error`.
4. Fix the cause (rotate the key, wait out the provider incident, correct the data).
5. Requeue the affected events. Re-check metrics on the next tick.
6. Discard only what is genuinely undeliverable.

## Related

- Retention for `OutboxEvent` rows is **not yet decided** — an open disposition
  under `SIR-NOTIF-002` / GD-09, required before G8. Dead-lettered rows
  currently accumulate until discarded by an operator.
