# Validation Workflow

## Purpose

Independently prove that documentation and implementation satisfy approved requirements and system laws before progress.

## Entry Conditions

Candidate is immutable for validation; author/implementation verification and applicable reviews/testing are complete.

## Exit Conditions

Each mandatory dimension has evidence and status; no open blocker remains; G6 recommendation is recorded.

## Participating Agents

Documentation Validator and Architecture Validator in their respective domains; QA Engineer for behavior evidence; Lead Architect consolidates without changing judgments.

## Execution Order

1. Confirm candidate revision/version and evidence completeness.
2. Validate requirements and acceptance-criteria coverage.
3. Validate business-rule authority and absence of unsupported assumptions/duplication.
4. Validate ownership, dependency graph, contract, and synchronization correctness.
5. Validate architecture, terminology, documentation, and constitutional compliance.
6. Reproduce applicable tests/build/static checks.
7. Consolidate statuses and unresolved limitations.
8. Record G6.

## Parallel Activities

Documentation, architecture, and behavior validation MAY run in parallel against the same immutable candidate; consolidation follows all branches.

## Validation Gates

G6 is `PASS` only when requirements coverage, ownership, dependencies, architecture, terminology, assumptions, duplicate rules, constitution, and repository consistency pass.

## Escalation Conditions

Conflicting validator results, unverifiable evidence, missing authority, environment prevents mandatory check, accepted-risk request, or constitutional failure.

## Artifacts Produced

Validation Report, criterion matrix, reproduced-command evidence, residual limitation list, G6 result.

## Failure Handling

Return each finding to its owning author/implementer. Candidate changes invalidate affected validation and require review impact analysis.

## Restart Conditions

Restart failed dimensions after fixes; restart all dimensions if revision identity, frozen requirements, architecture, or core evidence changes.
