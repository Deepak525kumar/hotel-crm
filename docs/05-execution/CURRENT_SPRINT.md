# Current Sprint

| Field | Value |
|---|---|
| Sprint | **Sprint 0 — Foundation & Enablement** |
| Maps to | [IMPLEMENTATION_PHASES.md — Phase 0](../04-implementation/IMPLEMENTATION_PHASES.md#phase-0--foundation--enablement) |
| Epics in scope | EPIC-PLATFORM, EPIC-SECREM (immediate portion), EPIC-OWNERSHIP — see [IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md#cross-cutting-epics) |
| Milestone | M0 — Enablement |
| Status | Open |

## Sprint Goal

Make the repository safe to change at scale — gates, migrations, observability, feature flags,
the already-shipped security defects, and accountable ownership — before any business-logic epic
(Phase 1+) opens. Verbatim entry/exit gate is defined once in
[IMPLEMENTATION_PHASES.md](../04-implementation/IMPLEMENTATION_PHASES.md#phase-0--foundation--enablement)
and is not restated here beyond the summary below.

**Exit gate (from Phase 0):** CI runs the full gate harness on every PR; migration+rollback
harness proven on a no-op migration; observability baseline live; EPIC-SECREM deployed defects
closed with regression tests; feature-flag mechanism exists; owners assigned (or escalation on
record).

## Sprint Backlog

Each item links to its full deliverable/acceptance-criteria definition in the backlog — this
sprint file tracks only what is in/out of the current iteration and its status.

| # | Item | Epic | Source | Status |
|---|---|---|---|---|
| S0-1 | CI pipeline: `npm run type-check`, `npm run build`, `npm test` as blocking checks, per workspace (backend/frontend/mobile) | EPIC-PLATFORM | [Backlog §EPIC-PLATFORM](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | NOT_STARTED |
| S0-2 | Prisma migration + rollback harness; production-shaped snapshot for dry-runs (ADR-004/005) | EPIC-PLATFORM | [Backlog §EPIC-PLATFORM](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | NOT_STARTED |
| S0-3 | Observability baseline (structured logs via existing `requestLoggerMiddleware`, error tracking, health checks) | EPIC-PLATFORM | [Backlog §EPIC-PLATFORM](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | NOT_STARTED |
| S0-4 | Feature-flag mechanism for the pivot cutover (marketplace ↔ direct-dispatch) | EPIC-PLATFORM | [Backlog §EPIC-PLATFORM](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-platform--foundation--enablement) | NOT_STARTED |
| S0-5 | Guard `GET /analytics/leaderboard` and `/by-hotel/:hotel_id` with `requireRole`/`checkHotelAccess` (OQ-ANALYTICS-01, Critical, live data-exposure defect) | EPIC-SECREM | [Backlog §EPIC-SECREM](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-secrem--security-release-prerequisite-remediation) | NOT_STARTED |
| S0-6 | Security-regression test for S0-5 | EPIC-SECREM | [Backlog §EPIC-SECREM](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-secrem--security-release-prerequisite-remediation) | NOT_STARTED |
| S0-7 | Assign accountable owners for every module, shared contract, and state domain; create CODEOWNERS; confirm `state-user` writer split (ADR-017) reflected operationally | EPIC-OWNERSHIP | [Backlog §EPIC-OWNERSHIP](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-ownership--accountable-owner-assignment-governance) | NOT_STARTED |

**Explicitly out of scope for Sprint 0:** the auth (4 High + MFA), job-dispatch
(`PATCH /assignments/:id` + 2 High), and attendance cross-tenant scoping release-prereqs under
EPIC-SECREM — these are staged into their owning epics (Phase 1, 3, 4 respectively) per the
backlog and are not Sprint 0 items.

## Parallelization

Per the backlog, S0-1 ∥ S0-2 ∥ S0-3 ∥ S0-4 (EPIC-PLATFORM's four workstreams are independent);
S0-5/S0-6 (analytics hotfix) run ∥ everything; S0-7 (ownership) is off the code path and runs ∥
all Phase 0 code work.

## Definition of Done for This Sprint

Sprint 0 closes only when the Phase 0 exit gate above is met with evidence and
[IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) records Phase 0 as `G5_PASSED`. Update
[PROGRESS.md](PROGRESS.md) and [CHANGELOG.md](CHANGELOG.md) on every item completion; log any
impediment in [BLOCKERS.md](BLOCKERS.md) rather than silently slipping the item.
