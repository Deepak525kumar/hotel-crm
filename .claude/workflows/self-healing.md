# Self-healing Workflow

## Purpose

Detect and repair repository, documentation, foundation, or dependency drift without inventing intent.

## Entry Conditions

A deterministic check or agent reports drift against a known approved source.

## Exit Conditions

Drift is repaired and validated, or isolated and escalated with no false completion claim.

## Participating Agents

Lead Architect (owner); source owner; applicable reviewer/validator/implementer; human when truth or authority is unresolved.

## Execution Order

1. Pause affected workflow path and preserve state/evidence.
2. Reproduce drift and classify repository, documentation, foundation, dependency, generated, or environmental.
3. Resolve authoritative current and target states.
4. Determine minimal repair set and risk; request approval for semantic/destructive/external changes.
5. Apply repair through normal specialist workflow.
6. Run targeted review, regression, and validation.
7. Update knowledge/sync records and invalidate stale context.
8. Rerun pre-flight and restart from last stable gate.

## Parallel Activities

Root-cause evidence collection MAY parallel when read-only. Repairs parallel only for independent artifacts after target state freezes.

## Validation Gates

Repair must pass every gate the original change would require. Self-healing never bypasses freeze, review, testing, or human authority.

## Escalation Conditions

Truth cannot be resolved, repair changes product/architecture/constitution, destructive action, external mutation, repeated recurrence, or scope exceeds task.

## Artifacts Produced

Drift Report, root-cause analysis, repair plan/diff, regression evidence, synchronization update, restart record.

## Failure Handling

Keep affected path blocked, preserve diagnostic evidence, and provide safe containment plus decision request. Never loop repairs without a changed hypothesis.

## Restart Conditions

At most one repair attempt per unchanged hypothesis. A failed attempt requires new evidence/hypothesis or human decision before retry.
