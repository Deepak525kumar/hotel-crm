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

Affected modules and dependents are reconciled; documentation and knowledge match the final state; the Specification Issues Register (`../governance/SPECIFICATION_ISSUES_REGISTER.md`) reflects the terminal state's unresolved and resolved issues; follow-ups have owners; G9 is recorded.

## Participating Agents

Lead Architect (owner); Consistency Reviewer; Dependency Reviewer; responsible author/implementer; Release Manager when release artifacts changed.

## Execution Graph

```
Lead Architect (entry on terminal state of parent workflow)
  ↓ terminal candidate + findings + release records (if applicable)
Lead Architect — inventory changed files, artifacts, requirements, decisions, contracts, findings
  ↓ ART-POST-001 (final impact inventory)
Lead Architect — determine affected modules and upstream/downstream consumers from DEPENDENCY_GRAPH
  ↓ ART-POST-002 (affected module/consumer map)
  ├─ (parallel) documentation/cross-reference reconciliation
  │      (Lead Architect + responsible authors; updates active docs; marks superseded/historical)
  └─ (parallel) graph/registry reconciliation
         (Lead Architect + Dependency Reviewer; updates contracts, edges, ownership; refreshes DEPENDENCY_GRAPH, MODULE_REGISTRY, cross-references, TERMINOLOGY, DECISION_INDEX)
       ↓ SYNC-post-1 (both reconciliation branches complete)
Consistency Reviewer (final) — verify no orphaned artifact, contradiction, or unresolved cross-reference
  ↓ ART-POST-003 (post-flight consistency confirmation)
Lead Architect — create synchronization tasks for deferred non-blocking work; confirm no temporary bypass, unresolved blocking finding, or orphaned artifact
  ↓ ART-POST-004 (residual-risk/follow-up list)
Lead Architect — synchronize the Specification Issues Register (../governance/SPECIFICATION_ISSUES_REGISTER.md): append newly-discovered unresolved issues, mark issues verified-resolved as RESOLVED (history preserved, never deleted), merge by canonical source ID
  ↓ ART-POST-004a (register synchronization confirmation)
Lead Architect — record knowledge deltas + revision-bound sync state; record G9 and terminal workflow state
  ↓ ART-POST-005 (Post-flight Record with G9 status)
Learning workflow invocation (per Loop Metadata hook)
```

## Execution Order

1. Inventory changed files, artifacts, requirements, decisions, contracts, and findings.
2. Determine affected modules and upstream/downstream consumers from the graph.
3. Update or verify contracts, dependency edges, module ownership, cross-references, terminology, and decision index.
4. Update active documentation and mark superseded/historical material.
5. Record knowledge/index changes and revision-bound synchronization state.
6. Create future synchronization tasks for intentionally deferred non-blocking work.
7. Confirm no temporary bypass, unresolved blocking finding, or orphaned artifact remains.
8. Synchronize the Specification Issues Register (`../governance/SPECIFICATION_ISSUES_REGISTER.md`): collect unresolved issues remaining after final delivery, append genuinely new ones, mark resolved ones `RESOLVED` without deleting history, and merge by canonical source ID so no issue is duplicated.
9. Record G9 and terminal workflow state.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Terminal candidate revision; findings register; release records (if release ran); `MODULE_REGISTRY.yaml`; `DEPENDENCY_GRAPH.yaml`; `TERMINOLOGY.md`; `DECISION_INDEX.md`; `SYNC_STATE.yaml`.
- **Outputs:** `ART-POST-001` final impact inventory; `ART-POST-002` affected module/consumer map; `ART-POST-004` residual-risk/follow-up list; `ART-POST-005` Post-flight Record with G9 status.
- **Next Consumer:** Consistency Reviewer; Dependency Reviewer; responsible authors; Release Manager (for release artifacts); learning workflow.

### Responsible authors/implementers

- **Inputs:** Their slice of `ART-POST-002` (active docs, superseded material).
- **Outputs:** Updated documentation; superseded/historical labels.
- **Next Consumer:** SYNC-post-1; Consistency Reviewer.

### Dependency Reviewer

- **Inputs:** Their slice of `ART-POST-002` (graph/registry deltas).
- **Outputs:** Updated `DEPENDENCY_GRAPH.yaml` and `MODULE_REGISTRY.yaml` entries; cross-reference updates.
- **Next Consumer:** SYNC-post-1; Consistency Reviewer.

### Consistency Reviewer (final)

