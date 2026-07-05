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

## Execution Order

1. Confirm immutable input and applicable decisions.
2. Map affected boundaries, state, interfaces, and quality constraints.
3. Execute architecture checklist.
4. Record independent findings.
5. Author resolves accepted findings.
6. Re-review changed/affected criteria.
7. Issue final recommendation.

## Parallel Activities

May run alongside dependency, consistency, security, and performance reviews against the same candidate; initial conclusions remain independent.

## Validation Gates

Architecture component of G4 passes with no unresolved critical/high finding and no undocumented required decision.

## Escalation Conditions

Conflicting ADRs, new architecture choice, ownership ambiguity, constitutional implication, or disputed high severity.

## Artifacts Produced

Architecture Review, checklist record, finding/disposition log, Decision Record request where needed.

## Failure Handling

Return findings to author; do not edit the artifact. Semantic fixes create a new candidate version and impact-based re-review.

## Restart Conditions

Restart full review after scope/boundary/decision changes; otherwise restart affected checklist sections.
