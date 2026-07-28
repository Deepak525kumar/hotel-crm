# ADR-041: Payslip-Request Escalation — 3-Business-Day Auto-Escalation via the Existing Outbox

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-HR-09`, the third sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-HR-001`'s own `OD-HR-09` entry and the commissioning human's explicit approval of Option (a) with a 3-business-day window.
- **Date:** 2026-07-28
- **Scope:** `SPEC-HR-001`. Resolves `OD-HR-09` and `REQ-HR-009`'s failure-modes/recovery completeness.
- **Supersedes:** none (additive — resolves an undefined escalation behavior; `backend-hr` has zero code).
- **Change class:** Product decision per Constitution §6/§7.

## Problem

`REQ-HR-009` confirms a worker can request a payslip, with manual manager fulfilment by email as the only path — no worker-facing payslip content-return route exists. No escalation or reminder behavior was confirmed for a request the manager never fulfills, leaving a real gap: a payslip request could sit indefinitely with no recourse for the worker.

## Decision

1. **Payslip requests unfulfilled after 3 business days auto-escalate.** The escalation notification goes to the requesting worker's manager's own manager, or an Admin if no such manager exists in the reporting structure — via the existing Outbox mechanism (`ADR-029`), the platform's sole approved async/durable delivery path.

2. **The escalation is a notification only, not a re-assignment or automatic fulfilment.** It surfaces the unfulfilled request to a higher-authority actor; it does not itself send the payslip, change the request's assignee, or bypass the original manager.

3. **The 3-business-day window is a starting default, not a hard-coded, unchangeable value** — it should be implemented as a configurable interval, consistent with how other time-based platform behaviors (e.g., session/reset-token sweeps) are configuration-driven rather than hard-coded.

## Rationale

- **This is exactly the shape of problem the Outbox already solves well:** a delayed, asynchronous, durable notification is the Outbox's core use case (`ADR-029`); no new delivery mechanism is needed.
- **A silent/manual-only path (rejected Option (b)) doesn't fix the disclosed gap** — it leaves the exact "never fulfilled" failure mode unaddressed, just less visible to a case audit.
- **A visibility-only aging indicator (rejected Option (c)) is a reasonable minimum but doesn't operationally resolve the case** — it makes the problem visible without giving anyone besides the original (non-responsive) manager an actionable path to fix it.
- **3 business days** balances giving a manager reasonable time to act (payslip fulfilment is a manual, off-platform email send) against not leaving a worker waiting indefinitely for compensation-adjacent information.

## Consequences

- `SPEC-HR-001`'s `OD-HR-09` is resolved with the concrete escalation mechanism above. `REQ-HR-009`'s failure-modes/recovery section may now be completed against this resolution.
- This is the first `GD-15` sub-decision to introduce a genuinely new automated behavior (a scheduled/triggered check + Outbox enqueue) rather than a pure type-shape or authority-model resolution — implementation will need a scheduled check (mirroring the Platform Worker's existing sweep-job pattern) to identify unfulfilled requests past the window.
- No code changes are made or authorized by this record — `backend-hr` remains zero-code; this settles the target behavior for whenever the module is built.

## Compatibility

No runtime behavior changes — no code exists for this capability today. No migration, no rollback concern.

## Scope note

This settles the payslip-request escalation mechanism only. It does not decide the reporting-structure lookup mechanism for "the manager's own manager" (an implementation detail dependent on `GD-03`'s still-open org-chart data model, `OD-EMP-12`) — if that data model isn't available when this is built, escalating directly to Admin is an acceptable fallback, not a blocking dependency.
