# Current Sprint

| Field | Value |
|---|---|
| Sprint | **Sprint 0 — Foundation & Enablement** |
| Maps to | [IMPLEMENTATION_PHASES.md — Phase 0](../04-implementation/IMPLEMENTATION_PHASES.md#phase-0--foundation--enablement) (goal, entry/exit gate defined there — not restated here) |
| Epics in scope | EPIC-PLATFORM, EPIC-SECREM (immediate portion), EPIC-OWNERSHIP — see [IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md#cross-cutting-epics) |
| Milestone | M0 — Enablement |
| Status | Open |
| Out of scope | Auth/job-dispatch/attendance release-prereqs under EPIC-SECREM — staged into their owning epics (Phases 1, 3, 4) per the backlog |

This file tracks execution state only: status, owner, issue/PR, blocker. Every item's deliverable
and acceptance criteria are defined once, in the linked `EPIC-PLATFORM`/`EPIC-SECREM`/`EPIC-OWNERSHIP`
entries of [IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md); they are not
restated here.

## Sprint Backlog

| # | Item | Epic | Status | Owner | Issue/PR | Blocker |
|---|---|---|---|---|---|---|
| S0-1 | [CI blocking checks, per workspace](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | EPIC-PLATFORM | DONE | Infrastructure Engineer | [#154](https://github.com/Deepak525kumar/hotel-crm/pull/154) | — |
| S0-2 | [Migration + rollback harness](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | EPIC-PLATFORM | DONE | Infrastructure Engineer | — | — |
| S0-3 | [Observability baseline](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | EPIC-PLATFORM | DONE | Infrastructure Engineer | _PR pending_ | — |
| S0-4 | [Feature-flag mechanism (pivot cutover)](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | EPIC-PLATFORM | DONE | Infrastructure Engineer | _PR pending_ | — |
| S0-5 | [Analytics leaderboard authz hotfix](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-secrem--security-release-prerequisite-remediation) | EPIC-SECREM | DONE | Backend Engineer | [#157](https://github.com/Deepak525kumar/hotel-crm/pull/157) | — |
| S0-6 | [Regression test for S0-5](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-secrem--security-release-prerequisite-remediation) | EPIC-SECREM | DONE | Backend Engineer | _PR pending_ | — |
| S0-7 | [Owner assignment + CODEOWNERS](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-ownership--accountable-owner-assignment-governance) | EPIC-OWNERSHIP | NOT_STARTED | Human (reserved authority) | — | [BLK-001](BLOCKERS.md) (this item *is* the resolution) |

## Definition of Done

Sprint 0 closes when the Phase 0 exit gate is met with evidence and
[IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) records Phase 0 as `G5_PASSED`. Update this
file's status/owner/issue-PR columns as items move; log the transition in
[CHANGELOG.md](CHANGELOG.md).
