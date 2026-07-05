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

## Execution Order

1. Collect gate reports, findings, escalations, and sync records for the terminal workflow.
2. Classify each observed signal into one of the six classes with evidence.
3. Match against existing `IMP-*` records; increment occurrence counts.
4. Open or update an improvement record for any qualifying signal.
5. Mark records crossing their recurrence threshold as `escalated` with a proposed change.
6. Leave policy, workflows, and gates unchanged; hand escalations to the human.

## Parallel Activities

Signal collection across independent terminal workflows MAY run in parallel; record reconciliation is serialized to keep occurrence counts deterministic.

## Validation Gates

This workflow gates nothing and grants no approval. It contributes only advisory records; a recorded improvement never blocks or bypasses G0–G9.

## Escalation Conditions

Any signal reaching its recurrence threshold, or a signal implying a constitutional/architecture change, is escalated per Constitution §18 and §20.

## Artifacts Produced

Improvement records (`IMP-*`) in `../knowledge/IMPROVEMENT_LOG.yaml`; escalation proposals for recurring signals.

## Failure Handling

If terminal evidence is missing, record a `BLOCKED` evaluation gap rather than fabricate a signal. Never convert a single occurrence into a requirement.

## Restart Conditions

Re-run when a new workflow reaches a terminal state or when an existing improvement record gains new occurrence evidence.
