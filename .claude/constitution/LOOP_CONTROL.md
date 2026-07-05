# Loop Control and Termination

**Status:** Canonical governing policy for iteration and termination

**Change class:** Constitutional; human approval required (see [Engineering Constitution](ENGINEERING_CONSTITUTION.md) §20)

**Applies to:** Every workflow, review, validation, synchronization, and self-healing activity

## Purpose

Every engineering activity in this platform is a loop: it acts, checks, and either advances or corrects. This document is the single canonical definition of how those loops iterate, when they must stop, and how confidence is reported. Workflows, agents, and registries reference this policy; they do not restate it.

Unbounded correction is a defect. A loop that cannot terminate deterministically is not workflow-driven; it is drift.

## 1. Loop Types

Every workflow is classified as exactly one loop type. The type determines its default termination and retry semantics.

| Type | Intent | Advances when |
|---|---|---|
| Pipeline | Convert an approved input into the next approved artifact through ordered stages | Every stage gate is `PASS`/`PASS_WITH_ACTIONS` |
| Validation | Independently prove an immutable candidate satisfies criteria | Every mandatory dimension has evidence and no blocking status |
| Critic | Independently find defects in a frozen candidate without editing it | All applicable criteria evaluated; findings returned with evidence |
| Refinement | Apply corrections to an authored artifact in response to findings | Findings resolved and re-checked, or escalated |
| Synchronization | Reconcile a canonical source with its dependents | No active dependent remains stale |
| Discovery | Build a revision-bound view of current truth | All required facts captured or explicitly `unknown` |
| Learning | Evaluate completed work for repeated signals and record reusable improvements | Signals evaluated and improvement records written |

No workflow may remain unclassified. A new workflow selects the narrowest applicable type.

## 2. Required Loop Metadata

Every workflow MUST declare, in its own file and in [`../knowledge/LOOP_REGISTRY.yaml`](../knowledge/LOOP_REGISTRY.yaml), these fields. Shared values reference this document rather than copying it.

| Field | Definition |
|---|---|
| Objective | The single outcome the loop exists to produce |
| Metric | The observable signal that proves the objective is met |
| Boundary | Explicit scope and the maximum iterations before mandatory escalation |
| Retry Policy | When and how a corrective iteration may repeat (§3) |
| Escalation Policy | Who is notified and with what payload when the boundary or a blocking condition is hit (Constitution §18) |
| Termination Condition | The exhaustive set of states in which the loop stops (§4) |
| Success Condition | The termination state that satisfies the objective |
| Failure Condition | The termination state that does not satisfy the objective and requires escalation or return |
| Confidence Threshold | The minimum confidence at which the metric may be treated as met (§5) |

## 3. Retry Policy

- A corrective iteration is permitted only against a **changed hypothesis**: new evidence, a new candidate version, or a resolved unknown. Repeating an identical attempt is forbidden.
- **Default correction bound:** at most **three** correction iterations per loop instance before mandatory escalation, unless a workflow declares a narrower bound.
- **Self-healing bound:** at most **one** repair attempt per unchanged hypothesis (see [self-healing](../workflows/self-healing.md)); a failed repair requires new evidence or a human decision.
- Any semantic change to a frozen candidate increments its version and invalidates dependent review/validation evidence for the changed area only.
- Boundary exhaustion is a `FAIL`/`BLOCKED` termination, never a silent `PASS`.

## 4. Termination Guarantee

Every loop terminates in exactly one of:

- **Success** — success condition met at or above the confidence threshold.
- **Failure** — a blocking finding or failed mandatory check; returns to the responsible owner.
- **Blocked** — required evidence, authority, environment, or decision is unavailable; escalates.
- **Boundary exhausted** — retry bound reached without success; escalates as `FAIL`/`BLOCKED`.

`Unknown` is never a terminal success. A loop MUST NOT advance a dependent while in any non-success terminal state.

## 5. Confidence Reporting

Confidence is a deterministic, three-level scale used by every reviewer, validator, and loop.

| Level | Meaning |
|---|---|
| High | Claim is directly supported by reproducible repository evidence; no material unknown. |
| Medium | Claim is supported by indirect or partial evidence; a stated unknown does not change the disposition. |
| Low | Claim rests on inference; a stated unknown could change the disposition. |

- A gate criterion may be treated as met only when its supporting finding reports confidence **at or above the workflow's declared Confidence Threshold** (default: `High` for merge/release gates, `Medium` for intermediate gates).
- A `Low`-confidence blocking finding is treated as unresolved and either escalates or drives another bounded correction iteration.
- Confidence never substitutes for severity: a `High`-confidence critical finding still fails the gate.

## 6. Relationship to Existing Policy

This document extends, and never overrides, the [Engineering Constitution](ENGINEERING_CONSTITUTION.md), [Review Gates](REVIEW_GATES.md), and [Source of Truth](SOURCE_OF_TRUTH.md). Where a gate status, severity, or source-authority rule already exists, this document references it and adds only iteration and termination semantics.
