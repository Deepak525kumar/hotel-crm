# Progress

| Field | Value |
|---|---|
| Derived from | [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) (phase/epic status — authoritative), [CURRENT_SPRINT.md](CURRENT_SPRINT.md) (sprint item status — authoritative), [BLOCKERS.md](BLOCKERS.md) (blocker count — authoritative) |
| Status | This file holds no status of its own. Every number below is a roll-up; if a number and its source disagree, the source wins and this file is stale. |
| Last recomputed | 2026-07-17 |

## How Progress Is Measured

Per phase: `epics closed at G5 / epics in phase`, counted from the Epic Tracker in
[IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). Per sprint: `sprint items DONE / sprint
items total`, counted from [CURRENT_SPRINT.md](CURRENT_SPRINT.md). A percentage here is
informational only — a phase exits on the verbatim criteria in
[IMPLEMENTATION_PHASES.md](../04-implementation/IMPLEMENTATION_PHASES.md), never on a threshold.

## Milestone Progress

| Milestone | Phase | Epics closed / total | % |
|---|---|---|---|
| M0 — Enablement | 0 | 0 / 3 | 0% |
| M1 — Secured Identity | 1 | 0 / 2 | 0% |
| M2 — Organizational Core | 2 | 0 / 3 | 0% |
| M3 — Pivot GA | 3 | 0 / 2 | 0% |
| M4 — Presence & Quality | 4 | 0 / 2 | 0% |
| M5 — Insight | 5 | 0 / 2 | 0% |
| M6 — Workforce Lifecycle & GDPR | 6 | 0 / 7 | 0% |
| M7 — Assistive | 7 | 0 / 2 | 0% |
| Continuous — Clients | n/a | 0 / 3 | 0% |

Per-phase status (`IN_PROGRESS`/`NOT_STARTED`) is tracked once in
[IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md#phase-tracker) and not repeated here.

**Note (2026-07-27):** the `0%`/`NOT_STARTED` figures above do not reflect the substantial
authorization/authentication work completed via `ADR-030` and `ADR-031` (capability-based
write authority, request-time permission derivation, session/token revocation, edge rate
limiting) — that work rode the governance-decision (`GD-*`) track, not this tracker's Phase/Epic
model. See [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md)'s own reconciliation note and
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md)'s
`GD-02`/`GD-03`/`GD-07` rows for that work's actual, complete status.

## Sprint 0 Progress

**6 / 7 items done (86%).** Per-item status, owner, and issue/PR live only in
[CURRENT_SPRINT.md](CURRENT_SPRINT.md#sprint-backlog) — not duplicated here.

## Blockers Summary

**10 open, 0 escalated, 0 resolved** as of the last verification pass recorded in
[BLOCKERS.md](BLOCKERS.md). Full list, description, and resolution owner per blocker live only
there.

## Update Protocol

Recompute the counts above whenever [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md),
[CURRENT_SPRINT.md](CURRENT_SPRINT.md), or [BLOCKERS.md](BLOCKERS.md) changes. This file never
originates a status — it only counts what those three already say.
