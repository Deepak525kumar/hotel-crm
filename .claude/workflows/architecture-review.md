# Architecture Review Workflow

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
