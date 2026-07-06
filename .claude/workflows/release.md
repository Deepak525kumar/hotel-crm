# Release Workflow

## Loop Metadata

- **Loop type:** Pipeline ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Prepare a known, validated revision for safe human-authorized release and post-release verification.
- **Metric:** Gate G8 passes with explicit human authorization; post-release health criteria observed.
- **Boundary:** One frozen candidate revision; any candidate change restarts from artifact freeze; environment-only failure restarts from the affected rehearsal/check.
- **Retry policy:** Restart from artifact freeze on candidate change ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3); never improvise production repair.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure (no-go), or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** Release authorized and verified, or a documented no-go/rollback state is reached; G8 and post-flight complete.
- **Failure condition:** Failed gate, changed artifact, rollback uncertainty, or absent production authority → no-go and return to owner.
- **Confidence threshold:** `High`.

## Purpose

Prepare a known, validated revision for safe human-authorized release and post-release verification.

## Entry Conditions

G7 passes; release candidate revision, target environment, prior release, and authorization owner are known.

## Exit Conditions

Release package is authorized and verified, or a documented no-go/rollback state is reached; G8 and post-flight are complete.

## Participating Agents

Release Manager (owner); Infrastructure Engineer; QA Engineer; Security/Performance Reviewers as applicable; Lead Architect; human authorizer.

## Execution Graph

```
Lead Architect (context handoff after G7)
  ↓ merge-ready revision + prior release + target environment + authorization owner
Release Manager — freeze candidate revision/version and artifact manifest
  ↓ ART-RELEASE-001 (artifact manifest)
Release Manager — build change/dependency/migration/config/accepted-risk inventory
  ↓ ART-RELEASE-002 (change inventory)
Release Manager + Infrastructure Engineer — prepare release notes, deploy sequence, health checks, observability, rollback
  ↓ ART-RELEASE-003 (release notes + deployment/rollback plan + verification checklist)
  ├─ (parallel after freeze) Release Manager — artifact verification (checksums, provenance)
  ├─ (parallel after freeze) Infrastructure Engineer — runbook review
  └─ (parallel after freeze, if required) QA Engineer — rehearsal in authorized non-production environment
       ↓ SYNC-rel-1 (freeze-time parallel checks complete)
Release Manager — verify G0..G7 evidence; issue go/no-go recommendation
  ↓ ART-RELEASE-004 (go/no-go recommendation)
Human authorizer — explicit authorization or no-go
  ↓ authorization record (or documented no-go → return to owner)
Infrastructure Engineer — execute only authorized release steps (serial per deployment/migration order)
  ↓
QA Engineer + Infrastructure Engineer — post-release checks; roll back on declared trigger
  ↓ ART-RELEASE-005 (verification record + rollback state if triggered)
Release Manager — record result and hand to post-flight
  ↓ G8 record → postflight
```

## Execution Order

1. Freeze candidate revision/version and artifact manifest.
2. Build change, dependency, migration, configuration, and accepted-risk inventory.
3. Prepare release notes, deploy sequence, health checks, observability, and rollback.
4. Rehearse in an authorized non-production environment where required.
5. Verify G0–G7 evidence and issue go/no-go recommendation.
6. Obtain explicit human authorization.
7. Execute only authorized release steps.
8. Run post-release checks; roll back on declared trigger.
9. Record result and run post-flight.

## Agent I/O Contracts

### Release Manager

- **Inputs:** Merge-ready revision; G0..G7 gate reports; `ART-VAL-001`; `ART-IMPL-000`; `ART-SEC-REV-001`; `ART-PERF-REV-001`; prior release; release policy.
- **Outputs:** `ART-RELEASE-001` artifact manifest; `ART-RELEASE-002` change inventory; `ART-RELEASE-003` release notes + deploy/rollback plan + verification checklist; `ART-RELEASE-004` go/no-go recommendation; final G8 record.
- **Next Consumer:** Human authorizer; Infrastructure Engineer; QA Engineer; postflight.

### Infrastructure Engineer

- **Inputs:** `ART-RELEASE-003`; environment matrix; approved commands; capacity notes from `ART-PERF-REV-001`.
- **Outputs:** Runbook review notes; executed authorized release steps; environment-specific health check evidence in `ART-RELEASE-005`.
- **Next Consumer:** Release Manager; QA Engineer; postflight.

### QA Engineer

- **Inputs:** `ART-RELEASE-003` verification checklist; candidate revision; test data strategy; post-release environment.
- **Outputs:** Rehearsal evidence (if required); post-release check results in `ART-RELEASE-005`.
- **Next Consumer:** Release Manager; Infrastructure Engineer (rollback trigger); postflight.

