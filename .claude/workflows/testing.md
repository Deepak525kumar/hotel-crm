# Testing Workflow

## Loop Metadata

- **Loop type:** Validation ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Design and execute risk-based functional and nonfunctional checks against a known implementation candidate.
- **Metric:** Every frozen acceptance criterion maps to passing evidence or a blocking status; contributes to G6.
- **Boundary:** One candidate revision; defect fixes re-enter implementation; flaky checks are quarantined only with an owner and root-cause task.
- **Retry policy:** Targeted plus impact-based regression after each fix (§3); rebuild the plan on criteria/environment/architecture change.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** All applicable tests execute with traceable results; defects resolved or accepted under policy.
- **Failure condition:** Untestable criterion, nondeterminism, or unresolved critical/high defect → return to implementer or escalate.
- **Confidence threshold:** `High`; only deterministic checks prove acceptance.

## Purpose

Design and execute risk-based functional and nonfunctional checks against a known implementation candidate.

## Entry Conditions

G5 passes; candidate revision/build, frozen criteria, environment, and test data strategy are identifiable.

## Exit Conditions

All applicable tests execute with traceable results; defects are resolved or accepted under policy; QA recommendation is recorded.

## Participating Agents

QA Engineer (owner); implementation engineers for defect fixes; Security and Performance Reviewers for specialist testing; Lead Architect coordinates.

## Execution Graph

```
Lead Architect (context handoff)
  ↓ ART-IMPL-000 + ART-SPEC-001 (FROZEN) + risk matrix + environment matrix
QA Engineer — map criteria/rules/risks to test levels; establish env/data/baseline
  ↓ ART-TEST-001 (Test Plan + coverage matrix)
QA Engineer — static/unit checks
  ↓ ART-TEST-002 (static/unit results)
QA Engineer — integration/contract checks
  ↓ ART-TEST-003 (integration/contract results)
QA Engineer — end-to-end/system checks
  ↓ ART-TEST-004 (E2E/system results)
  ├─ (parallel where applicable) Security Reviewer  → ART-SEC-REV-002 (specialist testing)
  └─ (parallel where applicable) Performance Rev.   → ART-PERF-REV-002 (specialist testing)
       ↓ SYNC-test-1 (all applicable results present)
QA Engineer — apply testing checklist TS-01..TS-10; record evidence
  ↓ defects (per REVIEWER_FINDINGS.md) → responsible implementer
  ↓ (implementer fix loop through implementation workflow)
QA Engineer — targeted + impact-based regression after each fix
  ↓ ART-TEST-005 (QA recommendation + coverage/limitation summary)
Contributes to G6 (testing dimension) — Lead Architect consolidates
```

## Execution Order

1. Map requirements/rules/risks to tests and test levels.
2. Establish environment, data, tools, and baseline.
3. Run static/unit checks, then integration/contract, then end-to-end/system checks as applicable.
4. Run security/performance checks where applicable.
5. Record defects with reproducible evidence.
6. Implementers fix; run targeted tests then required regression.
7. Execute the testing checklist (`TS-01..TS-10`) and record evidence.
8. Finalize coverage and residual limitations.

## Agent I/O Contracts

### QA Engineer

- **Inputs:** Frozen `ART-SPEC-001` acceptance criteria; `ART-IMPL-000`; `ART-PLAN-001` risk matrix; environment/data strategy; `TERMINOLOGY.md` slice; testing checklist `TS-01..TS-10`.
- **Outputs:** `ART-TEST-001` Test Plan + coverage matrix; `ART-TEST-002..004` execution results per level; `ART-TEST-005` QA recommendation; defect reports per canonical schema.
- **Next Consumer:** Implementation engineers (defects), Lead Architect (G6 test dimension), validators.

### Security Reviewer (specialist testing, applicability per REVIEW_GATES.md)

- **Inputs:** Candidate revision; data flows; `ART-SEC-REV-001` findings.
- **Outputs:** `ART-SEC-REV-002` specialist test results; findings per canonical schema.
- **Next Consumer:** QA Engineer (integration into `ART-TEST-005`); Lead Architect.

### Performance Reviewer (specialist testing, applicability per REVIEW_GATES.md)

