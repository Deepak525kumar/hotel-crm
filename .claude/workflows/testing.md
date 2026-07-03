# Testing Workflow

## Purpose

Design and execute risk-based functional and nonfunctional checks against a known implementation candidate.

## Entry Conditions

G5 passes; candidate revision/build, frozen criteria, environment, and test data strategy are identifiable.

## Exit Conditions

All applicable tests execute with traceable results; defects are resolved or accepted under policy; QA recommendation is recorded.

## Participating Agents

QA Engineer (owner); implementation engineers for defect fixes; Security and Performance Reviewers for specialist testing; Lead Architect coordinates.

## Execution Order

1. Map requirements/rules/risks to tests and test levels.
2. Establish environment, data, tools, and baseline.
3. Run static/unit checks, then integration/contract, then end-to-end/system checks as applicable.
4. Run security/performance checks where applicable.
5. Record defects with reproducible evidence.
6. Implementers fix; run targeted tests then required regression.
7. Execute the testing checklist (`TS-01..TS-10`) and record evidence.
8. Finalize coverage and residual limitations.

## Parallel Activities

Independent test suites MAY run in parallel on isolated state. Security/performance work MAY parallel functional QA after candidate freeze; shared mutable environments require serialization.

## Validation Gates

Testing contributes to G6. Every frozen acceptance criterion must map to passing evidence or a blocking status.

## Escalation Conditions

Untestable criterion, missing environment/data authority, nondeterminism, critical/high defect, privacy/security risk, or performance test requiring production-like access.

## Artifacts Produced

Test plan, cases, coverage matrix, execution logs, defect reports, specialist test reports, QA recommendation.

## Failure Handling

Failed behavior returns to the responsible implementer. Flaky checks are quarantined only with owner/root-cause task and cannot prove acceptance.

## Restart Conditions

Run targeted plus impact-based regression after fixes; rebuild the plan when acceptance criteria, environment, or candidate architecture changes.
