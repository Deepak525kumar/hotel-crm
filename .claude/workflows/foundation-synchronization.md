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

## Execution Graph

```
Lead Architect (entry from preflight/postflight drift signal)
  ↓ pause affected workflows at last passed gate
Lead Architect — classify delta; establish authoritative desired state
  ↓ ART-SYNC-FND-001 (Foundation Drift Report + delta class)
Lead Architect — inventory affected specs, decisions, templates, terms, owners, code, tests, prompts, knowledge records
  ↓ ART-SYNC-FND-002 (impact inventory)
Human (only for semantic/policy changes) — approve delta
  ↓ approval record
Applicable source owner — update canonical source first
  ↓ ART-SYNC-FND-003 (updated canonical artifact)
  ├─ (parallel, dependency-ordered, non-overlapping write sets) dependent artifact updates
  │      (specs by Module Author, terms by source owner, rules by BR Validator + owner, etc.)
       ↓ SYNC-fnd-1 (all dependent updates complete)
  ├─ (parallel where applicable) Consistency Reviewer → ART-CONS-REV-001
  ├─ (parallel where applicable) Architecture Reviewer → ART-ARCH-REV-001
  ├─ (parallel where applicable) Business Rule Validator → ART-RULE-001
  └─ (parallel where applicable) Documentation Validator → ART-VAL-DOC-001
       ↓ SYNC-fnd-2 (independent reviews / validation converge)
Lead Architect — update SYNC_STATE.yaml; invalidate stale context packages
  ↓ ART-SYNC-FND-004 (sync-state update + restart record)
Lead Architect — restart paused workflows from last stable gate (rerun full preflight)
```

## Execution Order

1. Pause affected workflows and freeze their last passed gates.
2. Classify delta and establish authoritative desired state.
3. Inventory affected specs, decisions, templates, terms, owners, code, tests, prompts, and knowledge records.
4. Obtain approval when the delta changes meaning or policy.
5. Update canonical source first.
6. Synchronize dependents in dependency order.
7. Run applicable independent reviews and validation.
8. Update synchronization state, invalidate stale context, and restart paused workflows.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Foundation drift signal from preflight/postflight; `../knowledge/SYNC_STATE.yaml`; capability registry; affected workflow set.
- **Outputs:** `ART-SYNC-FND-001` Foundation Drift Report + delta classification; `ART-SYNC-FND-002` impact inventory; `ART-SYNC-FND-004` sync-state update + restart record.
- **Next Consumer:** Human approver (for semantic/policy delta); applicable source owner; downstream reviewers; paused workflows on restart.

### Human approver (semantic/policy delta only)

- **Inputs:** `ART-SYNC-FND-001` + `ART-SYNC-FND-002`.
- **Outputs:** Approval record for the canonical decision; Decision Record where required.
- **Next Consumer:** Applicable source owner.

### Applicable source owner

- **Inputs:** Approved canonical decision; `ART-SYNC-FND-002` impact inventory slice for their source.
- **Outputs:** `ART-SYNC-FND-003` updated canonical artifact.
- **Next Consumer:** Dependent-artifact owners; downstream reviewers.

### Dependent-artifact owners (parallel, dependency-ordered)

- **Inputs:** `ART-SYNC-FND-003`; the specific dependent artifact slice they own.
- **Outputs:** Updated dependent artifacts with revision-bound citations to the new canonical source.
- **Next Consumer:** Consistency/Architecture/Rule/Documentation reviewers as applicable.

### Reviewers and validators (applicability per REVIEW_GATES.md)

- **Inputs:** Updated canonical source and updated dependents at their reviewed versions.
- **Outputs:** Review/validation reports per canonical schema, bound to the reviewed versions.
- **Next Consumer:** Lead Architect (join at SYNC-fnd-2).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-SYNC-FND-001` | Lead Architect | drift signal + SYNC_STATE + affected workflow set | Foundation Drift Report + delta class | Human approver; source owner |
| `ART-SYNC-FND-002` | Lead Architect | delta class + registries + decisions | impact inventory | Source owner; dependent owners; reviewers |
| `ART-SYNC-FND-003` | Applicable source owner | approved canonical decision + inventory slice | updated canonical artifact | Dependent owners; reviewers |
| Updated dependents | Dependent owners | `ART-SYNC-FND-003` + inventory slice | updated dependent artifacts | Reviewers (SYNC-fnd-1) |
| `ART-CONS-REV-001` / `ART-ARCH-REV-001` / `ART-RULE-001` / `ART-VAL-DOC-001` | Applicable reviewers/validators | updated canonical + dependents | review/validation reports | Lead Architect (SYNC-fnd-2) |
| `ART-SYNC-FND-004` | Lead Architect | all above | sync-state update + restart record | Paused workflows (restart from last stable gate) |

## Synchronization Points

- **SYNC-fnd-1:** Independent dependent-artifact updates MAY run in parallel only after `ART-SYNC-FND-003` (the canonical source) freezes and write sets do not overlap. This join closes when every dependent required by `ART-SYNC-FND-002` has produced its updated artifact.
- **SYNC-fnd-2:** Lead Architect waits until all applicable independent reviews and validations return status against the same updated canonical + dependents set before recording synchronization state.

## Context Packages

### Lead Architect receives

- Drift signal (path/artifact/finding IDs); current `SYNC_STATE.yaml`; capability registry; explicit list of paused workflows and their last passed gate.

### Human approver receives (semantic/policy delta only)

- `ART-SYNC-FND-001` + `ART-SYNC-FND-002` + relevant decision context; no in-flight review findings.

### Source owner receives

- Approved canonical decision; only the inventory slice for their source; explicit exclusion of unrelated foundation content.

### Dependent-artifact owners receive

- Updated `ART-SYNC-FND-003` slice they must synchronize; the impact-inventory row for their artifact; no other owners' work.

### Reviewers/Validators receive

- Their standard per-workflow context package (see each review workflow), bound to the updated canonical and updated dependents.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: foundation-synchronization`
- `Current Gate: synchronization-pass`
- `Current Agent: Lead Architect` (or the active source owner / reviewer / validator).
- `Completed`: closed `ART-SYNC-FND-*` IDs and dependent updates.
- `Waiting On`: SYNC-fnd-1; SYNC-fnd-2; human approval; specific dependent update.
- `Blockers`: no canonical source; ownership conflict; scope beyond authority.
- `Next Action`: source-owner invocation, reviewer dispatch, sync-state update, or paused-workflow restart.

## Parallel Activities

Independent dependent artifacts MAY update in parallel after the canonical source freezes and write sets do not overlap.

## Validation Gates

Synchronization passes only when no active dependent remains stale and all semantic changes have required approval.

### Required Inputs → Produced Outputs

- **synchronization-pass** inputs: `ART-SYNC-FND-003`; all updated dependents; all applicable review/validation reports; human approval where a semantic/policy change occurred.
- **synchronization-pass** outputs: `ART-SYNC-FND-004` sync-state update + restart record; paused workflows authorized to rerun full pre-flight.

## Escalation Conditions

No canonical source, constitutional/architecture/product judgment, incompatible active specs, ownership conflict, or synchronization scope exceeds authority.

## Artifacts Produced

Foundation Drift Report, impact inventory, Decision Record where needed, synchronized artifacts, Validation Report, sync-state update.

## Failure Handling

Keep affected workflows paused. Revert only task-owned partial sync when authorized or continue from last consistent checkpoint.

## Restart Conditions

Restart impact analysis if canonical decision changes; otherwise resume at first failed dependent. Paused workflows rerun full pre-flight.