- **Inputs:** Candidate revision; workload/SLO evidence; `ART-PERF-REV-001` measurements.
- **Outputs:** `ART-PERF-REV-002` specialist test results.
- **Next Consumer:** QA Engineer; Lead Architect.

### Implementation Engineers (defect fixes)

- **Inputs:** Defect report per canonical schema; re-entry into the implementation workflow with a changed hypothesis.
- **Outputs:** Fix diff and rerun evidence handed back to QA.
- **Next Consumer:** QA Engineer (targeted + regression re-run).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-TEST-001` | QA Engineer | frozen criteria + risk matrix + env matrix | Test Plan + coverage matrix | QA Engineer (execution) |
| `ART-TEST-002` | QA Engineer | static/unit tools + candidate revision | static/unit results | QA Engineer (integration stage) |
| `ART-TEST-003` | QA Engineer | integration/contract fixtures + candidate | integration/contract results | QA Engineer (E2E stage) |
| `ART-TEST-004` | QA Engineer | E2E environment + candidate | end-to-end/system results | SYNC-test-1 |
| `ART-SEC-REV-002` | Security Reviewer | candidate + `ART-SEC-REV-001` | specialist security test results | SYNC-test-1; QA Engineer |
| `ART-PERF-REV-002` | Performance Reviewer | candidate + `ART-PERF-REV-001` | specialist performance test results | SYNC-test-1; QA Engineer |
| `ART-TEST-005` | QA Engineer | all above + checklist TS-01..TS-10 | QA recommendation + coverage/limitation summary + defects | Lead Architect (G6 test); validators |

## Synchronization Points

- **SYNC-test-1:** QA Engineer waits until every applicable functional level (`ART-TEST-002..004`) and every applicable specialist test (`ART-SEC-REV-002`, `ART-PERF-REV-002`) has produced a result before applying the testing checklist and closing `ART-TEST-005`. Shared mutable environments must be serialized before this join.

## Context Packages

### QA Engineer receives

- Frozen `ART-SPEC-001` acceptance criteria (only the criteria to verify).
- `ART-IMPL-000` mapped diff and revision identity.
- `ART-PLAN-001` risk matrix slice.
- Environment matrix, data strategy, and observability commands.
- Testing checklist `TS-01..TS-10`.

### Security Reviewer receives (specialist testing)

- Candidate revision identity; the specific data flows/trust boundaries to test; prior `ART-SEC-REV-001` findings.

### Performance Reviewer receives (specialist testing)

- Candidate revision identity; the specific workload/SLO to verify; baseline measurements.

### Implementation engineer receives (defect fix)

- Single defect report per canonical schema; the failing test commands; the affected `ART-IMPL-<surface>-001` slice only.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: testing`
- `Current Gate: G6-test` (contributing).
- `Current Agent: QA Engineer` (or specialist during specialist testing).
- `Completed`: closed `ART-TEST-*`, `ART-SEC-REV-002`, `ART-PERF-REV-002` IDs.
- `Waiting On`: SYNC-test-1; defect fix in the implementation workflow; environment provisioning.
- `Blockers`: untestable criterion; nondeterminism; unresolved critical/high defect.
- `Next Action`: next test level, specialist invocation, or QA recommendation.

## Parallel Activities

Independent test suites MAY run in parallel on isolated state. Security/performance work MAY parallel functional QA after candidate freeze; shared mutable environments require serialization.

## Validation Gates

Testing contributes to G6. Every frozen acceptance criterion must map to passing evidence or a blocking status.

### Required Inputs → Produced Outputs

- **G6 (testing dimension)** inputs: `ART-TEST-005` + `ART-SEC-REV-002` + `ART-PERF-REV-002` (where applicable).
- **G6 (testing dimension)** outputs: pass/fail per criterion; residual limitations; defect status.

## Escalation Conditions

Untestable criterion, missing environment/data authority, nondeterminism, critical/high defect, privacy/security risk, or performance test requiring production-like access.

## Artifacts Produced

Test plan, cases, coverage matrix, execution logs, defect reports, specialist test reports, QA recommendation.

## Failure Handling

Failed behavior returns to the responsible implementer. Flaky checks are quarantined only with owner/root-cause task and cannot prove acceptance.

## Restart Conditions

Run targeted plus impact-based regression after fixes; rebuild the plan when acceptance criteria, environment, or candidate architecture changes.
