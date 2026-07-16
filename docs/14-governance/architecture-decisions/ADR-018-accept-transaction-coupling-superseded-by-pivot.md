# ADR-018: Accept-Transaction Cross-Owner Coupling — Superseded by the Confirmed Pivot

- **Status:** Accepted — ratified by the commissioning human on 2026-07-15 via the G2 Approval Workflow.
- **Date:** 2026-07-15
- **Scope:** Architecture / state ownership — the cross-owner write coupling in the accept-application transaction, where `backend-work-applications` writes three state domains in one transaction: its own `state-work-application`, plus `state-work-request` and the `EXPECTED` seed row in `state-attendance` (`backend/src/modules/work-applications/service.ts:219,243,256`; `.claude/knowledge/DEPENDENCY_GRAPH.yaml`).
- **Supersedes:** none directly. Records the disposition of `SIR-GLOB-003` / `SIR-JOBD-003` (`FIND-ARCH-003`) / `SIR-ATT-003` (`FIND-ARCH-001`, attendance `OQ-03`).
- **Change class:** Architecture Decision Record disposing of a recorded cross-owner-coupling finding. This record introduces **no** architectural change to current code; it classifies the existing coupling as intentionally retired by the already-confirmed pivot.

## Problem

Two independent architecture reviews (job-dispatch `FIND-ARCH-003`; attendance `FIND-ARCH-001`) recorded a cross-owner coupling: one accept-application transaction reaches across three state domains owned by different modules. Per Constitution §12 this required **either** an approved-coupling Decision Record **or** an explicit "superseded-by-pivot" record before the affected specifications (`SPEC-JOB-DISPATCH-001`, `SPEC-ATT-001`) could advance to G2 Specification Freeze. Neither existed, leaving both specs architecturally `BLOCKED`.

## Decision

**The accept-transaction cross-owner coupling is classified as SUPERSEDED BY THE CONFIRMED PIVOT.** It is not adopted as an approved permanent architecture pattern.

- The confirmed pivot (`PIVOT_DESIGN_DOCUMENT.md` §5.5/§9.1) **retires the marketplace apply/accept flow** (`WorkApplication`) entirely, replacing it with the two-tier calendar + broadcast target model. The transaction that performs the cross-owner writes ceases to exist in the target model.
- The `EXPECTED`-attendance-row seed currently written cross-owner by `backend-work-applications` (`service.ts:256`) is likewise part of the retired flow; under the target model, `EXPECTED`-row seeding is re-homed to the target owner as part of the calendar-model implementation (tracked as attendance `OQ-05`, an implementation-time re-homing, not a standing coupling to govern).
- Because the coupling is retired rather than adopted, **no approved-coupling contract is added to `DEPENDENCY_GRAPH.yaml`**; the coupling remains recorded as a disposed finding, not a sanctioned edge.

## Rationale

- The coupling exists only in the pre-pivot marketplace code that the confirmed target model deletes; adopting it as permanent architecture (an approved-coupling DR) would wrongly imply it survives.
- Re-architecting the coupling now, in code that the pivot removes, is wasted effort.
- A superseded-by-pivot record is the lowest-cost disposition that makes both specifications architecturally consistent with the recorded target model.

## Consequences

- `SPEC-JOB-DISPATCH-001` and `SPEC-ATT-001` are unblocked for G2 on the architecture axis (their `architecture BLOCKED` status is cleared).
- The pre-pivot coupling remains in live code until the pivot implementation removes it; that removal is implementation work tracked against the frozen specs, not a spec-freeze blocker.
- `SIR-GLOB-003`, `SIR-JOBD-003`, and `SIR-ATT-003` move to RESOLVED (superseded-by-pivot) in the Specification Issues Register.
- Attendance `OQ-05` (`EXPECTED`-seed re-homing under the target model) remains an implementation-time item under the calendar model, no longer a standing architecture blocker.

## Scope note

This disposes of the cross-owner accept-transaction coupling only. It does not resolve the migration-gap sets (`MIG-GAP-*`, deferred by design), the live security findings on these modules (implementation track), or owner *assignment* (`SIR-GLOB-001`/`SYNC-001`).
