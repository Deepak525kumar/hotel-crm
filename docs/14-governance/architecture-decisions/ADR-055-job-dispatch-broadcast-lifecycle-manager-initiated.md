# ADR-055: Broadcast Is Exclusively Manager-Initiated — Cancellation Never Implicitly Touches a JobRequest

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving the second sub-decision of
  `GD-20` (Job-Dispatch two-tier calendar+broadcast pivot), and closing `ADR-052`'s deferred re-broadcast
  question. Authored by the Lead Architect from `SPEC-JOB-DISPATCH-001`'s `TREQ-002` through `TREQ-006` and
  the commissioning human's explicit direction to add an audit-trail/bounded-context guarantee beyond the
  originally proposed option.
- **Date:** 2026-07-28
- **Scope:** `SPEC-JOB-DISPATCH-001`. Ratifies `TREQ-002` through `TREQ-006` (broadcast lifecycle) as already
  specified, and resolves the one open product question left after `ADR-054`: whether a Calendar-cancelled
  slot auto-re-broadcasts. Presupposes `ADR-054`'s ratification of the two-tier target architecture.
- **Supersedes:** none (additive — ratifies already-specified `TREQ` rows; closes a question `ADR-052` left
  open rather than reopening `ADR-052` itself).
- **Change class:** Product/architecture decision per Constitution §6/§7 — scoped to one bounded-context
  ownership question, comparable in weight to `ADR-021` (Calendar/Job-Dispatch ownership boundary), which this
  decision extends.

## Problem

`SPEC-JOB-DISPATCH-001`'s broadcast lifecycle (`TREQ-002..006`, `MODULE_SPEC.md:119-123`) is already fully
specified with no ambiguity: a manager raises a standalone `JobRequest` (skill(s) × headcount-per-skill);
eligible workers are those matching skill AND free that day; first acceptance wins each slot (tie-break:
earliest server-received timestamp); late responders receive an explicit "requirement fulfilled" notice; an
unfilled `JobRequest` auto-closes after 6 hours or manual manager close. One question was left open by
`ADR-052` (Calendar auto-cancel boundary): when a same-day assignment is cancelled because a worker marked
sick/vacation (`ADR-021`'s `EVT-CAL-SickVacationMarked` → assignment-cancellation flow), does the freed slot
reopen or re-enter the broadcast pool automatically, or does it simply become vacant pending a manager's own
action? `ADR-052` deliberately left this to Job Dispatch's own resolution rather than deciding it from
Calendar's side.

## Decision

1. **`TREQ-002` through `TREQ-006` are ratified as already specified** — broadcast is fired only on a
   standalone manager request (`TREQ-002`); no other trigger path is introduced.

2. **A Calendar-cancelled slot does NOT auto-re-broadcast.** Assignment cancellation — whether from
   `ADR-021`'s `EVT-CAL-SickVacationMarked` consumption or any other cancellation path — never implicitly
   creates or modifies a `JobRequest`. Broadcast remains exclusively a manager-initiated action, exactly as
   `TREQ-002` already states; no system-initiated trigger path is added alongside it.

3. **If a manager chooses to re-fill a cancelled slot via broadcast, that is represented as a brand-new
   `JobRequest`, with its own identity and its own full lifecycle** (creation, eligibility computation,
   first-accept arbitration, auto-close timer) — never as a reopened, resumed, or mutated instance of a
   previously closed or cancelled `JobRequest`. A closed `JobRequest` remains closed permanently; it is never
   transitioned back to an open state by any code path.

## Rationale

- **Matches `TREQ-002` exactly as written, with no amendment required.** `TREQ-002` already states broadcast
  fires "only on a standalone manager request." Introducing an automatic re-broadcast trigger from
  cancellation would require amending `TREQ-002` itself to add a second trigger path; declining to do so keeps
  the frozen target spec internally consistent without reopening it.
- **Preserves bounded-context ownership established by `ADR-021`.** `ADR-021` settled that Calendar's
  auto-cancel effect stops at emitting `EVT-CAL-SickVacationMarked`; Job Dispatch consumes it only to cancel
  the assignment, within its own boundary. Extending that consumption to also spawn a new `JobRequest` would
  make cancellation-handling code responsible for the broadcast domain's own concern (deciding whether/when to
  re-solicit workers) — the same kind of cross-concern coupling `ADR-021` and `ADR-018` were each written to
  eliminate.
- **A new `JobRequest` per re-broadcast preserves a clean audit trail.** Reopening a closed request would mean
  a single `JobRequest` row's history spans two unrelated fulfillment attempts, muddying "when was this
  specific gap first identified, and when was it closed" for any future read (analytics, audit log, manager
  history view). A new row per manager-initiated re-broadcast keeps one `JobRequest` = one lifecycle = one
  clear audit record, at the cost of no meaningful complexity (creating a new `JobRequest` is already the
  system's only broadcast-creation path).
- **No silent broadcast storms.** Automatic re-broadcast on every cancellation (including bulk sick-day events)
  could fire an unbounded number of unsolicited notifications to workers with no manager in the loop deciding
  whether re-filling that slot is even still needed. Requiring a manager action keeps broadcast volume tied to
  an actual human decision.

## Consequences

- `SPEC-JOB-DISPATCH-001`'s `TREQ-002..006` are ratified without amendment.
- `ADR-052`'s deferred question is now answered: Calendar's auto-cancel scope ends at cancellation; no
  re-broadcast, automatic or otherwise, follows from it. `ADR-052` itself required no change — it explicitly
  disclaimed taking a position on this policy question and is not contradicted by this answer.
- Any future assignment-cancellation code path (`ADR-021`'s consumer of `EVT-CAL-SickVacationMarked`, or any
  other cancellation trigger) must not create, reopen, or mutate a `JobRequest` as a side effect. A
  `JobRequest`'s `CLOSED`/`CANCELLED` state is a one-way terminal state with no code-level transition back to
  open, by any caller.
- A manager-initiated re-broadcast of a previously-filled-then-cancelled slot always creates a new
  `JobRequest` row with a new identity; no `JobRequest` is ever reused across two separate fulfillment
  attempts.
- `GD-20` Sub-decision 3 (Assignment Model) and Sub-decision 4 (Background Execution) are unaffected by this
  record and proceed independently.

## Compatibility

No runtime behavior changes — no broadcast/`JobRequest` code exists yet to be affected. No migration, no
rollback concern.

## Scope note

This settles only the broadcast lifecycle's trigger-path and re-broadcast-boundary questions. It does not
decide the slot-arbitration *mechanism* (Redis slot lock vs. DB `FOR UPDATE` fallback — `TREQ-004`'s
implementation, reserved for `GD-20` Sub-decision 4, Background Execution), does not decide the
`WorkerAssignment`/`CalendarEntry`/`WorkApplication`-removal data model (`GD-20` Sub-decision 3, Assignment
Model), and does not resolve migration timing or sequencing (`GD-20` Sub-decision 5, Migration Strategy).