- **Inputs:** Reconciled active docs + updated graph/registry + terminology + decision index.
- **Outputs:** `ART-POST-003` post-flight consistency confirmation.
- **Next Consumer:** Lead Architect.

### Release Manager (only when release artifacts changed)

- **Inputs:** `ART-RELEASE-*` inventory delta.
- **Outputs:** Reconciled release inventory reference in `ART-POST-001`.
- **Next Consumer:** Lead Architect.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-POST-001` | Lead Architect | terminal candidate + findings + release records | final impact inventory | Lead Architect (module mapping); responsible authors |
| `ART-POST-002` | Lead Architect | `ART-POST-001` + `DEPENDENCY_GRAPH.yaml` | affected module/consumer map | Documentation/cross-reference reconciliation; graph/registry reconciliation |
| Updated docs + updated graph/registry | Responsible authors + Dependency Reviewer | `ART-POST-002` slice | reconciled active docs + updated graph/registry | Consistency Reviewer (SYNC-post-1) |
| `ART-POST-003` | Consistency Reviewer | reconciled docs + graph/registry + terminology | post-flight consistency confirmation | Lead Architect |
| `ART-POST-004` | Lead Architect | `ART-POST-003` + deferred non-blocking items | residual-risk/follow-up list with owners and due gates | Future workflows; escalation where required |
| `ART-POST-004a` | Lead Architect | `ART-POST-004` + prior register state | Specification Issues Register synchronization (append/resolve/merge) | `ART-POST-005`; future documentation/postflight sessions |
| `ART-POST-005` | Lead Architect | all above + G9 evaluation | Post-flight Record with G9 status + knowledge/sync-state deltas | Learning workflow; parent workflow's terminal state |

## Synchronization Points

- **SYNC-post-1:** Consistency Reviewer waits until (a) documentation/cross-reference reconciliation and (b) graph/registry reconciliation both complete before running the final consistency check. Lead Architect MUST NOT record G9 until Consistency Reviewer returns `ART-POST-003`.

## Context Packages

### Lead Architect receives

- Terminal candidate revision; findings register; release records (if applicable); relevant `SYNC_STATE.yaml` entries; capability registry slice for follow-up ownership.

### Responsible authors/implementers receive

- Their slice of `ART-POST-002` only — active docs to update, superseded material to mark; no unrelated post-flight scope.

### Dependency Reviewer receives

- Their slice of `ART-POST-002` — graph/registry edges to update, contract deltas; no documentation-narrative scope.

### Consistency Reviewer receives

- Reconciled active docs, updated graph/registry, `TERMINOLOGY.md`, `DECISION_INDEX.md` — bound to the terminal candidate revision.

### Release Manager receives (only when release artifacts changed)

- `ART-RELEASE-*` inventory delta only.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: postflight`
- `Current Gate: G9`
- `Current Agent: Lead Architect` (or the active reconciler / final Consistency Reviewer).
- `Completed`: closed `ART-POST-*` IDs.
- `Waiting On`: SYNC-post-1; specific reconciler completion; final consistency confirmation.
- `Blockers`: undocumented scope; ownership conflict; breaking dependent; unresolved foundation drift.
- `Next Action`: reconciler dispatch, consistency confirmation, G9 recording, or learning-workflow invocation.

## Parallel Activities

Documentation/cross-reference reconciliation and graph/registry reconciliation MAY run in parallel from the same final change inventory; final consistency review waits for both.

## Validation Gates

G9 passes only when all affected artifacts are current or a permitted non-blocking action has owner, reason, and due gate.

### Required Inputs → Produced Outputs

- **G9** inputs: `ART-POST-001..004`; `ART-POST-004a` register synchronization; `ART-POST-003` consistency confirmation; owned follow-up entries for any deferred work.
- **G9** outputs: `ART-POST-005` Post-flight Record; knowledge/sync-state deltas committed; Specification Issues Register synchronized; parent workflow's terminal state recorded; learning workflow invoked.

## Escalation Conditions

Change reveals undocumented scope, ownership conflict, breaking dependent, unresolved foundation drift, or follow-up needed before merge/release.

## Artifacts Produced

Post-flight Record, final impact inventory, knowledge deltas, synchronization tasks, residual-risk/follow-up list, Specification Issues Register synchronization.

## Failure Handling

Do not mark the parent workflow complete. Reopen the responsible synchronization or documentation step and preserve final candidate revision.

## Restart Conditions

Restart from impact inventory after any final-state change or finding correction.
