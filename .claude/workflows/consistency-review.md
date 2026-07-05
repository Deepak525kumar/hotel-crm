# Consistency Review Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently detect contradictions, duplicate authorities, terminology drift, and stale cross-references.
- **Metric:** Relevant artifacts agree or discrepancies are recorded as blocking findings/synchronization tasks; consistency component of G4 recorded.
- **Boundary:** One frozen candidate against canonical sources; the reviewer does not choose a winner without authority; at most three re-check cycles (§3).
- **Retry policy:** Restart affected comparisons after edits; full restart on canonical-source/terminology/scope change ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** One canonical source per concept and no unresolved material contradiction.
- **Failure condition:** Equal-authority conflict, no canonical term, or historical content presented as current → escalate to source owner/human.
- **Confidence threshold:** `High` for any blocking contradiction.

## Purpose

Independently detect contradictions, duplicate authorities, terminology drift, and stale cross-references.

## Entry Conditions

Frozen candidate and canonical terminology, active docs, rule sources, decisions, and indexes are available.

## Exit Conditions

Relevant artifacts agree or discrepancies are blocking findings/synchronization tasks; status is recorded.

## Participating Agents

Consistency Reviewer (owner); responsible authors; Lead Architect; human for semantic terminology decisions.

## Execution Order

1. Identify candidate terms, IDs, rules, states, examples, and references.
2. Select canonical comparison sources by authority.
3. Compare related active artifacts and label historical/proposed content.
4. Record contradictions, duplication, unresolved references, and stale dependents.
5. Author fixes or canonical decision is escalated.
6. Re-check synchronized set and issue recommendation.

## Parallel Activities

Terminology, cross-reference, and rule-duplication checks MAY run in parallel; conclusions merge only after authority classification.

## Validation Gates

Consistency component of G4 passes with one canonical source per concept and no unresolved material contradiction.

## Escalation Conditions

Equal-authority conflict, no canonical term, semantic rename, unexpected synchronization scope, or historical content presented as current.

## Artifacts Produced

Consistency Review, terminology delta, cross-reference report, synchronization inventory.

## Failure Handling

Do not choose a winner without authority. Block affected sections and route fixes to source owners.

## Restart Conditions

Restart affected comparisons after edits; restart full review after canonical source, terminology, or scope changes.
