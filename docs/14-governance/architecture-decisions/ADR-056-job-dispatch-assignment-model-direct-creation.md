# ADR-056: Direct WorkerAssignment Creation Is the Target Assignment Model — No Application Intermediary

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving the third sub-decision of
  `GD-20` (Job-Dispatch two-tier calendar+broadcast pivot). Authored by the Lead Architect from
  `SPEC-JOB-DISPATCH-001`'s `TREQ-001`, `TREQ-007`, `TREQ-009`, `TREQ-010`, `TREQ-011`, `TREQ-012`, `TREQ-013`,
  reframed at the commissioning human's explicit direction around the architectural outcome — direct
  `WorkerAssignment` creation — rather than around the specific implementation artifacts (models, endpoints)
  that the current marketplace implementation happens to use.
- **Date:** 2026-07-28
- **Scope:** `SPEC-JOB-DISPATCH-001`. Ratifies the assignment data model and creation path
  (`TREQ-001/007/009/010/011/012/013`) as the target architecture. Presupposes `ADR-054` (two-tier target
  architecture) and is consistent with `ADR-055` (broadcast lifecycle) and `ADR-021` (Calendar/Job-Dispatch
  ownership boundary), neither of which it reopens.
- **Supersedes:** none (additive — ratifies already-specified `TREQ` rows as target architecture; does not
  amend `ADR-021`).
- **Change class:** Platform architecture decision per Constitution §6/§7 — establishes the target data model
  independent of its own implementation timing, the same pattern as `ADR-054`.

## Problem

`SPEC-JOB-DISPATCH-001`'s target assignment model (`TREQ-001/007/009/010/011/012/013`) is already fully and
unambiguously specified, but — like the overall two-tier model before `ADR-054` — had never itself been
governance-ratified as target architecture. The cluster covers one cohesive architectural outcome: a
`WorkerAssignment` is created directly from either assignment path (calendar placement or broadcast accept),
with no intermediating application/acceptance record, one worker-per-day exclusivity enforced at the data
layer, a bounded skill vocabulary, same-day cancellation on a consumed absence event, and no formal
multi-state job-status machine layered on top. Treating each `TREQ` row as its own decision would decompose
below product-decision granularity — these requirements cannot be independently varied by the Product Owner,
since they describe one workflow's data shape, not several unrelated choices.

## Decision

1. **`WorkerAssignment` is created directly from either assignment path — a calendar placement or a broadcast
   accept — with no intermediating application or acceptance record required for its creation (`TREQ-001`,
   `TREQ-012`).** The target architecture has no concept of a worker expressing interest and a manager
   separately approving it before an assignment exists; assignment creation is the direct, atomic outcome of
   the manager's placement action or the worker's winning broadcast response.

2. **Daily exclusivity is enforced at the data layer: one active assignment per worker per calendar day,
   regardless of which path created it** (`TREQ-007`). This is a single invariant enforced by a partial unique
   index keyed on (worker, day), not per-request as in the current implementation.

3. **A same-day assignment is cancelled automatically upon consuming Calendar's absence-marked event**
   (`TREQ-009`), within this module's own boundary, consistent with `ADR-021`'s event-driven, non-transactional
   contract — this decision does not alter that mechanism, only ratifies that the assignment-model side
   consumes it as specified.

4. **Worker skill is a bounded enum** — {Cleaner, Public Service, Kitchen Dishwasher, Waiter} — rather than
   free text, and is the basis for both calendar-direct eligibility and broadcast matching (`TREQ-010`).

5. **No formal multi-state job-status lifecycle is layered above assignment existence** — status handling
   beyond assignment existence and attendance is manual, not system-enforced (`TREQ-013`).

6. **This ADR establishes the target model only.** It does not authorize implementation of this model, does
   not schedule or authorize any migration, and does not authorize retirement of the current marketplace
   implementation (its own application/acceptance-mediated assignment path, which remains fully in force and
   unaffected by this record). Implementation, migration sequencing, and any eventual retirement of the current
   implementation are governed exclusively by `GD-20` Sub-decision 5 (Migration Strategy).

## Rationale

- **Describing the outcome, not the artifacts, keeps this decision architecture-level.** The governing question
  is "how does an assignment come to exist" (directly, from either path) — not "which model is deleted" or
  "which endpoint is removed." The latter are consequences that follow mechanically once the architectural
  outcome is ratified; they are migration/implementation detail, not a separate product decision, consistent
  with the same test applied throughout `GD-20`'s decomposition: can the Product Owner answer this
  independently of the others? Direct creation, day-level exclusivity, bounded skills, and no formal status
  machine cannot be independently varied — they are one cohesive assignment-model decision.
- **Explicitly withholding implementation/migration/retirement authority prevents this record from being
  misread as authorizing a build.** The same separation of destination from journey that `ADR-054` established
  for the overall model applies identically here: ratifying the target data model says nothing about when it
  is built or what happens to the current implementation in the meantime.
- **No countervailing evidence has surfaced** against any of the seven `TREQ` rows ratified here — each was
  already CONFIRMED product/architecture authority in the frozen spec, and nothing in this decomposition
  process argues for reconsidering any of them.

## Consequences

- `SPEC-JOB-DISPATCH-001`'s `TREQ-001/007/009/010/011/012/013` are ratified as ADR-confirmed target
  architecture, matching `ADR-054`'s ratification of the overall model.
- The current marketplace implementation's own assignment path (application/acceptance-mediated) continues
  entirely unaffected — this record authorizes no change to it, and its retirement (if any) is not decided
  here.
- `GD-20` Sub-decision 5 (Migration Strategy) inherits full and exclusive responsibility for whether, when, and
  in what sequence the target assignment model is implemented and the current implementation's
  application/acceptance path is retired.
- `ADR-021`'s event-driven cancellation contract is unaffected; this record ratifies the assignment-model side
  of that contract without reopening it.
- No code changes are made or authorized by this record.

## Compatibility

No runtime behavior changes — the current marketplace assignment path continues exactly as built; no
target-model code exists yet to be affected. No migration, no rollback concern.

## Scope note

This settles only the target assignment-model architecture. It does not authorize implementation, does not
schedule or authorize migration, and does not authorize retirement of the current marketplace implementation —
all three remain the exclusive responsibility of `GD-20` Sub-decision 5 (Migration Strategy). It does not
resolve `GD-20` Sub-decision 4 (Background Execution) or any Analytics/Attendance follow-up (Sub-decision 6).
