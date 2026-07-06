# Self-healing Workflow

## Loop Metadata

- **Loop type:** Refinement ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Detect and repair repository, documentation, foundation, or dependency drift without inventing intent.
- **Metric:** Drift is repaired and validated, or isolated and escalated with no false completion claim.
- **Boundary:** At most one repair attempt per unchanged hypothesis (§3); a failed attempt requires new evidence or a human decision before retry.
- **Retry policy:** Never loop repairs without a changed hypothesis ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** Repair passes every gate the original change would require and restarts from the last stable gate.
- **Failure condition:** Truth cannot be resolved, repair changes product/architecture/constitution, or recurrence repeats → keep path blocked and escalate.
- **Confidence threshold:** `High`.

## Purpose

Detect and repair repository, documentation, foundation, or dependency drift without inventing intent.

## Entry Conditions

A deterministic check or agent reports drift against a known approved source.

## Exit Conditions

Drift is repaired and validated, or isolated and escalated with no false completion claim.

## Participating Agents

Lead Architect (owner); source owner; applicable reviewer/validator/implementer; human when truth or authority is unresolved.

## Execution Graph

```
Lead Architect (entry from drift signal)
  ↓ pause affected workflow path; preserve state/evidence
Lead Architect — reproduce drift; classify (repository / documentation / foundation / dependency / generated / environmental)
  ↓ ART-DRIFT-001 (Drift Report + classification)
  ├─ (parallel, read-only) root-cause evidence collection
  └─ (parallel, read-only) authoritative current/target state resolution
       ↓ SYNC-heal-1 (evidence + target state converge)
Lead Architect — determine minimal repair set + risk
  ↓ ART-DRIFT-002 (root-cause analysis + repair plan)
Human (only for semantic/destructive/external changes) — approve
  ↓ approval record
Applicable specialist workflow — apply repair through normal channels
  ↓ ART-DRIFT-003 (repair diff via specialist workflow, not this one)
Applicable reviewers/validators — targeted review/regression/validation
  ↓ ART-DRIFT-004 (regression evidence + validation results)
Lead Architect — update knowledge/sync records; invalidate stale context; rerun preflight; restart from last stable gate
  ↓ ART-DRIFT-005 (synchronization update + restart record)
```

## Execution Order

1. Pause affected workflow path and preserve state/evidence.
2. Reproduce drift and classify repository, documentation, foundation, dependency, generated, or environmental.
3. Resolve authoritative current and target states.
4. Determine minimal repair set and risk; request approval for semantic/destructive/external changes.
5. Apply repair through normal specialist workflow.
6. Run targeted review, regression, and validation.
7. Update knowledge/sync records and invalidate stale context.
8. Rerun pre-flight and restart from last stable gate.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Drift signal (from deterministic check, review, validation, or preflight/postflight); `SYNC_STATE.yaml`; capability registry; the paused workflow's last stable gate.
- **Outputs:** `ART-DRIFT-001` Drift Report + classification; `ART-DRIFT-002` root-cause analysis + minimal repair plan; `ART-DRIFT-005` synchronization update + restart record.
- **Next Consumer:** Human approver (semantic/destructive/external changes); applicable specialist workflow; applicable reviewers/validators; paused workflow on restart.

### Source owner

- **Inputs:** `ART-DRIFT-002` slice for the artifact they own.
- **Outputs:** Confirmed authoritative current/target state.
- **Next Consumer:** Lead Architect (repair plan).

### Human approver (semantic/destructive/external changes only)

- **Inputs:** `ART-DRIFT-002`; risk classification; safe default while waiting.
- **Outputs:** Approval or refusal record; Decision Record where required.
- **Next Consumer:** Applicable specialist workflow.

### Applicable specialist workflow (delegated repair)

- **Inputs:** Approved `ART-DRIFT-002`; standard workflow context per that workflow's Context Packages section.
- **Outputs:** `ART-DRIFT-003` repair diff produced through the normal specialist workflow's own artifacts.
- **Next Consumer:** Applicable reviewers/validators.

