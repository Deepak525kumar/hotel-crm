# Requirements Workflow

## Purpose

Transform an objective into confirmed, atomic, traceable, testable requirements without choosing implementation.

## Entry Conditions

G0 passes; objective and authority are known; relevant current-state evidence is packaged.

## Exit Conditions

Scope, requirements, rules, acceptance criteria, assumptions, exclusions, and open decisions are complete; G1 passes.

## Participating Agents

Requirements Analyst (owner); Business Rule Validator; Lead Architect; human product/architecture authority.

## Execution Order

1. Baseline current behavior and authoritative intent.
2. Define actors, outcomes, constraints, inclusions, exclusions, and priority.
3. Decompose into `REQ-*` and measurable acceptance criteria.
4. Extract `RULE-*`; independently validate source, owner, cases, and contradictions against the business-rules checklist (`BR-01..BR-10`).
5. Build source and requirement traceability.
6. Resolve or explicitly exclude unknowns and conflicts.
7. Validate requirements completeness and record G1.

## Parallel Activities

Independent evidence collection by affected domain MAY run in parallel. Business-rule validation begins once candidate rules are stable; final traceability waits for all.

## Validation Gates

G1 requires zero unsupported normative statements, zero unresolved blocking questions, complete acceptance criteria, and approved scope.

## Escalation Conditions

Missing product authority, conflicting intent, undefined business policy, feasibility/architecture constraint, legal ambiguity, or expanded scope.

## Artifacts Produced

Requirements Register, rule matrix, acceptance-criteria matrix, scope statement, evidence ledger, decision/open-question log.

## Failure Handling

Return invalid rules or ambiguous requirements to analysis. Do not progress to specification while affected items are `UNKNOWN` or `CONFLICTING`.

## Restart Conditions

Restart from the affected requirement when human intent, canonical rule, repository baseline, or scope changes; revalidate downstream traceability.
