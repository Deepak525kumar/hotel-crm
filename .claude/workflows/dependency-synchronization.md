# Dependency Synchronization Workflow

## Purpose

Repair drift among producers, consumers, contracts, events, ownership edges, packages, and dependency records.

## Entry Conditions

An approved dependency change or mismatch between repository evidence and dependency graph is identified.

## Exit Conditions

Producer/consumer implementations, contracts, tests, rollout, manifests/locks, graph, and docs agree at a known revision.

## Participating Agents

Lead Architect (owner); Dependency Reviewer; affected implementation engineers; QA; Security Reviewer for external packages; authors of contracts.

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

## Parallel Activities

Consumers MAY update in parallel after a compatible contract fixture freezes. Breaking migrations follow approved staged order.

## Validation Gates

Pass requires zero unknown consumers, complete contract tests, consistent package manifests/locks, and graph/repository agreement.

## Escalation Conditions

Unknown consumer/owner, breaking change without migration, cycle, external dependency risk, incompatible release cadence, or destructive schema change.

## Artifacts Produced

Dependency Drift Report, compatibility matrix, rollout/migration plan, updated contracts/tests/graph, Validation Report.

## Failure Handling

Maintain compatibility layer or stop at safe migration boundary; do not partially remove old contracts while active consumers remain.

## Restart Conditions

Restart tracing after any contract/owner/package change; otherwise resume at the failed migration stage and rerun affected regression.
