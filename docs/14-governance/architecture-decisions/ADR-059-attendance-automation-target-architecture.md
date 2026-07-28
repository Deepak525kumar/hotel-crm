# ADR-059: Automated Reminders and ABSENT/NO_SHOW Marking Are the Target Attendance Architecture — Implementation Deferred

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-21`'s sole genuine
  sub-decision (Attendance Operational Automation). Authored by the Lead Architect from
  `SPEC-ATT-001`'s `OQ-ATT-07`/`SIR-ATT-007` and `schema.prisma`'s declared-but-dead `SHIFT_REMINDER`/
  `CHECK_IN_REMINDER` enums, reframed at the commissioning human's explicit direction to separate the
  architecture question ("should attendance ultimately automate reminders and no-show marking?") from the
  implementation-timing question ("when is it built?") — the same pattern as `ADR-054` (Job Dispatch),
  `ADR-053` (Chatbot), and `ADR-038` (MFA).
- **Date:** 2026-07-28
- **Scope:** `SPEC-ATT-001`. Resolves the target-architecture question only: whether automated shift/check-in
  reminders and automatic ABSENT/NO_SHOW marking are the platform's permanent direction. Does not authorize
  implementation, does not set a grace-period or trigger-condition policy, and does not schedule when this is
  built.
- **Supersedes:** none (additive — ratifies a target capability the schema's own dead enums already
  anticipated, but which was never itself governance-authorized).
- **Change class:** Product/architecture decision per Constitution §6/§7 — separates destination from journey,
  the same pattern established by `ADR-054`, `ADR-053`, and `ADR-038`.

## Problem

`schema.prisma`'s `NotificationType` enum declares `SHIFT_REMINDER` (pre-shift reminder) and
`CHECK_IN_REMINDER` (sent when shift start approaches with no check-in) — both confirmed dead by a repository-
wide grep of `backend/src` (zero references outside the schema declaration). `SPEC-ATT-001`
(`OQ-ATT-07`/`SIR-ATT-007`) leaves ABSENT/NO_SHOW automation as an open question. Today, ABSENT/NO_SHOW is set
exclusively via a manager's manual `PATCH /attendance/:id` — no reminder or auto-absence job exists.

The original framing risked conflating two separate questions: "should the platform automate this" and "should
we build it before or after MVP." Deciding the second first, and letting it silently answer the first
("we're keeping MVP small, so automation is rejected"), would misrepresent a delivery-scheduling choice as an
architectural one — exactly the failure mode `ADR-054`, `ADR-053`, and `ADR-038` were each structured to avoid.

## Decision

1. **Automated attendance operations are the permanent target architecture.** Specifically: scheduled
   pre-shift and missed-check-in reminders (`SHIFT_REMINDER`, `CHECK_IN_REMINDER`), and automatic ABSENT/
   NO_SHOW marking after a missed check-in, are confirmed as the platform's eventual direction — not merely a
   deferred-but-uncommitted possibility.

2. **If implemented, the execution mechanism MUST be the Platform Worker** (`ADR-029`), consistent with
   `ADR-057`'s generalization of that pattern as the platform's canonical scheduled-job runtime, and with
   attendance's own existing use of the outbox for `WORKER_NO_SHOW` notification delivery today
   (`attendance/service.ts:262-283`). No new infrastructure decision is required if this is built.

3. **This record ratifies the target only.** It does not authorize implementation, does not set a grace-period
   or override policy, does not decide how automatic ABSENT marking interacts with a late-arriving check-in
   race, and does not schedule when this is built. The current manual manager-override path continues
   unaffected, unchanged, and fully authoritative until a future implementation decision says otherwise.

4. **The `SHIFT_REMINDER`/`CHECK_IN_REMINDER` enums are retained, not removed.** They are no longer ambiguous
   dead code awaiting a decision — they are the correctly-anticipated target schema surface for a now-ratified
   capability, not yet wired to a producer.

## Rationale

- **Separating destination from journey keeps the architecture answer durable**, the same reasoning `ADR-054`
  applied to the Job Dispatch pivot: bundling "is this correct" with "when do we build it" would let MVP
  delivery pressure silently answer the architecture question by default, forcing it to be re-litigated later
  under the same pressure that produced the wrong answer the first time.
- **The dead enums were the right instinct, just never authorized.** Their existence in the schema, with zero
  wiring, indicates the platform's own prior design work anticipated this capability; this record simply gives
  it the governance backing it was missing, rather than treating "unused" as "unwanted."
- **No new infrastructure question exists.** `ADR-029`/`ADR-057` already establish the Platform Worker as the
  canonical mechanism for exactly this shape of work (scheduled jobs, notification delivery), and attendance
  already uses the same outbox pattern today for a related notification. Ratifying the target here costs
  nothing in mechanism uncertainty.

## Consequences

- `SPEC-ATT-001`'s `OQ-ATT-07` is resolved as target-architecture-confirmed, no longer an open question.
- The manual manager-override path for ABSENT/NO_SHOW remains the sole live mechanism; no runtime behavior
  changes as a result of this record.
- A future implementation decision — separate from this record, following the same pattern as `ADR-058`
  (Job Dispatch Migration Strategy) — is required before automation is actually built: it would set the
  grace-period/trigger policy, sequencing, and timing, none of which this record decides.
- `SHIFT_REMINDER`/`CHECK_IN_REMINDER` remain in `schema.prisma`, now with governance backing rather than as
  unexplained dead code.
- No code changes are made or authorized by this record.

## Compatibility

No runtime behavior changes — the current manual manager-override path is unaffected. No migration, no
rollback concern.

## Scope note

This settles only whether attendance automation is the correct permanent target. It does not authorize
implementation, does not set an automation policy (grace period, trigger conditions, override rules), and does
not schedule when this is built — a future implementation decision, analogous to `ADR-058`, owns all of that.
