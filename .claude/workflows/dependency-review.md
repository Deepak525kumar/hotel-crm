# Dependency Review Workflow

## Purpose

Independently identify dependency, contract, package, and synchronization consequences before approval.

## Entry Conditions

Frozen artifact/diff and current dependency graph/manifests are available; reviewer did not author input.

## Exit Conditions

Every affected edge and package is classified, consumers are known, migration/rollout is viable, and graph delta is ready.

## Participating Agents

Dependency Reviewer (owner); author/implementer for fixes; Security Reviewer for external packages; Lead Architect.

## Execution Order

1. Capture declared and observed dependency baseline.
2. Identify added/removed/changed interfaces, events, contracts, ownership, schemas, and packages.
3. Trace direct/transitive consumers and classify compatibility.
4. Review external dependency fitness where applicable.
5. Define synchronization and rollout order.
6. Record findings and proposed graph delta.
7. Re-review corrections and issue recommendation.

## Parallel Activities

Package fitness and internal edge tracing MAY run in parallel; final compatibility/rollout waits for both. May parallel other independent reviews.

## Validation Gates

Dependency component of G4 passes only with no unknown consumer, no unplanned breaking edge, and complete synchronization actions.

## Escalation Conditions

Breaking change without authority, unknown owner/consumer, cycle, unsafe package, license/security issue, or unavailable migration path.

## Artifacts Produced

Dependency Review, edge/compatibility matrix, package assessment, graph delta, synchronization plan.

## Failure Handling

Block affected approval; return to author or invoke dependency synchronization when approved truth and records diverge.

## Restart Conditions

Restart edge analysis after any contract/package/ownership change; re-run package evidence when version/lockfile changes.
