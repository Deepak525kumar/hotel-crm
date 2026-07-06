# Documentation Workflow

## Loop Metadata

- **Loop type:** Pipeline with an embedded Refinement sub-loop (author → review → correct) ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Author, independently review, validate, and freeze an authoritative specification or engineering document.
- **Metric:** G2, G4, and the documentation portion of G6 pass; artifact marked `FROZEN`/`CURRENT`.
- **Boundary:** One candidate; every semantic correction increments the candidate version; at most three review→fix cycles before escalation (§3).
- **Retry policy:** Semantic edit → new version → impact-based re-review of affected sections only ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** Approved, versioned, traceable, review-complete document.
- **Failure condition:** Unresolved high finding or authority conflict after the retry bound → escalate.
- **Confidence threshold:** `High` for target-state and decision content.

## Purpose

Author, independently review, validate, and freeze an authoritative specification or engineering document.

## Entry Conditions

G0 passes; G1 passes for behavior-bearing documents; owner, template, and target authority are known.

## Exit Conditions

Artifact is approved, versioned, traceable, internally consistent, review-complete, and marked `FROZEN` or `CURRENT`.

## Participating Agents

Module Author or designated document owner; Architecture, Dependency, and Consistency Reviewers as applicable; Documentation Validator; Lead Architect; human approver.

## Execution Graph

```
Lead Architect (context handoff)
  ↓ ART-REQ-002 + ART-RULE-001 + template + ADRs
Module Author (or document owner) — author from confirmed evidence
  ↓ ART-SPEC-001 v0.n (REVIEW candidate, immutable for this cycle)
  ├─ (parallel, applicability-gated) Architecture Reviewer   → ART-ARCH-REV-001
  ├─ (parallel, applicability-gated) Dependency Reviewer     → ART-DEP-REV-001
  ├─ (parallel, applicability-gated) Consistency Reviewer    → ART-CONS-REV-001
  ├─ (parallel, applicability-gated) Security Reviewer       → ART-SEC-REV-001
  └─ (parallel, applicability-gated) Performance Reviewer    → ART-PERF-REV-001
       ↓ SYNC-doc-1 (Lead Architect merges findings by FIND-* + severity)
Module Author — apply corrections; increment version
  ↓ ART-SPEC-001 v0.n+1 (impact-based re-review of affected sections only)
  ↓ (repeat review→fix; bound: 3 cycles)
G4 evaluation (applicable review components) — Lead Architect
  ↓
Documentation Validator — objective compliance check
  ↓ ART-VAL-001 (documentation dimensions)
Human approver — target-state / decision content approval
  ↓ ART-SPEC-001 vX.Y.Z (FROZEN)
G2 record + documentation portion of G6 record
```

## Execution Order

1. Select template and identify canonical versus referenced content.
2. Author from confirmed requirements/evidence with stable IDs.
3. Freeze a review candidate version.
4. Run applicable independent reviews.
5. Merge findings; author applies corrections and records dispositions.
6. Re-review affected sections.
7. Documentation Validator checks complete artifact and evidence.
8. Human approves target-state/decision content.
9. Set version/status and update indexes/cross-references.

## Agent I/O Contracts

### Module Author (or document owner)

- **Inputs:** `ART-REQ-002`, `ART-RULE-001`, applicable ADRs, `MODULE_SPEC_TEMPLATE.md`, `MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml` slice, `TERMINOLOGY.md`.
- **Outputs:** `ART-SPEC-001` versioned Module Specification; proposed graph/registry deltas; review response log; freeze candidate at `FROZEN`.
- **Next Consumer:** Applicable independent reviewers (review), Documentation Validator (validation), human approver (freeze).

### Architecture Reviewer (applicability per [REVIEW_GATES.md](../constitution/REVIEW_GATES.md))

- **Inputs:** Immutable `ART-SPEC-001` v0.n; ADRs; `MODULE_REGISTRY.yaml`; `DEPENDENCY_GRAPH.yaml`.
- **Outputs:** `ART-ARCH-REV-001` with gate recommendation and findings per canonical schema.
- **Next Consumer:** Lead Architect (finding merge); Module Author (correction).

### Dependency Reviewer (applicability per REVIEW_GATES.md)

- **Inputs:** Immutable `ART-SPEC-001` v0.n; manifests; `DEPENDENCY_GRAPH.yaml`.
- **Outputs:** `ART-DEP-REV-001` including edge/compatibility matrix and proposed graph delta.
- **Next Consumer:** Lead Architect; Module Author.

### Consistency Reviewer (always applicable for documentation changes)

- **Inputs:** Immutable `ART-SPEC-001` v0.n; `TERMINOLOGY.md`; active docs; indexes.
- **Outputs:** `ART-CONS-REV-001` with terminology delta and cross-reference report.
- **Next Consumer:** Lead Architect; Module Author.

### Security Reviewer (applicability per REVIEW_GATES.md)

- **Inputs:** Immutable `ART-SPEC-001` v0.n; data flows, trust boundaries, security policy.
- **Outputs:** `ART-SEC-REV-001` with residual-risk statement.
- **Next Consumer:** Lead Architect; Module Author; human for risk acceptance.

### Performance Reviewer (applicability per REVIEW_GATES.md)

