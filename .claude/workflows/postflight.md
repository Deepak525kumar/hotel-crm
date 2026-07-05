# Post-flight Workflow

## Loop Metadata

- **Loop type:** Synchronization ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Restore repository-wide consistency after completed, failed, or intentionally stopped work.
- **Metric:** Gate G9 passes; all affected artifacts are current or carry an owned, due follow-up.
- **Boundary:** One final change inventory; re-run from the inventory on any final-state change or finding correction.
- **Retry policy:** Reopen the responsible synchronization/documentation step on failure ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3); do not mark the parent complete meanwhile.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** G9 `PASS` with no temporary bypass, unresolved blocking finding, or orphaned artifact.
- **Failure condition:** Undocumented scope, ownership conflict, breaking dependent, or unresolved foundation drift → reopen sync and escalate.
- **Confidence threshold:** `High`.
- **Learning hook:** On terminal state, invoke the [learning workflow](learning.md) to record repeated signals in `../knowledge/IMPROVEMENT_LOG.yaml`.

## Purpose

Restore repository-wide consistency after completed, failed, or intentionally stopped work.

## Entry Conditions

The active workflow reached a terminal candidate state and its changes/findings are identifiable.

## Exit Conditions

Affected modules and dependents are reconciled; documentation and knowledge match the final state; follow-ups have owners; G9 is recorded.

## Participating Agents

Lead Architect (owner); Consistency Reviewer; Dependency Reviewer; responsible author/implementer; Release Manager when release artifacts changed.

## Execution Order

1. Inventory changed files, artifacts, requirements, decisions, contracts, and findings.
2. Determine affected modules and upstream/downstream consumers from the graph.
3. Update or verify contracts, dependency edges, module ownership, cross-references, terminology, and decision index.
4. Update active documentation and mark superseded/historical material.
5. Record knowledge/index changes and revision-bound synchronization state.
6. Create future synchronization tasks for intentionally deferred non-blocking work.
7. Confirm no temporary bypass, unresolved blocking finding, or orphaned artifact remains.
8. Record G9 and terminal workflow state.

## Parallel Activities

Documentation/cross-reference reconciliation and graph/registry reconciliation MAY run in parallel from the same final change inventory; final consistency review waits for both.

## Validation Gates

G9 passes only when all affected artifacts are current or a permitted non-blocking action has owner, reason, and due gate.

## Escalation Conditions

Change reveals undocumented scope, ownership conflict, breaking dependent, unresolved foundation drift, or follow-up needed before merge/release.

## Artifacts Produced

Post-flight Record, final impact inventory, knowledge deltas, synchronization tasks, residual-risk/follow-up list.

## Failure Handling

Do not mark the parent workflow complete. Reopen the responsible synchronization or documentation step and preserve final candidate revision.

## Restart Conditions

Restart from impact inventory after any final-state change or finding correction.
