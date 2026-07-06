# Requirements Workflow

## Loop Metadata

- **Loop type:** Pipeline ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Transform an objective into confirmed, atomic, traceable, testable requirements without choosing implementation.
- **Metric:** Gate G1 passes (zero unsupported normative statements, zero unresolved blocking questions, complete acceptance criteria, approved scope).
- **Boundary:** Scope of the objective; at most three clarification iterations per unresolved item before escalation (§3).
- **Retry policy:** Default bounded correction per [LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3; re-derive only on changed intent or evidence.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** G1 `PASS`.
- **Failure condition:** Items remain `UNKNOWN`/`CONFLICTING` after the retry bound → escalate to product/architecture authority.
- **Confidence threshold:** `High` for every normative statement.

## Purpose

Transform an objective into confirmed, atomic, traceable, testable requirements without choosing implementation.

## Entry Conditions

G0 passes; objective and authority are known; relevant current-state evidence is packaged.

## Exit Conditions

Scope, requirements, rules, acceptance criteria, assumptions, exclusions, and open decisions are complete; G1 passes.

## Participating Agents

Requirements Analyst (owner); Business Rule Validator; Lead Architect; human product/architecture authority.

## Execution Graph

```
Lead Architect (context handoff)
  ↓ ART-PREFLIGHT-003 + objective + evidence ledger
Requirements Analyst — baseline current behavior; decompose into REQ-*
  ↓ ART-REQ-001 (draft Requirements Register + candidate RULE-*)
  ├─ (parallel, per affected domain) Requirements Analyst — independent evidence collection
  └─ Business Rule Validator — validate candidate RULE-* against BR-01..BR-10
       ↓ SYNC-req-1
Requirements Analyst — resolve unknowns/conflicts; build traceability
  ↓ ART-REQ-002 (Requirements Register v1) + ART-RULE-001 (Rule Matrix)
Lead Architect — G1 evaluation
  ↓ ART-REQ-003 (G1 record)
Downstream: documentation workflow (Module Author)
```

## Execution Order

1. Baseline current behavior and authoritative intent.
2. Define actors, outcomes, constraints, inclusions, exclusions, and priority.
3. Decompose into `REQ-*` and measurable acceptance criteria.
4. Extract `RULE-*`; independently validate source, owner, cases, and contradictions against the business-rules checklist (`BR-01..BR-10`).
5. Build source and requirement traceability.
6. Resolve or explicitly exclude unknowns and conflicts.
7. Validate requirements completeness and record G1.

## Agent I/O Contracts

### Requirements Analyst

- **Inputs:** Objective; `ART-PREFLIGHT-003` context manifest; evidence ledger; `../knowledge/TERMINOLOGY.md`; prior approved decisions.
- **Outputs:** `ART-REQ-001` draft register (with candidate `RULE-*`); `ART-REQ-002` Requirements Register v1 + acceptance-criteria matrix + traceability matrix + open-question log.
- **Next Consumer:** Business Rule Validator (candidate rules); Lead Architect (G1 evaluation); Module Author (post-G1).

### Business Rule Validator

- **Inputs:** Candidate `RULE-*` list from `ART-REQ-001`; evidence ledger; `TERMINOLOGY.md`; `MODULE_REGISTRY.yaml`; existing rule references.
- **Outputs:** `ART-RULE-001` Business Rule Validation report and Rule Matrix (per rule: `VALID` / `INVALID` / `BLOCKED`), findings per [REVIEWER_FINDINGS.md](../constitution/REVIEWER_FINDINGS.md).
- **Next Consumer:** Requirements Analyst (correction), Consistency Reviewer (cross-module duplication), Lead Architect.

### Lead Architect

- **Inputs:** `ART-REQ-002`, `ART-RULE-001`, evidence ledger, applicability rules.
- **Outputs:** `ART-REQ-003` G1 record (`PASS` / `PASS_WITH_ACTIONS` / `FAIL` / `BLOCKED`).
- **Next Consumer:** Documentation workflow entry.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-REQ-001` | Requirements Analyst | objective, context manifest, evidence ledger | draft Requirements Register with candidate `REQ-*` and `RULE-*` | Business Rule Validator; Requirements Analyst (per-domain evidence loop) |
| `ART-RULE-001` | Business Rule Validator | `ART-REQ-001` candidate rules | validation report + Rule Matrix + findings | Requirements Analyst (fixes); Consistency Reviewer for duplication |
| `ART-REQ-002` | Requirements Analyst | corrected register + validated rules + evidence | Requirements Register v1 + acceptance-criteria matrix + traceability matrix + open-question log | Lead Architect (G1); documentation workflow |
| `ART-REQ-003` | Lead Architect | `ART-REQ-002` + `ART-RULE-001` | G1 gate record | Documentation workflow (Module Author) |

## Synchronization Points

- **SYNC-req-1:** Requirements Analyst waits until (a) per-domain evidence collection branches and (b) Business Rule Validator's report on all candidate `RULE-*` have completed before building final traceability and closing `ART-REQ-002`. Owner: Requirements Analyst.

## Context Packages

### Requirements Analyst receives

- Objective (verbatim); scope inclusions/exclusions from `ART-PREFLIGHT-001`.
- Evidence ledger citations for current behavior only.
- `../knowledge/TERMINOLOGY.md` slice for in-scope terms.
- Prior approved decisions from `DECISION_INDEX.md` that bear on scope.

### Business Rule Validator receives

- Candidate `RULE-*` list only, with each rule's source citation.
- Rule-relevant excerpts from `MODULE_REGISTRY.yaml` and current implementations/tests.
- Business-rules checklist `BR-01..BR-10`.
- Existing canonical rules that could duplicate the candidates.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: requirements`
- `Current Gate: G1`
- `Current Agent: Requirements Analyst` (or Business Rule Validator when validating).
- `Completed`: `ART-REQ-*`, `ART-RULE-*` IDs closed.
- `Waiting On`: SYNC-req-1; unresolved product authority decision; blocking finding.
- `Blockers`: `UNKNOWN`/`CONFLICTING` requirements or rules after the retry bound.
- `Next Action`: next specialist invocation or G1 evaluation.

## Parallel Activities

Independent evidence collection by affected domain MAY run in parallel. Business-rule validation begins once candidate rules are stable; final traceability waits for all.

## Validation Gates

G1 requires zero unsupported normative statements, zero unresolved blocking questions, complete acceptance criteria, and approved scope.

### Required Inputs → Produced Outputs

- **G1** inputs: `ART-REQ-002`, `ART-RULE-001`, evidence ledger citations for every `CONFIRMED` statement.
- **G1** outputs: `ART-REQ-003` G1 record; approved Requirements Register handed to Module Author.

## Escalation Conditions

Missing product authority, conflicting intent, undefined business policy, feasibility/architecture constraint, legal ambiguity, or expanded scope.

## Artifacts Produced

Requirements Register, rule matrix, acceptance-criteria matrix, scope statement, evidence ledger, decision/open-question log.

## Failure Handling

Return invalid rules or ambiguous requirements to analysis. Do not progress to specification while affected items are `UNKNOWN` or `CONFLICTING`.

## Restart Conditions

Restart from the affected requirement when human intent, canonical rule, repository baseline, or scope changes; revalidate downstream traceability.
