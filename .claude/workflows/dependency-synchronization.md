# Dependency Synchronization Workflow

## Loop Metadata

- **Loop type:** Synchronization ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Repair drift among producers, consumers, contracts, events, ownership edges, packages, and dependency records.
- **Metric:** Producer/consumer implementations, contracts, tests, manifests/locks, graph, and docs agree at a known revision.
- **Boundary:** One authoritative contract/package/ownership state; breaking migrations follow approved staged order; resume at the failed migration stage.
- **Retry policy:** Re-trace after any contract/owner/package change; otherwise resume and rerun affected regression ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** Zero unknown consumers, complete contract tests, consistent manifests/locks, graph/repository agreement.
- **Failure condition:** Unknown consumer/owner, breaking change without migration, cycle, or destructive schema change → escalate; keep a compatibility layer until consumers migrate.
- **Confidence threshold:** `High`.

## Purpose

Repair drift among producers, consumers, contracts, events, ownership edges, packages, and dependency records.

## Entry Conditions

An approved dependency change or mismatch between repository evidence and dependency graph is identified.

## Exit Conditions

Producer/consumer implementations, contracts, tests, rollout, manifests/locks, graph, and docs agree at a known revision.

## Participating Agents

Lead Architect (owner); Dependency Reviewer; affected implementation engineers; QA; Security Reviewer for external packages; authors of contracts.

## Execution Graph

```
Lead Architect (entry from dep-review divergence or graph mismatch)
  ↓ pause affected workflow paths
Lead Architect + Dependency Reviewer — establish authoritative contract/package/ownership state
  ↓ ART-SYNC-DEP-001 (Dependency Drift Report)
Dependency Reviewer — trace all upstream/downstream and transitive consumers
  ↓ ART-SYNC-DEP-002 (compatibility matrix)
Contract authors + Lead Architect — classify compatibility; define producer/consumer migration order; freeze contract and rollout plan
  ↓ ART-SYNC-DEP-003 (rollout/migration plan + frozen contract)
  ├─ (parallel; consumers proceed after compatible contract fixture freezes) producer updates → contracts + tests + manifests/locks
  ├─ (parallel) consumer updates → adopt contract; update tests; adjust manifests/locks
  └─ (staged, if breaking) breaking migrations follow approved order
       ↓ SYNC-dep-sync-1 (contract tests + producer/consumer updates present)
QA Engineer — contract/regression checks
Security Reviewer — checks for external-package changes
  ↓ ART-SYNC-DEP-004 (regression + security evidence)
Lead Architect — validate graph against repository; record synchronization state; refresh context packages
  ↓ ART-SYNC-DEP-005 (updated DEPENDENCY_GRAPH + sync-state update)
Lead Architect — restart paused workflows from last stable gate
```

## Execution Order

1. Pause affected workflow paths.
2. Establish authoritative contract/package/ownership state.
3. Trace all upstream/downstream and transitive consumers.
4. Classify compatibility and define producer/consumer migration order.
5. Freeze contract and rollout plan.
6. Update producers, consumers, tests, manifests/locks, docs, and graph.
7. Run contract/regression/security checks.
8. Validate graph against repository and record synchronization state.
9. Refresh context packages and restart.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Approved dependency change or graph mismatch; `SYNC_STATE.yaml`; capability registry; affected workflow set.
- **Outputs:** `ART-SYNC-DEP-001` Foundation-comparable Dependency Drift Report; `ART-SYNC-DEP-003` rollout/migration plan (with contract authors); `ART-SYNC-DEP-005` updated `DEPENDENCY_GRAPH.yaml` + sync-state update.
- **Next Consumer:** Dependency Reviewer; contract authors; implementers; QA; Security Reviewer; paused workflows.

### Dependency Reviewer

- **Inputs:** `ART-SYNC-DEP-001`; `DEPENDENCY_GRAPH.yaml`; manifests/lockfiles; contract sources.
- **Outputs:** `ART-SYNC-DEP-002` compatibility matrix + consumer trace.
- **Next Consumer:** Lead Architect; contract authors.

### Contract authors (of affected contracts/events/schemas)

- **Inputs:** `ART-SYNC-DEP-002`; authoritative contract state; migration policy.
- **Outputs:** Frozen contract + contract fixtures (referenced by `ART-SYNC-DEP-003`).
- **Next Consumer:** Producer implementer; consumer implementers (after fixture freeze).

### Implementation engineers (producers and consumers)

- **Inputs:** `ART-SYNC-DEP-003`; frozen contract fixture; per-consumer/producer plan item.
- **Outputs:** Updated code + tests + manifests/locks.
- **Next Consumer:** QA Engineer (contract/regression); Security Reviewer for external packages.

