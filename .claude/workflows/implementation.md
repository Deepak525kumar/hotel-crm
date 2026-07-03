# Implementation Workflow

## Purpose

Plan and implement a frozen specification with bounded scope, traceability, safe sequencing, and independent verification.

## Entry Conditions

G0 and G2 pass; exact frozen spec, review dispositions, affected ownership, and dependencies are known.

## Exit Conditions

All plan items are implemented or explicitly excluded; implementation checks pass; evidence is ready for testing/validation; G5 passes.

## Participating Agents

Implementation Planner (plan owner); applicable Backend, Frontend, Mobile, and Infrastructure Engineers; QA consulted for testability; Lead Architect coordinates.

## Execution Order

1. Inspect repository conventions and map all criteria to work.
2. Produce implementation plan, execution DAG, risks, migrations, validation, and rollback.
3. Review plan and record G3.
4. Create minimal context packages per implementer.
5. Implement in dependency order; use isolated parallel branches only where safe.
6. Integrate contract boundaries and resolve planned migrations.
7. Run component-level checks and map diff to plan/spec.
8. Record deviations and G5.

## Parallel Activities

Independent surfaces MAY run in parallel only after contracts freeze and no shared file/state is written. Contract producers precede dependent consumers unless compatible fixtures are approved.

## Validation Gates

G3 before code changes; G5 requires complete plan mapping, clean relevant checks, no unapproved deviation, and migration/rollback evidence.

## Escalation Conditions

Spec ambiguity, unplanned contract/architecture/dependency change, destructive migration, security issue, new material dependency, or unrelated worktree collision.

## Artifacts Produced

Implementation Plan, context manifests, code/config/test changes, migration/rollback evidence, implementation reports, deviation log.

## Failure Handling

Stop affected branch, preserve evidence, revert only task-owned changes when authorized, and return ambiguity to the originating gate. Never patch the spec through code.

## Restart Conditions

After failed checks, restart affected work item. After spec/contract/foundation changes, rerun pre-flight and re-plan all invalidated items.
