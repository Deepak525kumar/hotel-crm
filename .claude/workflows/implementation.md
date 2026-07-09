# Implementation Workflow

## Loop Metadata

- **Loop type:** Pipeline ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Plan and implement a frozen specification with bounded scope, traceability, and independent verification.
- **Metric:** Gate G3 then G5 pass (plan mapped and reviewed; diff mapped, clean checks, no unapproved deviation, migration/rollback evidence).
- **Boundary:** Frozen-spec scope only; a failed check restarts the affected work item, at most three iterations per item before escalation (§3).
- **Retry policy:** Default bounded correction per [LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3; spec/contract change reruns pre-flight and re-plans invalidated items.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** G5 `PASS` with complete plan mapping and no unapproved deviation.
- **Failure condition:** Spec ambiguity or unplanned contract/architecture/dependency change → return to the originating gate; never patch the spec through code.
- **Confidence threshold:** `High`.

## Purpose

Plan and implement a frozen specification with bounded scope, traceability, safe sequencing, and independent verification.

## Entry Conditions

G0 and G2 pass; **G1.5 Boundary Collision passes** for the change footprint ([boundary-collision](boundary-collision.md)) — planning does not begin while an ownership/boundary collision is open (for a change entering from a frozen spec, G1.5 is confirmed against the spec's ownership footprint); exact frozen spec, review dispositions, affected ownership, and dependencies are known.

## Exit Conditions

All plan items are implemented or explicitly excluded; implementation checks pass; evidence is ready for testing/validation; G5 passes.

## Participating Agents

Implementation Planner (plan owner); applicable Backend, Frontend, Mobile, and Infrastructure Engineers; QA consulted for testability; Lead Architect coordinates.

## Execution Graph

```
Lead Architect (context handoff)
  ↓ ART-SPEC-001 (FROZEN) + review dispositions + affected ownership
Implementation Planner — inspect conventions; map every criterion to work
  ↓ ART-PLAN-001 (Implementation Plan + execution DAG + risks + migration/rollback + validation)
G3 evaluation — Implementation Planner presents; Lead Architect records
  ↓
Lead Architect — build minimal context packages per implementer
  ↓ ART-PLAN-002 (per-engineer context manifests)
  ├─ (parallel where DAG permits) Backend Engineer      → ART-IMPL-BE-001
  ├─ (parallel where DAG permits) Frontend Engineer     → ART-IMPL-FE-001
  ├─ (parallel where DAG permits) Mobile Engineer       → ART-IMPL-MO-001
  └─ (parallel where DAG permits) Infrastructure Engr.  → ART-IMPL-IN-001
       ↓ SYNC-impl-1 (contract boundary integration; planned migrations resolved)
Each engineer — component-level checks; map diff to plan/spec
  ↓ ART-IMPL-*-002 (implementation reports)
Lead Architect — record deviations; consolidate evidence
  ↓ ART-IMPL-000 (aggregated implementation evidence + deviation log)
G5 evaluation — Lead Architect
  ↓
Downstream: testing workflow (QA Engineer)
```

## Execution Order

1. Inspect repository conventions and map all criteria to work.
2. Produce implementation plan, execution DAG, risks, migrations, validation, and rollback.
3. Review plan and record G3.
4. Create minimal context packages per implementer.
5. Implement in dependency order; use isolated parallel branches only where safe.
6. Integrate contract boundaries and resolve planned migrations.
7. Run component-level checks and map diff to plan/spec.
8. Record deviations and G5.

## Agent I/O Contracts

### Implementation Planner

- **Inputs:** Frozen `ART-SPEC-001`; `ART-*-REV-001` dispositions; repository conventions; `MODULE_REGISTRY.yaml`; `DEPENDENCY_GRAPH.yaml`; applicable run commands.
- **Outputs:** `ART-PLAN-001` Implementation Plan (requirement-to-work matrix, execution DAG, risk/rollback, validation).
- **Next Consumer:** G3 evaluation; Lead Architect (context packaging); implementers.

### Backend Engineer

- **Inputs:** Assigned plan item(s) from `ART-PLAN-001`; `ART-PLAN-002` backend context manifest; frozen `ART-SPEC-001`; findings to resolve.
- **Outputs:** `ART-IMPL-BE-001` backend diff + tests + migrations; `ART-IMPL-BE-002` implementation report with mapped criteria and command results; deviations/blockers.
- **Next Consumer:** SYNC-impl-1 integration; QA Engineer; Lead Architect (deviation log).

### Frontend Engineer

- **Inputs:** Assigned plan item(s); `ART-PLAN-002` frontend context manifest; frozen `ART-SPEC-001`; API contracts.
- **Outputs:** `ART-IMPL-FE-001` frontend diff + tests; `ART-IMPL-FE-002` implementation report + visual/interaction evidence; deviations.
- **Next Consumer:** SYNC-impl-1; QA Engineer; Lead Architect.

### Mobile Engineer

- **Inputs:** Assigned plan item(s); `ART-PLAN-002` mobile context manifest; frozen `ART-SPEC-001`; API contracts; platform constraints.
- **Outputs:** `ART-IMPL-MO-001` mobile diff + tests; `ART-IMPL-MO-002` implementation report + device/platform evidence; deviations.
- **Next Consumer:** SYNC-impl-1; QA Engineer; Lead Architect.

### Infrastructure Engineer

- **Inputs:** Assigned plan item(s); `ART-PLAN-002` infrastructure context manifest; environment matrix; approved commands.
- **Outputs:** `ART-IMPL-IN-001` IaC/CI/observability diff; `ART-IMPL-IN-002` implementation report + validation logs + runbook/rollback updates.
- **Next Consumer:** SYNC-impl-1; QA Engineer; Release Manager; Lead Architect.

### Lead Architect

- **Inputs:** `ART-PLAN-001`; all `ART-IMPL-*-002` reports; deviations.
- **Outputs:** G3 record; `ART-IMPL-000` aggregated evidence; G5 record.
- **Next Consumer:** Testing workflow (QA Engineer).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-PLAN-001` | Implementation Planner | frozen `ART-SPEC-001` + review dispositions | plan + DAG + risks + validation + rollback | G3; Lead Architect; implementers |
| `ART-PLAN-002` | Lead Architect | `ART-PLAN-001` + agent contracts | per-engineer context manifest | Each implementer |
| `ART-IMPL-<surface>-001` | Backend/Frontend/Mobile/Infrastructure Engineer | `ART-PLAN-002` + frozen spec | scoped diff + tests + migrations | SYNC-impl-1; QA Engineer |
| `ART-IMPL-<surface>-002` | Same engineer | scoped diff + mapped criteria + commands run | implementation report | Lead Architect (deviations); QA Engineer |
| `ART-IMPL-000` | Lead Architect | all `ART-IMPL-*-002` | aggregated evidence + deviation log | G5; testing workflow |

## Synchronization Points

- **SYNC-impl-1:** Contract-integration barrier. Each engineer completes their contract-side changes before consumers of that contract may run their integration checks. Owner: Implementation Planner (per DAG); Lead Architect records the join.
- Parallel implementers MUST NOT write to the same file or share unreviewed intermediate output; where a shared boundary exists, the producer's contract-frozen fixture is consumed instead of the producer's in-flight diff.

## Context Packages

### Implementation Planner receives

- Frozen `ART-SPEC-001` and its acceptance-criteria matrix.
- `ART-*-REV-001` dispositions (only the accepted-resolution notes).
- Repository slices of `MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`, and observed conventions for the affected surfaces.
- Applicable commands from `PROJECT_PROFILE.md`.

### Each engineer receives

- The specific work items assigned to that surface (not the full plan).
- Frozen `ART-SPEC-001` slice for the criteria they must satisfy.
- Direct contract fixtures and API/schema references only.
- Explicit test/build commands and rollback conditions.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: implementation`
- `Current Gate: G3` (plan review) or `G5` (implementation verification).
- `Current Agent: Implementation Planner`, or the active engineer.
- `Completed`: closed `ART-PLAN-*`, `ART-IMPL-*` IDs.
- `Waiting On`: SYNC-impl-1; contract fixture; specific `ART-IMPL-*-001` finish.
- `Blockers`: spec ambiguity; unplanned contract change; failing check after retry bound.
- `Next Action`: next engineer invocation, SYNC-impl-1, or G5 evaluation.

## Parallel Activities

Independent surfaces MAY run in parallel only after contracts freeze and no shared file/state is written. Contract producers precede dependent consumers unless compatible fixtures are approved.

## Validation Gates

G3 before code changes; G5 requires complete plan mapping, clean relevant checks, no unapproved deviation, and migration/rollback evidence.

### Required Inputs → Produced Outputs

- **G3** inputs: `ART-PLAN-001`, review dispositions, repository conventions, execution DAG.
- **G3** outputs: G3 gate record; authorization to invoke implementers.
- **G5** inputs: all `ART-IMPL-*-002` reports; `ART-IMPL-000` aggregated evidence; deviation log.
- **G5** outputs: G5 gate record; testable candidate handed to QA Engineer.

## Escalation Conditions

Spec ambiguity, unplanned contract/architecture/dependency change, destructive migration, security issue, new material dependency, or unrelated worktree collision.

## Artifacts Produced

Implementation Plan, context manifests, code/config/test changes, migration/rollback evidence, implementation reports, deviation log.

## Failure Handling

Stop affected branch, preserve evidence, revert only task-owned changes when authorized, and return ambiguity to the originating gate. Never patch the spec through code.

## Restart Conditions

After failed checks, restart affected work item. After spec/contract/foundation changes, rerun pre-flight and re-plan all invalidated items.