### QA Engineer

- **Inputs:** Updated producer + consumer set at the same revision; contract fixtures; regression test plan.
- **Outputs:** `ART-SYNC-DEP-004` regression evidence and defect reports per canonical schema.
- **Next Consumer:** Lead Architect; implementers on defects.

### Security Reviewer (external packages)

- **Inputs:** External package identity/version changes; provenance and policy.
- **Outputs:** Security assessment referenced by `ART-SYNC-DEP-004`.
- **Next Consumer:** Lead Architect.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-SYNC-DEP-001` | Lead Architect | drift signal + dep graph + SYNC_STATE | Dependency Drift Report | Dependency Reviewer; contract authors |
| `ART-SYNC-DEP-002` | Dependency Reviewer | `ART-SYNC-DEP-001` + graph + manifests | compatibility matrix + consumer trace | Contract authors; Lead Architect |
| `ART-SYNC-DEP-003` | Lead Architect + contract authors | `ART-SYNC-DEP-002` + migration policy | rollout/migration plan + frozen contract fixture | Producer implementer; consumer implementers |
| Updated producer/consumer code + tests + manifests | Implementation engineers | `ART-SYNC-DEP-003` + fixtures | scoped diffs + tests | QA; Security Reviewer |
| `ART-SYNC-DEP-004` | QA + Security Reviewer | updated code + fixtures + policy | regression + security evidence | Lead Architect |
| `ART-SYNC-DEP-005` | Lead Architect | all above | updated `DEPENDENCY_GRAPH.yaml` + sync-state update | Paused workflows (restart) |

## Synchronization Points

- **SYNC-dep-sync-1:** QA Engineer waits until (a) producer updates freeze, (b) consumer updates freeze on the fixture, and (c) manifests/locks are consistent before running contract and regression checks. Consumers MAY proceed in parallel with the producer only after a compatible contract fixture freezes; breaking migrations follow the staged order in `ART-SYNC-DEP-003`.
- Security Reviewer input on external packages runs in parallel with regression tests and joins at SYNC-dep-sync-1.

## Context Packages

### Lead Architect receives

- Drift signal (edge/package identifiers); `SYNC_STATE.yaml`; the list of paused workflows.

### Dependency Reviewer receives

- `ART-SYNC-DEP-001`; `DEPENDENCY_GRAPH.yaml` slice for affected edges; manifests/lockfiles for affected packages.

### Contract authors receive

- `ART-SYNC-DEP-002` slice for the contracts they own; authoritative contract state; migration policy.

### Implementation engineers receive

- Their assigned producer/consumer work item; frozen contract fixture; test/build commands.

### QA Engineer receives

- Updated producer + consumer set at the same revision; contract fixtures; regression test plan.

### Security Reviewer receives (external-package step)

- Only the external package identity/version and provenance; nothing else.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: dependency-synchronization`
- `Current Gate: synchronization-pass`
- `Current Agent: Lead Architect` (or Dependency Reviewer / contract author / implementer / QA / Security Reviewer).
- `Completed`: closed `ART-SYNC-DEP-*` IDs.
- `Waiting On`: SYNC-dep-sync-1; specific producer/consumer update; contract fixture freeze; migration stage completion.
- `Blockers`: unknown consumer/owner; breaking change without migration; cycle; destructive schema.
- `Next Action`: fixture freeze, next migration stage, regression rerun, or paused-workflow restart.

## Parallel Activities

Consumers MAY update in parallel after a compatible contract fixture freezes. Breaking migrations follow approved staged order.

## Validation Gates

Pass requires zero unknown consumers, complete contract tests, consistent package manifests/locks, and graph/repository agreement.

### Required Inputs → Produced Outputs

- **synchronization-pass** inputs: `ART-SYNC-DEP-003` frozen contract + rollout plan; producer/consumer updates at a known revision; `ART-SYNC-DEP-004` regression + security evidence.
- **synchronization-pass** outputs: `ART-SYNC-DEP-005` updated `DEPENDENCY_GRAPH.yaml` + sync-state update; paused workflows authorized to rerun full pre-flight.

## Escalation Conditions

Unknown consumer/owner, breaking change without migration, cycle, external dependency risk, incompatible release cadence, or destructive schema change.

## Artifacts Produced

Dependency Drift Report, compatibility matrix, rollout/migration plan, updated contracts/tests/graph, Validation Report.

## Failure Handling

Maintain compatibility layer or stop at safe migration boundary; do not partially remove old contracts while active consumers remain.

## Restart Conditions

Restart tracing after any contract/owner/package change; otherwise resume at the failed migration stage and rerun affected regression.