### Applicable reviewers/validators

- **Inputs:** `ART-DRIFT-003`; original-change gate requirements.
- **Outputs:** `ART-DRIFT-004` regression evidence + validation results per canonical schema.
- **Next Consumer:** Lead Architect (sync update).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-DRIFT-001` | Lead Architect | drift signal + reproduction | Drift Report + classification | Root-cause + target-state resolvers |
| `ART-DRIFT-002` | Lead Architect | reproduced drift + root cause + target state | root-cause analysis + minimal repair plan + risk | Human approver (if semantic/destructive/external); specialist workflow |
| `ART-DRIFT-003` | Applicable specialist workflow | `ART-DRIFT-002` (approved) | repair diff via that workflow's own artifacts | Applicable reviewers/validators |
| `ART-DRIFT-004` | Applicable reviewers/validators | `ART-DRIFT-003` + original-change gate requirements | regression evidence + validation results | Lead Architect |
| `ART-DRIFT-005` | Lead Architect | all above + `SYNC_STATE.yaml` | synchronization update + restart record | Paused workflow (rerun full pre-flight) |

## Synchronization Points

- **SYNC-heal-1:** Lead Architect waits until (a) root-cause evidence collection and (b) authoritative current/target state resolution both complete before defining the minimal repair set. Both branches are read-only; repairs never start before this join closes.
- Retry-cycle safeguard: a second repair attempt against the same hypothesis is forbidden (see Loop Metadata). New evidence or human decision must precede any retry.

## Context Packages

### Lead Architect receives

- Drift signal (path/artifact/finding IDs); reproduction commands; `SYNC_STATE.yaml`; the paused workflow's last stable gate; capability registry slice for the required specialist.

### Source owner receives

- Only their artifact and its authoritative comparison source; no unrelated drift scope.

### Human approver receives (semantic/destructive/external step)

- `ART-DRIFT-001` + `ART-DRIFT-002`; risk classification; the safe default while waiting.

### Applicable specialist workflow receives

- Approved `ART-DRIFT-002` scope; the specialist workflow's standard Context Packages section for the changed artifact.

### Applicable reviewers/validators receive

- `ART-DRIFT-003` + the original-change gate requirements they must reproduce.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: self-healing`
- `Current Gate: original-change-gates` (the gates the repair must pass).
- `Current Agent: Lead Architect` (or the active specialist / reviewer / human approver).
- `Completed`: closed `ART-DRIFT-*` IDs.
- `Waiting On`: SYNC-heal-1; human approval; specialist workflow completion; regression/validation.
- `Blockers`: truth cannot be resolved; repair changes product/architecture/constitution; recurrence.
- `Next Action`: source-owner invocation, specialist dispatch, validation, or paused-workflow restart.

## Parallel Activities

Root-cause evidence collection MAY parallel when read-only. Repairs parallel only for independent artifacts after target state freezes.

## Validation Gates

Repair must pass every gate the original change would require. Self-healing never bypasses freeze, review, testing, or human authority.

### Required Inputs → Produced Outputs

- **original-change-gates** inputs: `ART-DRIFT-003` repair diff + `ART-DRIFT-004` regression/validation evidence.
- **original-change-gates** outputs: reproduced original-change gate statuses; `ART-DRIFT-005` synchronization update + restart record.

## Escalation Conditions

Truth cannot be resolved, repair changes product/architecture/constitution, destructive action, external mutation, repeated recurrence, or scope exceeds task.

## Artifacts Produced

Drift Report, root-cause analysis, repair plan/diff, regression evidence, synchronization update, restart record.

## Failure Handling

Keep affected path blocked, preserve diagnostic evidence, and provide safe containment plus decision request. Never loop repairs without a changed hypothesis.

## Restart Conditions

At most one repair attempt per unchanged hypothesis. A failed attempt requires new evidence/hypothesis or human decision before retry.
