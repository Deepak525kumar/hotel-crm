# Learning Workflow

## Loop Metadata

- **Loop type:** Learning ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Evaluate completed and stopped workflows for repeated signals and capture deterministic, reusable improvement records.
- **Metric:** Every terminal workflow is evaluated against the six signal classes and any qualifying signal produces an `IMP-*` record.
- **Boundary:** Read-only evaluation of existing evidence and records; it proposes improvements and never mutates policy, code, or gates.
- **Retry policy:** Re-evaluate on new terminal evidence; no correction sub-loop (§3).
- **Escalation policy:** A signal crossing its recurrence threshold is escalated as a framework or constitutional change proposal under Constitution §20/§22.
- **Termination:** Success or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** Signals evaluated and improvement records written or explicitly `none`.
- **Failure condition:** Evidence for a terminal workflow is missing → `BLOCKED`; record the gap rather than invent a signal.
- **Confidence threshold:** `Medium` to open a record; `High` recurrence evidence to escalate a proposal.

## Purpose

Convert recurring engineering friction into human-reviewable improvement records without introducing adaptive or self-modifying behavior. Learning proposes; humans and the constitutional-change process dispose.

## Entry Conditions

A workflow reached a terminal state (`COMPLETE`, `FAILED`, or intentionally stopped) and its gate reports, findings, escalations, and synchronization records are identifiable. Post-flight invokes this workflow.

## Exit Conditions

Each observed signal is classified, counted against prior records, and either recorded in `../knowledge/IMPROVEMENT_LOG.yaml` or dismissed with a reason; recurring signals above threshold carry an escalation proposal.

## Participating Agents

Lead Architect (owner and recorder); source owners consulted for signal accuracy; human for accepting any resulting framework/constitutional change. No specialist authors policy from this loop.

## Signal Classes

Evaluate each terminal workflow for:

1. Repeated failures (same gate/check failing across runs).
2. Repeated escalations (same authority gap recurring).
3. Repeated reviewer findings (same `Finding ID` pattern or category).
4. Repeated architectural violations.
5. Repeated synchronization failures.
6. Repeated documentation drift.

## Execution Graph

```
Lead Architect (invoked by postflight on terminal state)
  ↓ terminal workflow gate reports + findings + escalations + sync records + prior IMPROVEMENT_LOG entries
Lead Architect — collect evidence for the terminal workflow
  ↓ ART-IMP-000 (evidence bundle, revision-bound; read-only)
  ├─ (parallel across signal classes 1..6) classify each observed signal with evidence
  │      (independent evaluation per class; source owners consulted for signal accuracy where needed)
       ↓ SYNC-learn-1 (all six signal-class evaluations complete)
Lead Architect — match against existing IMP-* records; increment occurrence counts (serialized to keep counts deterministic)
  ↓ ART-IMP-001 (updated or newly opened IMP-* records) or "no signals" record
Lead Architect — mark records crossing recurrence threshold as `escalated` with proposed change
  ↓ ART-IMP-002 (escalation proposals, if any)
Lead Architect — hand escalations to human under Constitution §20/§22; leave policy/workflows/gates unchanged
```

## Execution Order

1. Collect gate reports, findings, escalations, and sync records for the terminal workflow.
2. Classify each observed signal into one of the six classes with evidence.
3. Match against existing `IMP-*` records; increment occurrence counts.
4. Open or update an improvement record for any qualifying signal.
5. Mark records crossing their recurrence threshold as `escalated` with a proposed change.
6. Leave policy, workflows, and gates unchanged; hand escalations to the human.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Terminal workflow's gate reports; findings register; escalation records; synchronization records; `../knowledge/IMPROVEMENT_LOG.yaml`; canonical policy pointers (no policy mutation).
- **Outputs:** `ART-IMP-000` evidence bundle; `ART-IMP-001` opened/updated `IMP-*` records in `IMPROVEMENT_LOG.yaml`; `ART-IMP-002` escalation proposals for records crossing recurrence threshold.
- **Next Consumer:** Human (for accepting any framework/constitutional change under Constitution §20/§22); postflight (terminal state).

### Source owners (consulted only for signal accuracy)

- **Inputs:** The specific signal question and its evidence.
- **Outputs:** Confirmation or correction of signal accuracy (not policy).
- **Next Consumer:** Lead Architect.

### Human (accepting a proposal)

- **Inputs:** `ART-IMP-002` escalation proposal + supporting evidence.
- **Outputs:** Accept / defer / reject decision under Constitution §20 / §22.
- **Next Consumer:** Documentation workflow (for any accepted constitutional/framework change).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-IMP-000` | Lead Architect | terminal workflow evidence (read-only) | revision-bound evidence bundle | Signal-class classifiers (Lead Architect, one per class) |
| `ART-IMP-001` | Lead Architect | classified signals + existing `IMP-*` records | opened/updated `IMP-*` records in `IMPROVEMENT_LOG.yaml` | Recurrence-threshold check |
| `ART-IMP-002` | Lead Architect | `IMP-*` records crossing threshold | escalation proposals under Constitution §20/§22 | Human (accept/defer/reject) |

## Synchronization Points

- **SYNC-learn-1:** Lead Architect waits until all six signal-class evaluations return before matching against existing `IMP-*` records. Record reconciliation is serialized to keep occurrence counts deterministic (parallel writes to `IMPROVEMENT_LOG.yaml` are forbidden).

## Context Packages

### Lead Architect receives

- The terminal workflow's identifiers and evidence citations only (gate reports, findings, escalations, sync records).
- Current `../knowledge/IMPROVEMENT_LOG.yaml`.
- Canonical policy pointers (Constitution §20/§22); no policy content for mutation.

### Source owners receive (consulted step)

- Single signal question + its evidence; nothing else.

### Human receives (accepting a proposal)

- `ART-IMP-002` proposal + supporting evidence; explicit reference to Constitution §20/§22.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: learning`
- `Current Gate: none` (this workflow gates nothing).
- `Current Agent: Lead Architect`.
- `Completed`: closed `ART-IMP-*` IDs.
- `Waiting On`: SYNC-learn-1; consulted source-owner confirmation; human decision on an escalated proposal.
- `Blockers`: missing terminal-workflow evidence (`BLOCKED`; record the gap rather than invent a signal).
- `Next Action`: signal reconciliation, threshold check, or escalation to human.

## Parallel Activities

Signal collection across independent terminal workflows MAY run in parallel; record reconciliation is serialized to keep occurrence counts deterministic.

## Validation Gates

This workflow gates nothing and grants no approval. It contributes only advisory records; a recorded improvement never blocks or bypasses G0–G9.

### Required Inputs → Produced Outputs

- **Advisory only** inputs: `ART-IMP-000` evidence bundle bound to the terminal workflow revision.
- **Advisory only** outputs: `ART-IMP-001` improvement records; `ART-IMP-002` escalation proposals when a threshold is crossed. Neither output authorizes a workflow transition.

## Escalation Conditions

Any signal reaching its recurrence threshold, or a signal implying a constitutional/architecture change, is escalated per Constitution §18 and §20.

## Artifacts Produced

Improvement records (`IMP-*`) in `../knowledge/IMPROVEMENT_LOG.yaml`; escalation proposals for recurring signals.

## Failure Handling

If terminal evidence is missing, record a `BLOCKED` evaluation gap rather than fabricate a signal. Never convert a single occurrence into a requirement.

## Restart Conditions

Re-run when a new workflow reaches a terminal state or when an existing improvement record gains new occurrence evidence.
