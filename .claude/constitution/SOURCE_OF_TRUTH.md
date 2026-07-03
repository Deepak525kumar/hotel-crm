# Source of Truth Resolution

## Purpose

Provide a deterministic method for deciding what is known, intended, historical, proposed, or unresolved. This procedure applies before planning, authoring, review, implementation, and release.

## Authority Hierarchy

| Rank | Source | What it proves | Qualification |
|---:|---|---|---|
| 1 | Current repository | Present worktree content and reproducible behavior | Dirty changes may be unapproved; record ownership |
| 2 | Current default branch | Latest integrated baseline | Fetch state and revision must be known |
| 3 | Latest merged authoritative documentation | Approved integrated intent | Must be designated current, not legacy |
| 4 | Frozen specifications | Approved target behavior | May intentionally differ from current code |
| 5 | Open pull requests | Proposed unmerged change | Never treated as integrated |
| 6 | Project memory | Maintained summaries and indexes | Must cite revision-bound sources |
| 7 | Previous conversations | Context and candidate intent | Requires repository or human confirmation |

Safety constraints and explicit current human decisions govern above this evidence hierarchy. The hierarchy does not mean current buggy code defines desired behavior: code proves **current state**, while an approved frozen specification proves **target state**. Their mismatch is drift, not permission to choose silently.

## Source Classification

Classify every material source:

- **Authoritative:** designated source for a fact or decision.
- **Corroborating:** supports but does not define truth.
- **Proposed:** unapproved intended change.
- **Historical:** useful provenance; not current intent.
- **Generated:** derived and replaceable; source generator is authoritative.
- **External:** standards, vendor docs, or services; record version/date.
- **Unknown:** authority cannot be established.

Paths containing `legacy`, `archive`, `deprecated`, examples, fixtures, caches, or generated output default to non-authoritative until explicitly promoted.

## Resolution Algorithm

1. Define the exact question and fact type: current behavior, desired behavior, ownership, contract, dependency, or decision.
2. Capture repository identity: root, branch, `HEAD`, default branch, worktree status, and relevant remotes.
3. Locate candidate sources across code, tests, active docs, frozen specs, PRs, knowledge records, and conversation.
4. Classify each source and record path/revision/date.
5. Compare sources within the applicable hierarchy rank.
6. Prefer direct, current, reproducible evidence over summaries at the same rank.
7. Separate current-state findings from target-state decisions.
8. If a lower-ranked source conflicts, mark it stale or proposed and create a synchronization item.
9. If same-rank authoritative sources conflict, set status `BLOCKED_CONFLICT` and escalate.
10. Record the result in an evidence ledger and bind it to a revision.

## Evidence Ledger

Every plan, review, and validation report MUST include:

| Field | Required value |
|---|---|
| Claim ID | Stable local identifier |
| Claim | One testable statement |
| Fact type | Current / target / ownership / contract / dependency / decision |
| Status | Confirmed / inferred / proposed / unknown / conflicting |
| Source | Path plus line, revision, command, or decision ID |
| Authority class | Authoritative / corroborating / proposed / historical / generated / external |
| Checked at | ISO-8601 timestamp or revision |
| Notes | Limitations or contradiction |

Only `Confirmed` claims may become implementation inputs. `Inferred` claims require confirmation; `Unknown` and `Conflicting` claims block affected acceptance criteria.

## Default Branch and Remote Failure

If the default branch cannot be verified remotely, use the local remote HEAD only as provisional evidence and mark synchronization incomplete. Offline work may continue only where the result cannot change the decision; merge or release readiness remains blocked.

## Conflict Report

A conflict report contains:

- question being resolved;
- each source and authority classification;
- current-state versus target-state interpretation;
- affected requirements, modules, and gates;
- reversible options;
- requested human decision.

No agent resolves a product, architecture, ownership, or constitutional conflict merely by majority of documents.
