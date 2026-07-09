# ADR-009: Context-Artifact Token-Optimization Architecture (Platform v1.2)

- **Status:** Proposed — formal ratification (Proposed → Accepted) reserved to human authority (Engineering Constitution §20).
- **Date:** 2026-07-09
- **Scope:** Engineering operating system (`.claude/`) — framework 1.2.0.
- **Supersedes:** none (additive to ADR-002 AI Engineering Platform Adoption and ADR-007 Agent-Based Engineering Workflow).
- **Change class:** Constitutional (adds `constitution/CONTEXT_ARTIFACTS.md`, `LOOP_CONTROL.md` §7–§8, and gate G1.5). Requires the §20 process: this Decision Record, applicable reviews (done — see Validation), human approval (pending), versioned synchronization (`VERSION.yaml` → 1.2.0, done), and contradiction validation (done).

## Problem

The platform re-derived the same truth repeatedly: framework policy was re-read every activity; repository truth was re-discovered per workflow and per reviewer; correction cycles re-ran all reviewers; ownership conflicts surfaced only at G4 after a full author→five-reviewer cycle (evidenced by `SYNC_STATE.yaml` SYNC-001/005/010/011). This is architectural token waste, not prompt verbosity. Constitution §17 aspired to reuse ("cache only identified, revision-bound summaries") but no durable artifact enforced it.

## Decision

Introduce reusable, revision-bound **Context Artifacts** produced once per scope and consumed by reference, plus incremental correction/review and a pre-authoring ownership gate. Design invariant: **discover once, freeze to a revision, reuse by reference, invalidate by digest.**

Specifically:
1. Seven Context Artifacts (`constitution/CONTEXT_ARTIFACTS.md`): Boot Context, Evidence Package, Dependency Context, Context Package, Finding Package, Correction Package, Review Package — plus Module Memory.
2. Repository Session mode (`knowledge/SESSION_STATE.yaml`): revision-bound reuse across workflows.
3. Pre-authoring **Boundary Collision** gate **G1.5** (`workflows/boundary-collision.md`): stop ownership collisions before authoring.
4. Incremental Correction + Affected-Reviewer Determination (`LOOP_CONTROL.md` §7; `REVIEW_GATES.md` Incremental Re-review): only intersecting reviewers rerun.
5. Dependency-slice caching (`ART-DEPCTX`): reviewers consume slices, not the full graph.
6. Six canonical lookup indexes (Specification, Ownership, State-Ownership, Contract, API, Boundary) derived from `MODULE_REGISTRY` + `DEPENDENCY_GRAPH`.

## Alternatives Considered

- **Prompt shortening only** — rejected: does not remove repeated discovery; the waste is architectural.
- **One large rewrite** — rejected: violates incremental-delivery and reversibility; each phase must leave the platform functional.
- **Merge specialist reviewers to cut cost** — rejected: violates single-responsibility (Constitution §5) and review independence (§12).

## Compatibility

Strictly additive and fail-safe. Absent any cache, behavior equals framework 1.1.0 (`CONTEXT_ARTIFACTS.md` §1 invariant 5; `LOOP_CONTROL.md` §8). No gate (G0–G9) is removed or weakened; G1.5 is inserted between G1 and G2 with no renumbering. Finding schema, confidence thresholds, gate statuses, reviewer independence, loop bounds (≤3), and termination guarantees are unchanged.

## Migration

Phased (v1.2.0 Phases 1–7), each independently committed and functional. `VERSION.yaml` bumped to 1.2.0 atomically so the Boot Context framework-version cache key changes and forces re-derivation under the new constitution.

## Reversibility

Deleting the cache layer and the two new stages (G1.5, incremental re-review) returns the platform to 1.1.0 semantics with no data loss; caches are advisory and reconstructable.

## Validation (independent reviews of the v1.2 change set)

Architecture, dependency, consistency, security/governance, and performance reviews were run independently on the change set (see `.claude/PLATFORM_V1_2_VALIDATION.md`). Initial architecture verdict was FAIL on two contained defects — framework version not bumped, and this Decision Record missing — both resolved in the correction round (VERSION.yaml → 1.2.0; this ADR). All other reviewers returned PASS_WITH_ACTIONS; every action is applied or tracked. No open Critical/High remains except the standing human-authority items (ratification of this ADR; ownership assignment SYNC-001/005).

## Consequences

- **Positive:** removes repeated discovery/boot/graph reads and correction-cycle rework; ownership conflicts caught before authoring spend; O(1) index lookups replace full-registry/graph scans.
- **Negative / cost:** artifact production and index regeneration carry a write-side cost that is a net win only under reuse (multi-workflow session and/or ≥1 correction round and/or a later same-revision consumer); the realized token reduction is to be measured by the learning loop (`IMPROVEMENT_LOG.yaml`), not asserted as fact.

## Human Decision Required

Ratify (Proposed → Accepted) the constitutional additions (CONTEXT_ARTIFACTS, LOOP_CONTROL §7–§8, gate G1.5) per Constitution §20. Until ratified, these records document intended framework state and do not constitute immutable law.
