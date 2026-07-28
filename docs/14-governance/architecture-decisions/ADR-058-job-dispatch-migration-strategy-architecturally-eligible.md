# ADR-058: Job-Dispatch Migration Strategy — Existing Two-Phase Plan Ratified; Architecturally Eligible on GD-03, Scheduling Deferred to Implementation Planning

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving the fifth sub-decision
  of `GD-20` (Job-Dispatch two-tier calendar+broadcast pivot) and completing `GD-20`'s core decomposition.
  Authored by the Lead Architect from `SPEC-JOB-DISPATCH-001`'s existing Rollout and Compatibility section,
  refined at the commissioning human's explicit direction to avoid implying `GD-03` is the sole gate on
  implementation, and to state explicitly that `ADR-054`–`ADR-057` introduce no new migration dependencies.
- **Date:** 2026-07-28
- **Scope:** `SPEC-JOB-DISPATCH-001`'s Rollout and Compatibility section (`MODULE_SPEC.md:488-506`). Resolves
  whether the existing Phase 1/Phase 2 migration plan remains sound now that `ADR-054` (target architecture),
  `ADR-055` (broadcast lifecycle), `ADR-056` (assignment model), and `ADR-057` (background execution) have
  each detailed the target it moves toward, and what condition governs implementation eligibility.
- **Supersedes:** none (additive — ratifies an already-specified migration plan; does not alter its phase
  content).
- **Change class:** Architecture/process decision per Constitution §6/§7 — completes `GD-20`'s sub-decision
  decomposition (`ADR-054` through `ADR-058`).

## Problem

`GD-20`'s decomposition deliberately withheld the "when/how do we build it" question from Sub-decisions 1
through 4, each of which settled a piece of the target architecture without authorizing its implementation.
`SPEC-JOB-DISPATCH-001` already carries a migration plan on paper (`MODULE_SPEC.md:495-506`): a **forward
refactor**, not a dual-running migration, justified by the system being pre-launch with no production
employee data — Phase 1 (Regional Manager role/scope, envelope refactor, `WorkApplication` removal,
`WorkerAssignment` repointing, marketplace re-labeling) and Phase 2 (Calendar direct-assignment, daily
exclusivity, sick/vacation auto-cancel, Broadcast `JobRequest` with arbitration and auto-close), feature-flagged
for safe partial deploys, with trivial rollback (disable flag, redeploy prior build) since phases are additive
and pre-launch. Two questions needed resolution: does this plan still hold given four sub-decisions have since
detailed the target, and what condition determines when implementation may actually begin.

## Decision

1. **The existing Phase 1/Phase 2 forward-refactor migration plan is ratified as-is, unmodified by
   `ADR-054` through `ADR-057`.** No re-sequencing, re-phasing, or structural change is made to
   `MODULE_SPEC.md:495-506`.

2. **`ADR-054` through `ADR-057` do not invalidate the existing migration sequencing.** Each of those records
   clarifies or ratifies the target architecture the plan moves toward; none of them introduces a new
   migration dependency, a new data-model concern the plan doesn't already account for, or a new ordering
   constraint between Phase 1 and Phase 2. The two-phase forward-refactor, feature-flagged rollout, and
   trivial-rollback characteristics of the existing plan remain valid without modification.

3. **Implementation becomes architecturally eligible once `GD-03` (roles/org-chart) is resolved.** `GD-03`
   is named because the plan's own Phase 1 depends on the Regional Manager role and role×scope model
   (`TREQ-008`), which `GD-03`'s still-open org-chart half governs. This is a description of an architectural
   dependency, not a claim that `GD-03` is the only consideration bearing on implementation.

4. **Actual scheduling, prioritization, and sequencing against other work remain the responsibility of
   implementation planning, not this governance record.** This decision establishes eligibility, not a
   start date. When implementation is planned, ordinary implementation-planning practice — capacity, other
   in-flight priorities, staffing — determines when it actually begins and in what order relative to other
   work, none of which this ADR constrains or anticipates.

## Rationale

- **The existing plan is already the simplest available shape given the actual constraint.** Pre-launch, no
  production employee data means a forward refactor carries none of the risk a dual-running migration would
  need to hedge against; feature-flagging and trivial rollback are the natural consequence, not something
  this decision needed to invent or improve on.
- **Sub-decisions 1–4 clarified the destination; they did not change the road.** `ADR-054` ratified the
  two-tier model, `ADR-055` detailed broadcast, `ADR-056` detailed the assignment model, `ADR-057` settled
  execution mechanism (Platform Worker, optimistic concurrency) — each answered "what is correct," and none
  altered a fact the migration plan's phase ordering depends on (what must exist before what). A plan that
  was sound before those four decisions remains sound after them.
- **Naming `GD-03` as the eligibility gate, without calling it the only gate, keeps the distinction between
  architecture and delivery accurate.** `GD-03`'s org-chart resolution is a real, specific architectural
  dependency (Phase 1 needs the Regional Manager role) — but conflating "eligible to build" with "will be
  built next" would smuggle a scheduling decision into a governance record that has no basis for making one.
  Implementation planning is where capacity, competing priorities, and staffing are actually weighed; this
  ADR does not pre-empt that process.

## Consequences

- `SPEC-JOB-DISPATCH-001`'s Rollout and Compatibility section stands as written; no edit is required to its
  Phase 1/Phase 2 content.
- `GD-20`'s parent entry in `GOVERNANCE_DECISIONS_REQUIRED.md`/`GOVERNANCE_REGISTER.md` is updated to reflect
  that all five core sub-decisions (`ADR-054`–`ADR-058`) are now resolved.
- Implementation planning, when it takes up this work, inherits a ratified target architecture (`ADR-054`–
  `057`) and a ratified migration plan (`ADR-058`) — it does not need to re-derive either, only to sequence
  actual delivery against them once `GD-03` resolves and other priorities allow.
- `GD-20` Sub-decision 6 (Analytics/Attendance follow-up) was subsequently evaluated and closed as **moot**:
  `OQ-05`/`OQ-06` (attendance) and `OQ-ANALYTICS-04` are mechanically resolved by `ADR-054`/`ADR-056`, with no
  independent decision required.
- No code changes are made or authorized by this record.

## Compatibility

No runtime behavior changes — no target-model code exists yet to be affected; the current marketplace
implementation continues unaffected pending `GD-03` and subsequent implementation planning. No migration, no
rollback concern at the governance layer.

## Scope note

This settles only whether the existing migration plan remains valid and what governs implementation
eligibility. It does not schedule implementation, does not resolve `GD-03` itself, and does not resolve `GD-20`
Sub-decision 6 (Analytics/Attendance follow-up).
