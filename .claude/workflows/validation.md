# Validation Workflow

## Loop Metadata

- **Loop type:** Validation ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently prove that documentation and implementation satisfy approved requirements and system laws before progress.
- **Metric:** Gate G6 passes across all mandatory dimensions.
- **Boundary:** One immutable candidate; a candidate change invalidates affected dimensions and re-validates only those.
- **Retry policy:** Re-validate failed dimensions after fixes (§3); on a Correction Package (`ART-CORR-001`), re-validate **only** the dimensions tied to the changed sections and carry unaffected-dimension evidence forward by reference ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §7); full re-validation on revision-identity or frozen-requirement change.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** G6 `PASS` with no open blocker.
- **Failure condition:** Conflicting validator results, unverifiable evidence, or constitutional failure → escalate.
- **Confidence threshold:** `High` for merge readiness.

## Purpose

Independently prove that documentation and implementation satisfy approved requirements and system laws before progress.

## Entry Conditions

Candidate is immutable for validation; author/implementation verification and applicable reviews/testing are complete.

## Exit Conditions

Each mandatory dimension has evidence and status; no open blocker remains; G6 recommendation is recorded.

## Participating Agents

Documentation Validator and Architecture Validator in their respective domains; QA Engineer for behavior evidence; Lead Architect consolidates without changing judgments.

## Execution Graph

```
Lead Architect (context handoff)
  ↓ ART-SPEC-001 (FROZEN) + ART-IMPL-000 + ART-TEST-005 + all ART-*-REV-001 + approval records
Lead Architect — confirm candidate revision immutable; assemble evidence completeness
  ↓ ART-VAL-000 (validation input manifest, revision-bound)
  ├─ (parallel) Documentation Validator — documentation dimensions
  │      ↓ ART-VAL-DOC-001 (requirements coverage, terminology, template, constitution)
  ├─ (parallel) Architecture Validator — implementation conformance
  │      ↓ ART-VAL-ARCH-001 (ownership, boundaries, dependency direction, ADR resolution)
  └─ (parallel) QA Engineer — reproduce applicable behavior/tests/build/static checks
         ↓ ART-VAL-BEH-001 (behavior evidence)
              ↓ SYNC-val-1
Lead Architect — consolidate statuses; identify residual limitations (no judgment change)
  ↓ ART-VAL-001 (Validation Report)
G6 evaluation — Lead Architect
```

## Execution Order

1. Confirm candidate revision/version and evidence completeness.
2. Validate requirements and acceptance-criteria coverage.
3. Validate business-rule authority and absence of unsupported assumptions/duplication.
4. Validate ownership, dependency graph, contract, and synchronization correctness.
5. Validate architecture, terminology, documentation, and constitutional compliance.
6. Reproduce applicable tests/build/static checks.
7. Consolidate statuses and unresolved limitations.
8. Record G6.

## Agent I/O Contracts

### Documentation Validator

- **Inputs:** Frozen `ART-SPEC-001`; templates/checklists; source ledger; `ART-*-REV-001` reports and dispositions; approval record.
- **Outputs:** `ART-VAL-DOC-001` documentation-dimension results (per criterion `PASS`/`FAIL`/`BLOCKED`/`N/A`).
- **Next Consumer:** Lead Architect (consolidation); responsible author on failure.

### Architecture Validator

- **Inputs:** `ART-IMPL-000` implementation candidate revision; frozen `ART-SPEC-001` + `ART-PLAN-001`; `ART-ARCH-REV-001`; ADRs; `MODULE_REGISTRY.yaml`; `DEPENDENCY_GRAPH.yaml`.
- **Outputs:** `ART-VAL-ARCH-001` architecture-conformance results + drift findings.
- **Next Consumer:** Lead Architect; implementing owner on drift.

### QA Engineer

