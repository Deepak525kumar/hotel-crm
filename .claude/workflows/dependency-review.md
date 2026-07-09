# Dependency Review Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently identify dependency, contract, package, and synchronization consequences before approval.
- **Metric:** Every affected edge and package classified; dependency component of G4 recorded.
- **Boundary:** One frozen artifact/diff; the reviewer does not edit; contract/package/ownership change restarts edge analysis, at most three cycles (§3).
- **Retry policy:** Re-run package evidence on version/lockfile change; re-review corrections per [LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** No unknown consumer, no unplanned breaking edge, complete synchronization actions.
- **Failure condition:** Breaking change without authority, unknown owner/consumer, cycle, or unavailable migration path → escalate or invoke dependency synchronization.
- **Confidence threshold:** `High` for any blocking finding.

## Purpose

Independently identify dependency, contract, package, and synchronization consequences before approval.

## Entry Conditions

Frozen artifact/diff and the capability's **Dependency Context** slice (`ART-DEPCTX-<capability>`, an immutable reusable graph slice, [CONTEXT_ARTIFACTS.md](../constitution/CONTEXT_ARTIFACTS.md) §2.3) are available; reviewer did not author input. The reviewer consumes the slice rather than traversing the full `DEPENDENCY_GRAPH`, and inspects the repository only to verify a finding or to verify/confirm the slice on a cache miss (the Lead Architect is the single writer of ART-DEPCTX).

## Exit Conditions

Every affected edge and package is classified, consumers are known, migration/rollout is viable, and graph delta is ready.

## Participating Agents

Dependency Reviewer (owner); author/implementer for fixes; Security Reviewer for external packages; Lead Architect.

## Execution Graph

```
Lead Architect (dispatch)
  ↓ immutable ART-SPEC-001 v0.n (or diff/plan) + ART-DEPCTX-<capability> slice (reused if valid for baseline_revision) + manifests/lockfiles
Dependency Reviewer — capture declared and observed baseline (from the slice; the slice is verified here, not rediscovered by consumers)
  ↓
  ├─ (parallel) internal edge tracing — added/removed/changed contracts/events/schemas/ownership
  └─ (parallel) external package fitness (with Security Reviewer for security)
       ↓ SYNC-dep-1 (both branches complete)
Dependency Reviewer — classify compatibility (COMPATIBLE / CONDITIONAL / BREAKING / UNKNOWN); define rollout order
  ↓ ART-DEP-REV-001 v0.n (findings + edge/compatibility matrix + graph delta + synchronization plan)
Author/implementer — resolve accepted findings; produce new candidate version
  ↓ ART-SPEC-001 v0.n+1 (or updated diff)
Dependency Reviewer — re-review corrections (impact-based)
  ↓ (repeat; retry bound: 3 cycles)
Lead Architect — record dependency component of G4; invoke dependency-synchronization if graph diverges
```

## Execution Order

1. Capture declared and observed dependency baseline.
2. Identify added/removed/changed interfaces, events, contracts, ownership, schemas, and packages.
3. Trace direct/transitive consumers and classify compatibility.
4. Review external dependency fitness where applicable.
5. Define synchronization and rollout order.
6. Record findings and proposed graph delta.
7. Re-review corrections and issue recommendation.

## Agent I/O Contracts

### Dependency Reviewer

- **Inputs:** Immutable `ART-SPEC-001` v0.n (or frozen diff/`ART-PLAN-001`); `DEPENDENCY_GRAPH.yaml`; manifests/lockfiles; `MODULE_REGISTRY.yaml`; contract sources.
- **Outputs:** `ART-DEP-REV-001` — edge/compatibility matrix, package assessment, proposed graph delta, synchronization plan, findings per canonical schema, gate recommendation bound to the reviewed version.
- **Next Consumer:** Lead Architect (G4 merge; dependency-synchronization invocation); author/implementer (correction); Security Reviewer for external-package security concerns.

### Security Reviewer (consulted for external packages, applicability per REVIEW_GATES.md)

- **Inputs:** External package identity/version, source; provenance evidence; policy/checklist.
- **Outputs:** Security assessment note referenced by `ART-DEP-REV-001` (recorded as a finding in `ART-SEC-REV-001` if scoped there).
- **Next Consumer:** Dependency Reviewer; Lead Architect.

### Author / Implementer (correction step)

- **Inputs:** `ART-DEP-REV-001` findings requiring correction.
- **Outputs:** Revised candidate version (`ART-SPEC-001` v0.n+1 or updated `ART-IMPL-*` diff) with dispositions.
- **Next Consumer:** Dependency Reviewer (impact-based re-review).

### Lead Architect

- **Inputs:** Final `ART-DEP-REV-001`.
- **Outputs:** Dependency component of G4; dependency-synchronization invocation on graph divergence.
- **Next Consumer:** Parent workflow's G4 record; dependency-synchronization workflow.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-DEP-REV-001` (v0.n) | Dependency Reviewer | immutable candidate + dependency graph + manifests | edge/compatibility matrix + graph delta + synchronization plan + findings | Lead Architect (G4); author (fixes); dependency-synchronization on divergence |
| Revised candidate | Author / Implementer | `ART-DEP-REV-001` findings | new version + dispositions | Dependency Reviewer (re-review) |
| G4-dependency record | Lead Architect | final `ART-DEP-REV-001` | dependency component of G4 | Parent workflow's G4 record |

## Synchronization Points

- **SYNC-dep-1:** Dependency Reviewer waits until (a) internal edge tracing and (b) external package fitness (with Security Reviewer input where applicable) both complete before classifying compatibility and defining rollout order.
- Parent-workflow join: `SYNC-doc-1` (when reviewing a specification) or the equivalent join in the dispatching workflow. Reviewer submits `ART-DEP-REV-001` independently and does not wait for other reviewers.

## Context Packages

### Dependency Reviewer receives

- Immutable candidate (spec, diff, or plan) at the exact version to review.
- `DEPENDENCY_GRAPH.yaml` slice for the changed producers/consumers and their transitive edges.
- Manifests/lockfiles for the affected packages.
- Contract test suites for the affected interfaces/events.
- Migration/version policy where applicable.
- Explicit exclusion of other reviewers' in-flight findings.

### Security Reviewer receives (consulted step)

- Only the external package identity/version, provenance evidence, and relevant policy — never the candidate spec in full.

### Author / Implementer receives (correction step)

- Only accepted `ART-DEP-REV-001` findings and the recommended direction; explicit migration/rollout constraints from the synchronization plan.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: dependency-review`
- `Current Gate: G4-dependency`
- `Current Agent: Dependency Reviewer` (or author during correction).
- `Completed`: closed `ART-DEP-REV-001` versions.
- `Waiting On`: SYNC-dep-1; external package assessment; author correction.
- `Blockers`: breaking change without authority; unknown consumer/owner; cycle; unsafe package; license/security issue.
- `Next Action`: re-review, dependency-synchronization invocation, or G4 record.

## Parallel Activities

Package fitness and internal edge tracing MAY run in parallel; final compatibility/rollout waits for both. May parallel other independent reviews.

## Validation Gates

Dependency component of G4 passes only with no unknown consumer, no unplanned breaking edge, and complete synchronization actions.

### Required Inputs → Produced Outputs

- **G4-dependency** inputs: final `ART-DEP-REV-001` with edge/compatibility matrix and synchronization plan bound to the reviewed candidate version.
- **G4-dependency** outputs: dependency-component gate status; graph delta merged into parent workflow's G4 record; dependency-synchronization workflow invoked when repository/graph diverge.

## Escalation Conditions

Breaking change without authority, unknown owner/consumer, cycle, unsafe package, license/security issue, or unavailable migration path.

## Artifacts Produced

Dependency Review, edge/compatibility matrix, package assessment, graph delta, synchronization plan.

## Failure Handling

Block affected approval; return to author or invoke dependency synchronization when approved truth and records diverge.

## Restart Conditions

Restart edge analysis after any contract/package/ownership change; re-run package evidence when version/lockfile changes.
