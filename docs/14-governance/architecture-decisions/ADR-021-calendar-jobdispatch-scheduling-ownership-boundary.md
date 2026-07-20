# ADR-021: Calendar ↔ Job Dispatch Scheduling-Ownership Boundary — Narrow Calendar to Absence + Availability, Job Dispatch Retains Assignment/Exclusivity/`CalendarEntry`

- **Status:** Accepted — ratified by the commissioning human on 2026-07-19. Authored by the Lead Architect from the SPEC-CALENDAR-001 first-round G4 architecture review (BLOCKED) and human direction to resolve the boundary by narrowing Calendar rather than amending the frozen Job Dispatch specification.
- **Date:** 2026-07-19
- **Scope:** Module boundary / state ownership — the scheduling boundary between `backend-calendar` (`SPEC-CALENDAR-001`, REVIEW) and the **FROZEN** `SPEC-JOB-DISPATCH-001@0.3.0` (`backend-work-requests`/`backend-work-applications`/`backend-assignments`). Resolves `SPEC-CALENDAR-001`'s open decisions `OD-CAL-01` (availability-indicator ownership), `OD-CAL-02` (daily-exclusivity enforcement locus), and `OD-CAL-03` (`CalendarEntry`↔`WorkerAssignment` relationship / cross-boundary write). Also resolves `SPEC-EMP-001` `OD-EMP-07` (availability derivation deferred "until Calendar + Job Dispatch freeze").
- **Supersedes:** none (additive). Refines the capability assignment of `ADR-011` (Scheduling capability → `backend-calendar`), which explicitly left `OD-CAL-01` open, by partitioning the *state and enforcement* ownership underneath that capability.
- **Change class:** Material architecture/ownership decision requiring a Decision Record per Constitution §6/§7, mirroring the ADR-016/ADR-017 precedent. This record settles the ownership boundary only; it authors no code and does not itself freeze `SPEC-CALENDAR-001`.

## Problem

`SPEC-CALENDAR-001` v0.1.0 claims, as Calendar-owned target state, the `CalendarEntry` model, direct-placement `WorkerAssignment` creation, and cross-path **daily-exclusivity enforcement** (`docs/03-modules/calendar/MODULE_SPEC.md` REQ-CAL-T01/T05/T08, RULE-CAL-04/05, `:136`, `:141`). But the already-**FROZEN** `SPEC-JOB-DISPATCH-001@0.3.0` already owns those exact concerns: it adds the `CalendarEntry` model, and "does own calendar/broadcast assignment creation and daily exclusivity" (`docs/03-modules/job-dispatch/MODULE_SPEC.md:275,299-300,383`). `state-worker-assignment`'s authoritative writer is `backend-assignments` (`.claude/knowledge/STATE_OWNERSHIP_INDEX.yaml`), and `SPEC-EMP-001` `RULE-EMP-05` states exclusivity is "enforced by Job Dispatch; this module reflects it." Two accepted/frozen authorities therefore contradict on one boundary — a single state model (`CalendarEntry`), a single invariant (daily exclusivity), and a single owned domain (`state-worker-assignment`) each claimed by two modules. A specification set cannot freeze with this unresolved (G4 architecture gate: **BLOCKED**; FIND-001/002/003, all High).

## Decision

The boundary is resolved by **narrowing `backend-calendar`**, leaving the frozen `SPEC-JOB-DISPATCH-001` unchanged:

1. **Assignment creation, `WorkerAssignment`, `CalendarEntry` (as the assignment record), and daily-exclusivity ENFORCEMENT remain owned by Job Dispatch / `backend-assignments`** (the frozen `SPEC-JOB-DISPATCH-001@0.3.0` authority). Calendar neither creates assignments, nor writes `WorkerAssignment`/`CalendarEntry`, nor enforces the one-assignment-per-worker-per-day invariant. (`OD-CAL-02` → Job Dispatch; `OD-CAL-03` → assignment write stays with the assignments/Job-Dispatch owner.)

2. **`backend-calendar` owns the worker-absence dimension** — a worker self-marking a current/future day `sick` or `vacation` — as its own state domain (`state-calendar-absence`, a Calendar-owned model distinct from the Job-Dispatch `CalendarEntry` assignment record). This is the confirmed CRR §22 / PDD §4.5 capability with no cross-module ownership conflict.

3. **The same-day auto-cancel is effected by an EVENT, not a cross-boundary write.** When a worker marks `sick`/`vacation`, Calendar emits `EVT-CAL-SickVacationMarked`; Job Dispatch / `backend-assignments` (the `WorkerAssignment` owner) consumes it and cancels the same-day assignment within its own boundary. Calendar performs no write to `state-worker-assignment`. (`OD-CAL-03` cross-boundary write → removed.)