- **Inputs:** Candidate revision; `ART-TEST-005`; reproduction commands.
- **Outputs:** `ART-VAL-BEH-001` reproduced behavior evidence (independent replay).
- **Next Consumer:** Lead Architect.

### Lead Architect

- **Inputs:** `ART-VAL-DOC-001`, `ART-VAL-ARCH-001`, `ART-VAL-BEH-001`.
- **Outputs:** `ART-VAL-001` consolidated Validation Report + criterion matrix + residual-limitation list + G6 record.
- **Next Consumer:** Merge readiness (G7) or return to owner on failure.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-VAL-000` | Lead Architect | frozen spec + implementation + tests + reviews + approvals | validation input manifest bound to revision | Validators (all three dimensions) |
| `ART-VAL-DOC-001` | Documentation Validator | `ART-VAL-000` documentation slice | documentation-dimension result | SYNC-val-1; Lead Architect |
| `ART-VAL-ARCH-001` | Architecture Validator | `ART-VAL-000` architecture slice | architecture-conformance result | SYNC-val-1; Lead Architect |
| `ART-VAL-BEH-001` | QA Engineer | `ART-VAL-000` behavior slice | reproduced behavior evidence | SYNC-val-1; Lead Architect |
| `ART-VAL-001` | Lead Architect | all `ART-VAL-*-001` | consolidated Validation Report + G6 record | G7 (merge readiness); owners on failure |

## Synchronization Points

- **SYNC-val-1:** Lead Architect waits until all three dimensions (`ART-VAL-DOC-001`, `ART-VAL-ARCH-001`, `ART-VAL-BEH-001`) have returned status against the same immutable candidate identified in `ART-VAL-000` before consolidating. Lead Architect MUST NOT change validator judgments during consolidation.

## Context Packages

### Documentation Validator receives

- Frozen `ART-SPEC-001` and its citations; the specific templates/checklists that apply; only the review reports whose dispositions are cited.

### Architecture Validator receives

- `ART-IMPL-000` with mapped diff; the frozen architecture decisions and `ART-ARCH-REV-001` findings to trace; `MODULE_REGISTRY.yaml` and `DEPENDENCY_GRAPH.yaml` slices for changed boundaries.

### QA Engineer receives

- Candidate revision identity; reproduction commands from `ART-TEST-005`; explicit environment/data references.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: validation`
- `Current Gate: G6`
- `Current Agent: Documentation Validator` / `Architecture Validator` / `QA Engineer` / `Lead Architect`.
- `Completed`: closed `ART-VAL-*` IDs.
- `Waiting On`: SYNC-val-1; specific validator dimension.
- `Blockers`: conflicting validator results; unverifiable evidence; constitutional failure.
- `Next Action`: consolidation, G6 evaluation, or return to owner.

## Parallel Activities

Documentation, architecture, and behavior validation MAY run in parallel against the same immutable candidate; consolidation follows all branches.

## Validation Gates

G6 is `PASS` only when requirements coverage, ownership, dependencies, architecture, terminology, assumptions, duplicate rules, constitution, and repository consistency pass.

### Required Inputs → Produced Outputs

- **G6** inputs: `ART-VAL-DOC-001` + `ART-VAL-ARCH-001` + `ART-VAL-BEH-001` bound to the same immutable candidate revision.
- **G6** outputs: `ART-VAL-001` with per-dimension statuses, criterion matrix, residual-limitation list, and gate recommendation forwarded to G7.

## Escalation Conditions

Conflicting validator results, unverifiable evidence, missing authority, environment prevents mandatory check, accepted-risk request, or constitutional failure.

## Artifacts Produced

Validation Report, criterion matrix, reproduced-command evidence, residual limitation list, G6 result.

## Failure Handling

Return each finding to its owning author/implementer. Candidate changes invalidate affected validation and require review impact analysis.

## Restart Conditions

Restart failed dimensions after fixes; restart all dimensions if revision identity, frozen requirements, architecture, or core evidence changes.
