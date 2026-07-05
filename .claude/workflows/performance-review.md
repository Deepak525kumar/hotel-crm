# Performance Review Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently assess whether a frozen candidate meets defined performance and scalability constraints before approval.
- **Metric:** All applicable performance-checklist criteria evaluated; performance component of G4, measurements, and capacity assumptions recorded.
- **Boundary:** One immutable candidate version; the reviewer does not edit; semantic fix creates a new version and impact-based re-review, at most three cycles (§3).
- **Retry policy:** Restart affected checklist sections after fixes; full restart on workload/topology/budget change ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** No unresolved critical/high finding and no unbounded behavior or capacity assumption left invisible.
- **Failure condition:** No approved budget, material capacity cost, correctness tradeoff, or unresolved regression → escalate.
- **Confidence threshold:** `High` for any blocking finding; measurements distinguished from projections.

## Purpose

Independently assess whether a frozen candidate meets defined performance and scalability constraints before it is approved.

## Entry Conditions

Review input version is frozen; workload/SLO evidence, current baselines, target budgets, and a reproducible environment are available; reviewer did not author input.

## Exit Conditions

All checklist criteria are evaluated; findings are resolved or block progress; performance review status, measurements, and capacity assumptions are recorded.

## Participating Agents

Performance Reviewer (owner); author for fixes; Lead Architect/human for workload facts; Infrastructure and Release agents for capacity implications.

## Execution Order

1. Confirm immutable input and applicable budgets.
2. Identify affected hot paths, data cardinality, runtime topology, and representative workloads.
3. Execute performance checklist.
4. Require measurements where static evidence is insufficient.
5. Record independent findings distinguishing measurements from projections.
6. Author resolves accepted findings.
7. Re-review changed/affected criteria and issue final recommendation.

## Parallel Activities

May run alongside architecture, dependency, consistency, and security reviews against the same candidate; initial conclusions remain independent.

## Validation Gates

Performance component of G4 passes with no unresolved critical/high finding and no unbounded behavior or capacity assumption left invisible.

## Escalation Conditions

No approved budget, production-like testing requires authority, material capacity cost, correctness tradeoff, or unresolved regression.

## Artifacts Produced

Performance Review, checklist record, measurement plan/results, bottleneck findings, capacity notes, gate recommendation.

## Failure Handling

Return findings to author; do not edit the artifact. Semantic fixes create a new candidate version and impact-based re-review.

## Restart Conditions

Restart full review after workload/topology/budget changes; otherwise restart affected checklist sections.
