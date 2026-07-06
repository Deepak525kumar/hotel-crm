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

## Execution Graph

```
Lead Architect (dispatch)
  ↓ immutable ART-SPEC-001 v0.n (or diff) + workload/SLO evidence + baselines + budgets + reproducible env
Performance Reviewer — confirm immutable input and applicable budgets
  ↓
Performance Reviewer — identify affected hot paths, data cardinality, runtime topology, representative workloads
  ↓
Performance Reviewer — execute performance checklist; require measurements where static evidence is insufficient
  ↓
Performance Reviewer — record findings distinguishing measurements from projections
  ↓ ART-PERF-REV-001 v0.n (checklist record + measurement plan/results + bottleneck findings + capacity notes + gate recommendation)
Author — resolve accepted findings; produce new candidate version
  ↓ ART-SPEC-001 v0.n+1
Performance Reviewer — re-review changed/affected criteria (impact-based)
  ↓ (repeat; retry bound: 3 cycles)
Lead Architect — record performance component of G4; forward capacity notes to Infrastructure/Release
```

## Execution Order

1. Confirm immutable input and applicable budgets.
2. Identify affected hot paths, data cardinality, runtime topology, and representative workloads.
3. Execute performance checklist.
4. Require measurements where static evidence is insufficient.
5. Record independent findings distinguishing measurements from projections.
6. Author resolves accepted findings.
7. Re-review changed/affected criteria and issue final recommendation.

## Agent I/O Contracts

### Performance Reviewer

- **Inputs:** Immutable `ART-SPEC-001` v0.n (or frozen diff); workload/SLO evidence; current baselines; target budgets; reproducible environment; performance checklist.
- **Outputs:** `ART-PERF-REV-001` — checklist record + measurement plan/results + bottleneck findings + capacity notes + gate recommendation bound to the reviewed version.
- **Next Consumer:** Lead Architect (G4 merge; capacity forwarding); author (correction); Infrastructure/Release for capacity implications.

### Lead Architect / Human (workload facts)

- **Inputs:** Workload/SLO ambiguity questions.
- **Outputs:** Confirmed workload/SLO facts referenced by `ART-PERF-REV-001` (never invented by the reviewer).
- **Next Consumer:** Performance Reviewer.

### Author (correction step)

- **Inputs:** Only accepted `ART-PERF-REV-001` findings.
- **Outputs:** Revised `ART-SPEC-001` v0.n+1 with dispositions and, where applicable, updated measurements.
- **Next Consumer:** Performance Reviewer (impact-based re-review).

### Lead Architect

- **Inputs:** Final `ART-PERF-REV-001`.
- **Outputs:** Performance component of G4; capacity implications forwarded to Infrastructure Engineer and Release Manager.
- **Next Consumer:** Parent workflow's G4 record; infrastructure implementation planning; release readiness.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-PERF-REV-001` (v0.n) | Performance Reviewer | immutable candidate + workload/SLO evidence + baselines + budgets | checklist + measurements/projections + bottlenecks + capacity notes | Lead Architect (G4); author (fixes); Infrastructure/Release |
| Revised candidate | Author | `ART-PERF-REV-001` findings | new version + dispositions + updated measurements | Performance Reviewer (re-review) |
| G4-performance record | Lead Architect | final `ART-PERF-REV-001` | performance component of G4 + capacity forwarding | Parent workflow's G4 record; Infrastructure/Release |

## Synchronization Points

- Parent-workflow join: `SYNC-doc-1` (or the equivalent join in the dispatching workflow). Performance Reviewer submits `ART-PERF-REV-001` independently and does not wait for other reviewers.
- Retry-cycle re-review starts only after the author produces `ART-SPEC-001` v0.n+1.

## Context Packages

### Performance Reviewer receives

- Immutable candidate at the exact reviewed version.
- Workload/SLO evidence and current baselines for the affected hot paths only.
- Target budgets from the applicable specification or ADR.
- Reproducible environment identifiers and access commands.
- Performance checklist.
- Explicit exclusion of unrelated code paths and other reviewers' in-flight findings.

### Lead Architect / Human receives (workload-facts step)

- Single ambiguity question; the specific SLO or workload artifact in question.

### Author receives (correction step)

- Only accepted `ART-PERF-REV-001` findings and measurement requirements; environment identifiers when measurements must be rerun.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: performance-review`
- `Current Gate: G4-performance`
- `Current Agent: Performance Reviewer` (or author during correction; Lead Architect/human when awaiting workload facts).
- `Completed`: closed `ART-PERF-REV-001` versions.
- `Waiting On`: workload fact from human/Lead Architect; measurement rerun; revised candidate.
- `Blockers`: no approved budget; material capacity cost; correctness tradeoff; unresolved regression.
- `Next Action`: re-review, capacity forwarding, or G4 record.

## Parallel Activities

May run alongside architecture, dependency, consistency, and security reviews against the same candidate; initial conclusions remain independent.

## Validation Gates

Performance component of G4 passes with no unresolved critical/high finding and no unbounded behavior or capacity assumption left invisible.

### Required Inputs → Produced Outputs

- **G4-performance** inputs: final `ART-PERF-REV-001` with checklist evidence, measurement plan/results, and capacity notes bound to the reviewed candidate version.
- **G4-performance** outputs: performance-component gate status; capacity notes forwarded to Infrastructure Engineer and Release Manager; findings merged into the parent workflow's G4 record.

## Escalation Conditions

No approved budget, production-like testing requires authority, material capacity cost, correctness tradeoff, or unresolved regression.

## Artifacts Produced

Performance Review, checklist record, measurement plan/results, bottleneck findings, capacity notes, gate recommendation.

## Failure Handling

Return findings to author; do not edit the artifact. Semantic fixes create a new candidate version and impact-based re-review.

## Restart Conditions

Restart full review after workload/topology/budget changes; otherwise restart affected checklist sections.