### Security / Performance Reviewers (applicability per REVIEW_GATES.md)

- **Inputs:** Candidate revision; production-like access authorization (if applicable).
- **Outputs:** Pre-release residual assessment notes referenced by `ART-RELEASE-004`.
- **Next Consumer:** Release Manager.

### Human authorizer

- **Inputs:** `ART-RELEASE-001..004`; residual-risk statement.
- **Outputs:** Authorization record (or documented no-go).
- **Next Consumer:** Infrastructure Engineer (authorized release steps only); Release Manager (record).

### Lead Architect

- **Inputs:** G8 record.
- **Outputs:** Post-flight invocation.
- **Next Consumer:** Postflight workflow.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-RELEASE-001` | Release Manager | merge-ready revision + version stamp | artifact manifest (immutable) | Infrastructure; QA; verification steps |
| `ART-RELEASE-002` | Release Manager | prior release + G0..G7 evidence + accepted risks | change/dependency/migration/config/accepted-risk inventory | Release notes; go/no-go |
| `ART-RELEASE-003` | Release Manager + Infrastructure Engineer | `ART-RELEASE-002` + capacity notes + observability | release notes + deployment/rollback plan + verification checklist | Rehearsal; SYNC-rel-1 |
| `ART-RELEASE-004` | Release Manager | SYNC-rel-1 output + gate reports | go/no-go recommendation | Human authorizer |
| Authorization record | Human authorizer | `ART-RELEASE-004` + residual risk | authorization or documented no-go | Infrastructure Engineer (execution); Release Manager (record) |
| `ART-RELEASE-005` | Infrastructure Engineer + QA Engineer | authorized release execution + health checks | verification record (and rollback state if triggered) | Release Manager (G8); postflight |

## Synchronization Points

- **SYNC-rel-1:** Release Manager waits until (a) artifact verification, (b) runbook review, and (c) rehearsal (where required) all complete before verifying G0..G7 evidence and issuing the go/no-go recommendation. Deployment and migrations follow the declared serial order in `ART-RELEASE-003` and MUST NOT run in parallel.

## Context Packages

### Release Manager receives

- Merge-ready revision identifier; G0..G7 gate reports and their evidence citations; prior release inventory; target environment matrix; release policy.

### Infrastructure Engineer receives

- `ART-RELEASE-003` runbook and deploy plan; environment credentials/scope authorization; approved commands; capacity notes from `ART-PERF-REV-001`.

### QA Engineer receives

- `ART-RELEASE-003` verification checklist; the specific post-release checks to run; test data strategy for the target environment.

### Security / Performance Reviewers receive (residual assessment)

- Candidate revision identifier; residual-risk from `ART-SEC-REV-001` / `ART-PERF-REV-001`; production-like access authorization (if applicable).

### Human authorizer receives

- `ART-RELEASE-001..004`; residual-risk statement; explicit rollback trigger definitions.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: release`
- `Current Gate: G8`
- `Current Agent: Release Manager` (or Infrastructure Engineer / QA Engineer / Human authorizer).
- `Completed`: closed `ART-RELEASE-*` IDs.
- `Waiting On`: SYNC-rel-1; human authorization; rehearsal environment; post-release health window.
- `Blockers`: failed gate; changed artifact; rollback uncertainty; absent production authority.
- `Next Action`: rehearsal, verification, authorization, execution stage, or postflight invocation.

## Parallel Activities

Release-note drafting, artifact verification, and runbook review MAY parallel after candidate freeze. Deployment/migrations follow declared serial order.

## Validation Gates

G8 requires immutable artifacts, all applicable prior gates, verified migration/rollback, observable health criteria, and human approval.

### Required Inputs → Produced Outputs

- **G8** inputs: `ART-RELEASE-001..004`; authorization record; `ART-RELEASE-005` verification record.
- **G8** outputs: G8 gate record; postflight invocation with the authorized (or no-go/rollback) state.

## Escalation Conditions

Failed gate, changed artifact, production authority absent, destructive migration, rollback uncertainty, critical/high finding, or unexpected environment drift.

## Artifacts Produced

Release Report, notes, artifact manifest, deployment/rollback plan, verification record, approval/no-go decision.

## Failure Handling

Before release: no-go and return to owner. During release: stop at safe boundary and invoke approved rollback. Never improvise production repair.

## Restart Conditions

Any candidate change restarts from artifact freeze. Environment-only failure restarts from affected rehearsal/check after drift resolution.
