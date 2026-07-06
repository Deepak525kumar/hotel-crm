# Architecture Review Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently assess a frozen design for architecture conformity and boundary integrity before implementation.
- **Metric:** All applicable architecture-checklist criteria evaluated; architecture component of G4 recorded.
- **Boundary:** One immutable candidate version; the reviewer does not edit; a semantic fix creates a new version and impact-based re-review, at most three cycles (§3).
- **Retry policy:** Re-review changed/affected criteria only per [LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** No unresolved critical/high finding and no undocumented required decision; recommendation bound to the reviewed version.
- **Failure condition:** Conflicting ADRs, ownership ambiguity, or disputed high severity → escalate.
- **Confidence threshold:** `High` for any blocking finding.

## Purpose

Independently assess a frozen design before implementation for architecture conformity and boundary integrity.

## Entry Conditions

Review input version is frozen; architecture decisions, registry, graph, and applicability are available; reviewer did not author input.

## Exit Conditions

All checklist criteria are evaluated; findings are resolved or block progress; architecture review status is recorded.

## Participating Agents

Architecture Reviewer (owner); author for fixes; Lead Architect for context/triage; human for architecture decisions.

## Execution Graph

```
Lead Architect (dispatch)
  ↓ immutable ART-SPEC-001 v0.n + ADRs + MODULE_REGISTRY + DEPENDENCY_GRAPH
Architecture Reviewer — confirm immutable input; map boundaries, state, interfaces, quality constraints
  ↓
Architecture Reviewer — execute architecture checklist (independent of other reviewers)
  ↓ ART-ARCH-REV-001 v0.n (findings per REVIEWER_FINDINGS.md, gate recommendation bound to reviewed version)
Author (Module Author or document owner) — resolve accepted findings; produce new candidate version
  ↓ ART-SPEC-001 v0.n+1
Architecture Reviewer — re-review changed/affected criteria only
  ↓ (repeat; retry bound: 3 review→fix cycles)
Lead Architect — record architecture component of G4
```

## Execution Order

1. Confirm immutable input and applicable decisions.
2. Map affected boundaries, state, interfaces, and quality constraints.
3. Execute architecture checklist.
4. Record independent findings.
5. Author resolves accepted findings.
6. Re-review changed/affected criteria.
7. Issue final recommendation.

## Agent I/O Contracts

### Architecture Reviewer

- **Inputs:** Immutable `ART-SPEC-001` v0.n; applicable ADRs; `MODULE_REGISTRY.yaml`; `DEPENDENCY_GRAPH.yaml`; architecture checklist.
- **Outputs:** `ART-ARCH-REV-001` review report — checklist evidence + findings (canonical schema) + `PASS`/`PASS_WITH_ACTIONS`/`FAIL`/`BLOCKED` bound to the exact reviewed version + Decision Record request where architectural authority is missing.
- **Next Consumer:** Lead Architect (merge into G4); Module Author (correction).

### Author (Module Author or document owner)

- **Inputs:** `ART-ARCH-REV-001` findings requiring correction; disposition guidance.
- **Outputs:** Revised `ART-SPEC-001` v0.n+1 with dispositions recorded; delta list of changed sections.
- **Next Consumer:** Architecture Reviewer (impact-based re-review).

### Lead Architect

- **Inputs:** `ART-ARCH-REV-001` reports across cycles; other applicable review reports (for G4 merge, not for this reviewer's judgment).
- **Outputs:** Architecture component of G4 (recorded on the documentation or plan workflow that dispatched this review).
- **Next Consumer:** Consolidated G4 record; documentation freeze or implementation-plan progression.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-ARCH-REV-001` (v0.n) | Architecture Reviewer | immutable `ART-SPEC-001` v0.n + ADRs + registries | independent findings + gate recommendation bound to version | Lead Architect (G4 merge); Module Author (fixes) |
| `ART-SPEC-001` (v0.n+1) | Module Author | `ART-ARCH-REV-001` findings | revised candidate + dispositions | Architecture Reviewer (impact-based re-review) |
| G4-architecture record | Lead Architect | final `ART-ARCH-REV-001` at last reviewed version | architecture component of G4 | Documentation or implementation workflow |

## Synchronization Points

- This workflow's join happens at the parent workflow's finding-merge point (`SYNC-doc-1` for documentation-scoped reviews or the equivalent join in the dispatching workflow). Architecture Reviewer submits `ART-ARCH-REV-001` independently and does not wait for other reviewers.
- Retry-cycle re-review starts only after the author produces `ART-SPEC-001` v0.n+1; the reviewer does not re-review while the author is still editing.

## Context Packages

### Architecture Reviewer receives

- Immutable `ART-SPEC-001` v0.n only (never a moving target).
- Applicable ADRs and Decision Record index (`../knowledge/DECISION_INDEX.md`).
- `MODULE_REGISTRY.yaml` slice for affected modules and their neighbors.
- `DEPENDENCY_GRAPH.yaml` slice for boundary-crossing edges.
- Architecture checklist.
- Explicit exclusion of other reviewers' in-flight findings and of author fix proposals.

### Author receives (correction step)

- Only the accepted `ART-ARCH-REV-001` findings with recommended direction; the reviewer's evidence citations; permission to increment version.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: architecture-review`
- `Current Gate: G4-architecture`
- `Current Agent: Architecture Reviewer` (or Module Author during correction).
- `Completed`: closed `ART-ARCH-REV-001` versions at each reviewed candidate.
- `Waiting On`: revised candidate; impact-based re-review; G4 merge in parent workflow.
- `Blockers`: conflicting ADRs; ownership ambiguity; disputed high severity.
- `Next Action`: next re-review, escalation, or G4 record.

## Parallel Activities

May run alongside dependency, consistency, security, and performance reviews against the same candidate; initial conclusions remain independent.

## Validation Gates

Architecture component of G4 passes with no unresolved critical/high finding and no undocumented required decision.

### Required Inputs → Produced Outputs

- **G4-architecture** inputs: final `ART-ARCH-REV-001` bound to the last reviewed `ART-SPEC-001` version; author dispositions; Decision Record where required.
- **G4-architecture** outputs: architecture-component `PASS`/`PASS_WITH_ACTIONS`/`FAIL`/`BLOCKED`; findings register merged into the parent workflow's G4 record.

## Escalation Conditions

Conflicting ADRs, new architecture choice, ownership ambiguity, constitutional implication, or disputed high severity.

## Artifacts Produced

Architecture Review, checklist record, finding/disposition log, Decision Record request where needed.

## Failure Handling

Return findings to author; do not edit the artifact. Semantic fixes create a new candidate version and impact-based re-review.

## Restart Conditions

Restart full review after scope/boundary/decision changes; otherwise restart affected checklist sections.
