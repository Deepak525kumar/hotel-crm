# Consistency Review Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently detect contradictions, duplicate authorities, terminology drift, and stale cross-references.
- **Metric:** Relevant artifacts agree or discrepancies are recorded as blocking findings/synchronization tasks; consistency component of G4 recorded.
- **Boundary:** One frozen candidate against canonical sources; the reviewer does not choose a winner without authority; at most three re-check cycles (§3).
- **Retry policy:** Restart affected comparisons after edits; full restart on canonical-source/terminology/scope change ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** One canonical source per concept and no unresolved material contradiction.
- **Failure condition:** Equal-authority conflict, no canonical term, or historical content presented as current → escalate to source owner/human.
- **Confidence threshold:** `High` for any blocking contradiction.

## Purpose

Independently detect contradictions, duplicate authorities, terminology drift, and stale cross-references.

## Entry Conditions

Frozen candidate and canonical terminology, active docs, rule sources, decisions, and indexes are available.

## Exit Conditions

Relevant artifacts agree or discrepancies are blocking findings/synchronization tasks; status is recorded.

## Participating Agents

Consistency Reviewer (owner); responsible authors; Lead Architect; human for semantic terminology decisions.

## Execution Graph

```
Lead Architect (dispatch)
  ↓ immutable ART-SPEC-001 v0.n (or diff) + TERMINOLOGY.md + active docs + rule sources + DECISION_INDEX + registries
Consistency Reviewer — identify candidate terms, IDs, rules, states, examples, references
  ↓
  ├─ (parallel) terminology comparison         (candidate vs TERMINOLOGY.md)
  ├─ (parallel) cross-reference resolution     (candidate vs referenced artifacts; deterministic checks — broken links,
  │                                             broken ADR/spec/governance/knowledge/implementation-execution references,
  │                                             broken cross-index references, duplicate authorities, missing canonical
  │                                             references, orphan documents — run via the single implementation at
  │                                             ../tooling/repository-integrity-check.js, producing ART-INTEGRITY-001;
  │                                             never re-derived by hand)
  └─ (parallel) rule/duplication comparison    (candidate vs canonical rule sources)
       ↓ SYNC-cons-1 (authority classification for each finding)
Consistency Reviewer — record contradictions, duplication, unresolved refs, stale dependents
  ↓ ART-CONS-REV-001 v0.n (terminology delta + cross-reference report + synchronization inventory + findings)
Author (source owner) — apply fixes or route to canonical decision
  ↓ ART-SPEC-001 v0.n+1 (and/or updated dependents)
Consistency Reviewer — re-check synchronized set
  ↓ (repeat; retry bound: 3 cycles)
Lead Architect — record consistency component of G4; route synchronization inventory to post-flight
```

## Execution Order

1. Identify candidate terms, IDs, rules, states, examples, and references.
2. Select canonical comparison sources by authority.
3. Compare related active artifacts and label historical/proposed content.
4. Record contradictions, duplication, unresolved references, and stale dependents.
5. Author fixes or canonical decision is escalated.
6. Re-check synchronized set and issue recommendation.

## Agent I/O Contracts

### Consistency Reviewer

- **Inputs:** Immutable `ART-SPEC-001` v0.n (or frozen diff); `TERMINOLOGY.md`; rule sources; `DECISION_INDEX.md`; active docs; `MODULE_REGISTRY.yaml`; `DEPENDENCY_GRAPH.yaml`; `ART-INTEGRITY-001` (run or reuse `../tooling/repository-integrity-check.js` at the candidate revision — never hand-derive what the deterministic tool already proves).
- **Outputs:** `ART-CONS-REV-001` — terminology delta + cross-reference report (citing `ART-INTEGRITY-001` for every deterministic broken-reference/duplicate-authority/orphan finding) + synchronization inventory + findings (canonical schema, each identifying both conflicting locations, authority class, canonical candidate if known, required sync set) + gate recommendation bound to the reviewed version.
- **Next Consumer:** Lead Architect (G4 merge; post-flight synchronization inventory); source owners for fixes; human for semantic terminology decisions.

### Author / Source owner (correction step)

- **Inputs:** Only the accepted `ART-CONS-REV-001` findings targeting their artifact.
- **Outputs:** Revised artifact version + dispositions.
- **Next Consumer:** Consistency Reviewer (re-check).

### Lead Architect

- **Inputs:** Final `ART-CONS-REV-001`.
- **Outputs:** Consistency component of G4; synchronization inventory routed to post-flight.
- **Next Consumer:** Parent workflow's G4 record; postflight.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-CONS-REV-001` (v0.n) | Consistency Reviewer | immutable candidate + canonical sources | terminology delta + cross-ref report + sync inventory + findings | Lead Architect (G4); source owners (fixes); postflight (sync inventory) |
| Revised artifact | Author / Source owner | `ART-CONS-REV-001` findings | new version + dispositions | Consistency Reviewer (re-check) |
| G4-consistency record | Lead Architect | final `ART-CONS-REV-001` | consistency component of G4 | Parent workflow's G4 record |

## Synchronization Points

- **SYNC-cons-1:** Consistency Reviewer waits until (a) terminology comparison, (b) cross-reference resolution, and (c) rule/duplication comparison branches all return before merging findings and classifying authority. Authority classification precedes recording contradictions — the reviewer never chooses a winner without it.
- Parent-workflow join: `SYNC-doc-1` (or the equivalent join in the dispatching workflow).

## Context Packages

### Consistency Reviewer receives

- Immutable candidate at the exact reviewed version.
- Canonical `TERMINOLOGY.md`; rule sources for the candidate's rules; `DECISION_INDEX.md`.
- Directly related active artifacts only; archives only when provenance is relevant.
- `MODULE_REGISTRY.yaml` and `DEPENDENCY_GRAPH.yaml` slices needed to resolve references.
- Explicit exclusion of other reviewers' in-flight findings.

### Author / Source owner receives (correction step)

- Only the accepted findings targeting their artifact and the reviewer's evidence citations; canonical source references where applicable.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: consistency-review`
- `Current Gate: G4-consistency`
- `Current Agent: Consistency Reviewer` (or source owner during correction).
- `Completed`: closed `ART-CONS-REV-001` versions.
- `Waiting On`: SYNC-cons-1; canonical decision from human/owner; re-check after fixes.
- `Blockers`: equal-authority conflict; no canonical term; historical content presented as current.
- `Next Action`: re-check, escalation, or G4 record.

## Parallel Activities

Terminology, cross-reference, and rule-duplication checks MAY run in parallel; conclusions merge only after authority classification.

## Validation Gates

Consistency component of G4 passes with one canonical source per concept and no unresolved material contradiction.

### Required Inputs → Produced Outputs

- **G4-consistency** inputs: final `ART-CONS-REV-001` with terminology delta, cross-reference report, and synchronization inventory bound to the reviewed candidate version.
- **G4-consistency** outputs: consistency-component gate status; synchronization inventory forwarded to post-flight for reconciliation.

## Escalation Conditions

Equal-authority conflict, no canonical term, semantic rename, unexpected synchronization scope, or historical content presented as current.

## Artifacts Produced

Consistency Review, terminology delta, cross-reference report, synchronization inventory, `ART-INTEGRITY-001` Repository Integrity Validation Report (produced by `../tooling/repository-integrity-check.js`; reused unchanged by G6 and G9, see [REVIEW_GATES.md](../constitution/REVIEW_GATES.md) Applicability Rules).

## Failure Handling

Do not choose a winner without authority. Block affected sections and route fixes to source owners.

## Restart Conditions

Restart affected comparisons after edits; restart full review after canonical source, terminology, or scope changes.