4. **`backend-calendar` owns the today-only availability read-model** — the derivation of the red/green "available today" signal — reading the same-day-assignment fact from Job Dispatch/assignments and the `sick`/`vacation` fact from its own `state-calendar-absence`. Calendar owns the *derivation/read-model*, not the underlying assignment state. This resolves `OD-CAL-01` and `SPEC-EMP-001` `OD-EMP-07`.

5. **Daily exclusivity is reflected, not enforced, by Calendar.** Consistent with `SPEC-EMP-001` `RULE-EMP-05` and the frozen `SPEC-JOB-DISPATCH-001`, the invariant is enforced at the assignment-write locus (Job Dispatch / the assignments-owned partial unique index); Calendar surfaces it in the calendar view.

## Rationale

- **Least disruption, no reopening of frozen authority:** the frozen `SPEC-JOB-DISPATCH-001` already implements the assignment/exclusivity/`CalendarEntry` semantics; keeping them there requires no change to a frozen specification, whereas the alternative (transferring ownership to Calendar) would reopen and re-freeze `SPEC-JOB-DISPATCH-001` and re-touch `state-worker-assignment` ownership.
- **Single authoritative writer preserved:** each contested concern ends with exactly one owner — assignment/exclusivity/`CalendarEntry` at Job Dispatch/assignments; absence + availability-derivation at Calendar — restoring the single-authoritative-writer invariant the G4 review found violated.
- **No new cross-owner write coupling:** the event-driven auto-cancel avoids the exact cross-boundary-write pattern that `ADR-018` had to dispose of elsewhere; Calendar stays within its boundary.
- **Coheres with `ADR-011`:** Calendar retains the *Scheduling capability* surface (worker-facing calendar/absence/availability) while the assignment-creation mechanics it depends on remain with their frozen owner.

## Consequences

- `SPEC-CALENDAR-001` must be **re-authored at its next revision** to reflect the narrowed scope: remove Calendar's ownership claims over `CalendarEntry` (assignment), `WorkerAssignment` creation, and exclusivity enforcement; add the Calendar-owned `state-calendar-absence` domain; specify the availability read-model; and specify `EVT-CAL-SickVacationMarked` as the auto-cancel mechanism. This is a Documentation-Workflow action this record unblocks but does not itself perform. `SPEC-CALENDAR-001` remains **REVIEW / not frozen**; its G4 round must complete (three reviewers — dependency, consistency, performance — were interrupted and must be re-run) against the re-authored text.
- On ratification, the knowledge layer will record: a new `state-calendar-absence` domain (authoritative writer `backend-calendar`) in `DEPENDENCY_GRAPH.yaml`/`STATE_OWNERSHIP_INDEX.yaml`/`OWNERSHIP_INDEX.yaml`/`BOUNDARY_INDEX.yaml`; `CalendarEntry`/`state-worker-assignment` ownership unchanged (Job Dispatch/assignments); and `EVT-CAL-SickVacationMarked` as a Calendar-published event consumed by the assignments/Job-Dispatch owner. **None of these knowledge edits are applied by this Proposed record** — they follow ratification.
- `SPEC-EMP-001` `OD-EMP-07` is resolved (availability owned by Calendar); `SPEC-EMP-001` `RULE-EMP-05` (exclusivity enforced by Job Dispatch) is confirmed, not contradicted.
- Security release-prerequisites from the G4 security review (`FIND-SEC-CAL-001/002/004`: manager/self hotel-scoping and notification-recipient scoping) are unaffected by this record and remain to be resolved in the re-authored spec / at G8.

## Compatibility

No runtime behavior changes as a result of this record alone; the frozen `SPEC-JOB-DISPATCH-001` and all existing code paths are untouched. `backend-calendar` is an unbuilt route-registered stub (`backend/src/modules/calendar/service.ts:5-11`, all methods throw), so no live behavior is narrowed. The record assigns accountability and the target boundary; it relocates no code.

## Scope note

This settles the Calendar↔Job-Dispatch scheduling-ownership boundary (`OD-CAL-01/02/03`, `OD-EMP-07`) only. It does not resolve Calendar's other open decisions (`OD-CAL-04` timezone/"today" anchoring, `OD-CAL-06` notification contract, `OD-CAL-07` manager/regional scope, `OD-CAL-10` reception-data stub disposition, `OD-CAL-11` auto-cancel/broadcast ripple), the `OD-CAL-05` registry-`active`↔`stub` reconciliation, or owner assignment (`OD-CAL-09`/`SYNC-001`) — each remains OPEN under its own row and is handled on its own track.
