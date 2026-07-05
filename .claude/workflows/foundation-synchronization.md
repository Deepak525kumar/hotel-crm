# Foundation Synchronization Workflow

## Loop Metadata

- **Loop type:** Synchronization ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Repair drift caused by changes to architecture, terminology, business rules, shared templates, constitution, or ownership.
- **Metric:** Canonical foundation source and every affected active dependent agree; synchronization state is current.
- **Boundary:** One canonical delta; at most one repair attempt per unchanged hypothesis (§3); resume at the first failed dependent.
- **Retry policy:** Self-healing bound per [LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3; restart impact analysis only if the canonical decision changes.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** Source and dependents agree; all semantic changes have required approval; paused workflows can restart.
- **Failure condition:** No canonical source, ownership conflict, or scope beyond authority → escalate; affected workflows stay paused.
- **Confidence threshold:** `High`.

## Purpose

Repair drift caused by changes to architecture, terminology, business rules, shared templates, constitution, or ownership.

## Entry Conditions

Pre-flight or post-flight identifies a foundation delta against an approved source.

## Exit Conditions

Canonical foundation source and every affected active dependent agree; synchronization state is current; original workflow can restart.

## Participating Agents

Lead Architect (owner); applicable source owner; Consistency Reviewer; Architecture Reviewer; Business Rule Validator; Documentation Validator; human for semantic/constitutional decisions.

## Execution Order

1. Pause affected workflows and freeze their last passed gates.
2. Classify delta and establish authoritative desired state.
3. Inventory affected specs, decisions, templates, terms, owners, code, tests, prompts, and knowledge records.
4. Obtain approval when the delta changes meaning or policy.
5. Update canonical source first.
6. Synchronize dependents in dependency order.
7. Run applicable independent reviews and validation.
8. Update synchronization state, invalidate stale context, and restart paused workflows.

## Parallel Activities

Independent dependent artifacts MAY update in parallel after the canonical source freezes and write sets do not overlap.

## Validation Gates

Synchronization passes only when no active dependent remains stale and all semantic changes have required approval.

## Escalation Conditions

No canonical source, constitutional/architecture/product judgment, incompatible active specs, ownership conflict, or synchronization scope exceeds authority.

## Artifacts Produced

Foundation Drift Report, impact inventory, Decision Record where needed, synchronized artifacts, Validation Report, sync-state update.

## Failure Handling

Keep affected workflows paused. Revert only task-owned partial sync when authorized or continue from last consistent checkpoint.

## Restart Conditions

Restart impact analysis if canonical decision changes; otherwise resume at first failed dependent. Paused workflows rerun full pre-flight.