- **Inputs:** Immutable `ART-SPEC-001` v0.n; workload/SLO evidence, budgets.
- **Outputs:** `ART-PERF-REV-001` with measurements or projections.
- **Next Consumer:** Lead Architect; Module Author.

### Documentation Validator

- **Inputs:** Frozen `ART-SPEC-001`; all `ART-*-REV-001` reports; approval record.
- **Outputs:** `ART-VAL-001` documentation dimension of validation report.
- **Next Consumer:** Human approver; Lead Architect (G6 documentation portion).

### Lead Architect

- **Inputs:** All review reports; validator report; approval decisions.
- **Outputs:** Merged finding register; G2 and G4 records; documentation portion of G6.
- **Next Consumer:** Downstream implementation workflow.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-SPEC-001` (v0.n) | Module Author | `ART-REQ-002`, `ART-RULE-001`, ADRs, template | REVIEW candidate | Applicable reviewers |
| `ART-ARCH-REV-001` | Architecture Reviewer | `ART-SPEC-001` v0.n | review report + findings | Lead Architect; Module Author |
| `ART-DEP-REV-001` | Dependency Reviewer | `ART-SPEC-001` v0.n | review report + graph delta | Lead Architect; Module Author |
| `ART-CONS-REV-001` | Consistency Reviewer | `ART-SPEC-001` v0.n | review report + terminology/cross-ref delta | Lead Architect; Module Author |
| `ART-SEC-REV-001` | Security Reviewer | `ART-SPEC-001` v0.n | review report + residual risk | Lead Architect; Module Author; human |
| `ART-PERF-REV-001` | Performance Reviewer | `ART-SPEC-001` v0.n | review report + measurements | Lead Architect; Module Author |
| `ART-SPEC-001` (vX.Y.Z FROZEN) | Module Author | corrected content + dispositions | frozen versioned specification | Documentation Validator; human approver; implementation workflow |
| `ART-VAL-001` (doc dims) | Documentation Validator | frozen spec + review reports + approval | validation report (documentation dimensions) | Lead Architect (G6 documentation portion) |

## Synchronization Points

- **SYNC-doc-1:** Lead Architect waits until all applicable independent reviews (architecture, dependency, consistency, security, performance) return findings against the same `ART-SPEC-001` v0.n before merging by `FIND-*` and severity and returning to Module Author. Reviewers do not read each other's conclusions before submitting initial findings (per [REVIEW_GATES.md](../constitution/REVIEW_GATES.md) Independent Review Protocol).
- **SYNC-doc-2:** Human approver evaluates target-state/decision content only after Documentation Validator returns `ART-VAL-001` and no critical/high finding is open.

## Context Packages

### Module Author receives

- `ART-REQ-002`, `ART-RULE-001` (relevant slice only).
- `MODULE_SPEC_TEMPLATE.md`.
- Direct-dependency slice of `MODULE_REGISTRY.yaml` and `DEPENDENCY_GRAPH.yaml`.
- Applicable ADRs from `DECISION_INDEX.md`.
- `TERMINOLOGY.md` slice for in-scope terms.

### Each Reviewer receives

- Immutable `ART-SPEC-001` v0.n only (never the author's proposed fixes).
- Reviewer-specific canonical inputs (as per each review workflow's Context Packages section).
- Explicit exclusion of other reviewers' in-flight findings until after SYNC-doc-1.

### Documentation Validator receives

- Frozen `ART-SPEC-001`; each `ART-*-REV-001`; dispositions; approval record.
- No unresolved review findings elided.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: documentation`
- `Current Gate: G2` (freeze), `G4` (independent reviews), or `G6-doc` (validator).
- `Current Agent: Module Author` (during author/correction), or the active reviewer/validator.
- `Completed`: closed `ART-SPEC-001` versions and `ART-*-REV-001` IDs.
- `Waiting On`: SYNC-doc-1 or SYNC-doc-2; specific finding disposition; human approval.
- `Blockers`: unresolved critical/high findings; authority conflict; template/constitution conflict.
- `Next Action`: next version increment, next re-review, or handoff to implementation.

## Parallel Activities

Architecture, dependency, consistency, security, and performance reviews MAY run in parallel against the same immutable candidate.

## Validation Gates

G2 requires valid approval metadata and no blocker. G4 and documentation portion of G6 must pass before freeze.

### Required Inputs → Produced Outputs

- **G2** inputs: frozen `ART-SPEC-001`, human approval record, `ART-VAL-001` (documentation dimensions).
- **G2** outputs: freeze record and version stamp; downstream implementation authorized.
- **G4** inputs: `ART-ARCH-REV-001`, `ART-DEP-REV-001`, `ART-CONS-REV-001`, `ART-SEC-REV-001` (if applicable), `ART-PERF-REV-001` (if applicable).
- **G4** outputs: consolidated findings register with dispositions; per-component `PASS`/`FAIL`/`BLOCKED`/`N/A`.

## Escalation Conditions

New requirement, architecture decision, authority conflict, canonical-source ambiguity, constitutional change, or unresolved high finding.

## Artifacts Produced

Versioned document, evidence manifest, independent review reports, finding/disposition log, Validation Report, approval record.

## Failure Handling

Return to the responsible author at the failed criterion. Any semantic correction increments candidate version and invalidates affected review evidence.

## Restart Conditions

Restart at authoring for scope/requirement changes, at review for semantic edits, or at validation for purely corrective nonsemantic metadata edits.
