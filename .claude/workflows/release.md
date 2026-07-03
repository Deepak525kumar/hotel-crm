# Release Workflow

## Purpose

Prepare a known, validated revision for safe human-authorized release and post-release verification.

## Entry Conditions

G7 passes; release candidate revision, target environment, prior release, and authorization owner are known.

## Exit Conditions

Release package is authorized and verified, or a documented no-go/rollback state is reached; G8 and post-flight are complete.

## Participating Agents

Release Manager (owner); Infrastructure Engineer; QA Engineer; Security/Performance Reviewers as applicable; Lead Architect; human authorizer.

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

## Parallel Activities

Release-note drafting, artifact verification, and runbook review MAY parallel after candidate freeze. Deployment/migrations follow declared serial order.

## Validation Gates

G8 requires immutable artifacts, all applicable prior gates, verified migration/rollback, observable health criteria, and human approval.

## Escalation Conditions

Failed gate, changed artifact, production authority absent, destructive migration, rollback uncertainty, critical/high finding, or unexpected environment drift.

## Artifacts Produced

Release Report, notes, artifact manifest, deployment/rollback plan, verification record, approval/no-go decision.

## Failure Handling

Before release: no-go and return to owner. During release: stop at safe boundary and invoke approved rollback. Never improvise production repair.

## Restart Conditions

Any candidate change restarts from artifact freeze. Environment-only failure restarts from affected rehearsal/check after drift resolution.
