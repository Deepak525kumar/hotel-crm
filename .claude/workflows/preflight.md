# Pre-flight Workflow

## Loop Metadata

- **Loop type:** Pipeline ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Establish a safe, current, correctly scoped execution baseline before any work.
- **Metric:** Gate G0 passes all five checks (repository sync, foundation drift, dependency drift, scope, context packaging).
- **Boundary:** One objective at one revision; discovered drift pauses to the applicable synchronization workflow rather than looping here.
- **Retry policy:** Re-run full pre-flight on any input change (§3); drift routes to self-healing.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** G0 `PASS` with revision-bound, minimal context manifests.
- **Failure condition:** Any check `FAIL`/`BLOCKED` → do not begin task work.
- **Confidence threshold:** `High`.

## Purpose

Establish a safe, current, correctly scoped execution baseline before any engineering work.

## Entry Conditions

A human objective exists; repository access is available; no task artifact has begun.

## Exit Conditions

Repository is synchronized or limitations are explicit; foundation and dependency drift are cleared; scope is validated; each specialist context package is revision-bound and minimal; G0 is `PASS`.

## Participating Agents

Lead Architect (owner); Requirements Analyst for scope ambiguity; Dependency Reviewer for nontrivial edge drift; human for authority decisions.

## Execution Order

1. Run [Repository Synchronization](repository-synchronization.md).
2. Resolve objective against repository truth and classify intended change.
3. Compare architecture, terminology, business rules, shared templates, constitution, and ownership with synchronization state.
4. Compare interfaces, events, contracts, ownership edges, packages, and consumers with dependency graph.
5. If drift exists, pause and run the applicable synchronization workflow.
6. Validate inclusions, exclusions, affected modules, risk, and applicable gates.
7. Build a context manifest per participating specialist.
8. Record G0 result.

## Parallel Activities

Foundation and dependency drift inspection MAY run in parallel after repository state is frozen. Scope confirmation and context packaging MUST wait for both.

## Validation Gates

G0 requires all five checks: repository synchronization, foundation drift, dependency drift, scope validation, and context packaging.

## Escalation Conditions

Dirty worktree ownership is unknown; remote/default branch cannot be established and affects decisions; source conflict; missing owner; objective requires product/architecture judgment; destructive action.

## Artifacts Produced

Pre-flight Record, evidence ledger, scope statement, affected-module list, drift reports, context manifests, workflow/gate plan.

## Failure Handling

Do not begin task work. Preserve the worktree. Mark exact check `FAIL` or `BLOCKED`; route drift to self-healing and authority gaps to the human.

## Restart Conditions

Re-run the full pre-flight whenever repository revision, objective, frozen input, architecture, ownership, or dependency state changes.
