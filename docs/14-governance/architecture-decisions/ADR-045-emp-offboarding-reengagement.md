# ADR-045: Employee-Management Offboarding Trigger — Hybrid (Automatic for Contract Lapse, Manual Otherwise); Re-Engagement via New EmploymentRecord

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-EMP-04`, the seventh sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-EMP-001`'s own `OD-EMP-04` entry and the commissioning human's explicit approval of Option (c), with the clarification that re-engagement creates a new `EmploymentRecord`.
- **Date:** 2026-07-28
- **Scope:** `SPEC-EMP-001`'s `Active → Deactivated` transition. Consumes `SPEC-HR-001`'s `OD-HR-03`/`ADR-040` (contract lapse trigger) as its automatic-path input.
- **Supersedes:** none (additive — `employee-management` retains its existing Admin-driven soft-delete mechanism unchanged; this decision adds a second, automatic trigger path alongside it).
- **Change class:** Product/architecture decision per Constitution §6/§7.

## Problem

`SPEC-EMP-001`'s `Active → Deactivated` transition is Admin-driven soft-deletion, but the triggering workflow — what actually initiates offboarding — and any re-engagement path (a previously-deactivated worker returning) were both undefined. This mattered concretely once `SPEC-HR-001`'s `OD-HR-03` (contract lapse workflow, resolved this session via `ADR-040`) needed a downstream target: `ADR-040` explicitly said contract lapse "triggers offboarding via `SPEC-EMP-001`'s own `OD-EMP-04`" — but `OD-EMP-04` itself had no resolved mechanism to receive that trigger.

## Decision

1. **Contract-lapse-caused offboarding triggers `Deactivated` automatically**, via a direct in-process call from `backend-hr` (per `ADR-040`'s manager-confirmed lapse) to `employee-management`, consistent with `ADR-032`'s platform transport convention (synchronous cross-module effect, same request/transaction boundary).

2. **Every other offboarding cause remains Admin-initiated manually** — voluntary resignation, termination for cause, or any cause outside HR's own contract state machine. No automated trigger is invented for causes with no upstream event to hang off of.

3. **Re-engagement creates a new `EmploymentRecord` for the existing `Worker`, not a reactivation of the closed record.** A previously-deactivated employment period is a closed, historical record; re-hiring the same person is a new employment relationship, modeled as a new record. The prior record's history and audit trail remain untouched and intact.

## Rationale

- **Automating the one cause with a real upstream signal avoids an unnecessary manual step** for the common, structured case (contract lapse) while not inventing automation for causes the platform has no event for (resignation, termination) — Constitution §6 disfavors speculative automation ahead of a real trigger.
- **New-record re-engagement keeps the data model clean and historically accurate.** Reactivating a closed `EmploymentRecord` would raise ambiguous questions about what "reactivated" means for audit history spanning two distinct employment periods (different start dates, possibly different terms); a new record for a new employment period is unambiguous and preserves the original record's integrity.
- **Direct in-process call, not the Outbox:** this is a synchronous effect that should complete atomically with HR's own lapse confirmation, matching `ADR-032`'s criterion for the direct-call half of the platform's transport convention (not an async/durable delivery case).

## Consequences

- `SPEC-EMP-001`'s `OD-EMP-04` row and `Active → Deactivated` transition description are updated to state the hybrid trigger mechanism and the new-record re-engagement model.
- `SPEC-HR-001`'s `OD-HR-03`/`ADR-040` now has a concrete downstream target: its lapse trigger calls into this resolved mechanism.
- No code changes are made or authorized by this record — both modules remain effectively unimplemented for this capability (`employee-management` has only its Epic-5 slice built; `backend-hr` is zero-code); this settles the target behavior for whenever both are built.

## Compatibility

No runtime behavior changes — no code exists for this specific capability today. No migration, no rollback concern.

## Scope note

This settles the offboarding trigger mechanism and re-engagement data model only. It does not resolve any other `GD-15` sub-decision, and does not itself implement the in-process call between `backend-hr` and `employee-management`.
