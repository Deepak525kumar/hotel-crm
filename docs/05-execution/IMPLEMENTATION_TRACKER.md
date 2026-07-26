# Implementation Tracker — Workforce Operations Platform

| Field | Value |
|---|---|
| Artifact ID | `ART-EXEC-001` (Implementation Tracker) |
| Layer | Execution (operational) — tracks, does not redefine, planning artifacts |
| Sources of record | [ART-PLAN-001 — Implementation Master Plan](../04-implementation/IMPLEMENTATION_MASTER_PLAN.md), [Implementation Backlog](../04-implementation/IMPLEMENTATION_BACKLOG.md), [Implementation Phases](../04-implementation/IMPLEMENTATION_PHASES.md), [Implementation Dependency Graph](../04-implementation/IMPLEMENTATION_DEPENDENCY_GRAPH.md) |
| Planning baseline revision | `09e0b162297162c8a93975ce55ccd3c406218606` (as declared by ART-PLAN-001 and its companions) |
| Execution layer opened at revision | `cde1d141d436bf26960d21758dcc44a20fb5acc1` |
| Status | Active |

## Purpose

This tracker is the single place that records **execution state** — what phase/epic is open,
in progress, blocked, or done — against the plan already frozen in `docs/04-implementation/`.
It does not restate deliverables, acceptance criteria, dependencies, or gate requirements; those
remain authoritative in the linked planning artifacts. Each row below links to its epic's full
definition in [IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md) and its
phase's entry/exit gates in [IMPLEMENTATION_PHASES.md](../04-implementation/IMPLEMENTATION_PHASES.md).

**Reconciliation note (2026-07-27):** `ADR-030` (Manager Write-Authority Capability Model,
Accepted 2026-07-25/26) and `ADR-031` (Request-Time Permission Derivation, Token-Generation
Revocation, and Auth Rate-Limiting, Accepted 2026-07-26/27) both shipped substantial `backend-auth`/
`backend-users` work — capability-based authorization, `REGIONAL_MANAGER` role, request-time
permission derivation, session/token revocation, edge rate limiting, session sweep — entirely
through the governance-decision (`GD-*`) track in
[`docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md)
(`GD-02`/`GD-03`/`GD-07`, each marked ✅ Accepted with its own PR-0..PR-8 sequence), **not** through
this tracker's Phase 1 `EPIC-AUTH`/`EPIC-USERS` rows below. Those rows' `NOT_STARTED` status is
accurate for *this tracker's own deliverable list* (a different, earlier planning artifact,
`docs/04-implementation/IMPLEMENTATION_BACKLOG.md`) — it does not mean no authorization work has
happened; it means that specific backlog item hasn't been picked up under this tracker. Anyone
checking whether authorization/session-revocation work is done should consult
`GOVERNANCE_DECISIONS_REQUIRED.md`'s `GD-02`/`GD-03`/`GD-07` rows, not this file, until a future
pass reconciles the two planning layers (out of scope for this note).

Status values: `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `G5_PASSED` · `G8_CLOSED`.

Update this file as an exit condition of the [Implementation](../../.claude/workflows/implementation.md)
and [Post-flight](../../.claude/workflows/postflight.md) workflows whenever an epic's status changes.
Do not edit `docs/04-implementation/` to record execution state.

## Phase Tracker

| Phase | Milestone | Entry gate | Exit gate | Status | Epics (see backlog for detail) |
|---|---|---|---|---|---|
| 0 — Foundation & Enablement | M0 | G0 pass | Harness + SECREM + owners (see [Phases](../04-implementation/IMPLEMENTATION_PHASES.md#phase-0--foundation--enablement)) | IN_PROGRESS | EPIC-PLATFORM, EPIC-SECREM, EPIC-OWNERSHIP |
| 1 — Identity & Access Core | M1 | Phase 0 exit; SPEC-AUTH-001 FROZEN | G5 pass | NOT_STARTED | EPIC-AUTH, EPIC-USERS |
| 2 — Organizational Core | M2 | Phase 1 exit; SPEC-CRM-001 G2 | G5 pass | NOT_STARTED | EPIC-CRM, EPIC-HOTELWORKERS, EPIC-NOTIFICATIONS (contract) |
| 3 — Pivot Spine: Calendar & Direct Dispatch | M3 | Phase 2 exit; SPEC-CALENDAR-001 G2 | G5 + rollback proof | NOT_STARTED | EPIC-CALENDAR, EPIC-JOBDISPATCH |
| 4 — Presence & Quality | M4 | Phase 3 exit; SPEC-QUAL-001 G2 | G5 pass | NOT_STARTED | EPIC-ATTENDANCE, EPIC-QUALITY |
| 5 — Insight & Engagement | M5 | Phase 4 exit; SPEC-ANALYTICS-001 G2 + fix | G5 pass | NOT_STARTED | EPIC-ANALYTICS, EPIC-NOTIFICATIONS (internals) |
| 6 — Workforce Lifecycle & GDPR | M6 | Phase 1 exit minimum; per-sub-spec G2 | G5 pass × 7 | NOT_STARTED | EPIC-HR, EPIC-ONBOARDING, EPIC-EMPLOYEE, EPIC-DOCUMENTS, EPIC-CONSENT, EPIC-COMPLIANCE, EPIC-RETENTION |
| 7 — Assistive & Geo | M7 | SPEC-CHATBOT-001 + SPEC-GEO-001 G2 | G5 pass | NOT_STARTED | EPIC-CHATBOT, EPIC-GEO |
| Continuous — Clients | n/a | per-contract freeze | n/a | NOT_STARTED | EPIC-FE-WEB, EPIC-MOBILE-WORKER, EPIC-MOBILE-CHECKER |

Full phase entry/exit gate text, backend/frontend/mobile sequences, and the critical-path blocker
per phase are defined once in [IMPLEMENTATION_PHASES.md](../04-implementation/IMPLEMENTATION_PHASES.md)
(see its **Phase Gate Summary** table) and are not duplicated here.

## Epic Tracker

Each epic's prerequisites, deliverables, dependencies, and acceptance criteria are defined in
[IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md); this table only tracks
execution status, owner, and — where one is open — the tracking blocker ID. A blocker's full
description lives once in [BLOCKERS.md](BLOCKERS.md); it is not restated here.

| Epic | Phase | Status | Owner | Blocker |
|---|---|---|---|---|
| EPIC-PLATFORM | 0 | IN_PROGRESS | unassigned | [BLK-001](BLOCKERS.md); scope in [CURRENT_SPRINT.md](CURRENT_SPRINT.md) |
| EPIC-SECREM | 0 | IN_PROGRESS | unassigned | [BLK-001](BLOCKERS.md); scope in [CURRENT_SPRINT.md](CURRENT_SPRINT.md) |
| EPIC-OWNERSHIP | 0 | IN_PROGRESS | Human (reserved authority) | [BLK-001](BLOCKERS.md) |
| EPIC-AUTH | 1 | NOT_STARTED | — | Phase 0 exit; release-prereqs [BLK-009](BLOCKERS.md). See reconciliation note above — `ADR-030`/`ADR-031` shipped authorization/revocation work via `GD-02`/`GD-07`, tracked outside this row. |
| EPIC-USERS | 1 | NOT_STARTED | — | PRE: SPEC-USERS-001 G2 (backlog). See reconciliation note above — `ADR-030` shipped write-authority work via `GD-02`/`GD-03`, tracked outside this row. |
| EPIC-CRM | 2 | NOT_STARTED | — | PRE: SPEC-CRM-001 G2 (backlog) |
| EPIC-HOTELWORKERS | 2 | NOT_STARTED | — | [BLK-002](BLOCKERS.md) |
| EPIC-NOTIFICATIONS | 2 (contract) / 5 (internals) | NOT_STARTED | — | PRE: SPEC-NOTIF-001 G2 (backlog) |
| EPIC-CALENDAR | 3 | NOT_STARTED | — | [BLK-003](BLOCKERS.md) |
| EPIC-JOBDISPATCH | 3 | NOT_STARTED | — | Depends on EPIC-CALENDAR — [BLK-003](BLOCKERS.md) |
| EPIC-ATTENDANCE | 4 | NOT_STARTED | — | Depends on EPIC-JOBDISPATCH; [BLK-010](BLOCKERS.md) (mobile readiness) |
| EPIC-QUALITY | 4 | NOT_STARTED | — | PRE: SPEC-QUAL-001 G2 (backlog) |
| EPIC-ANALYTICS | 5 | NOT_STARTED | — | [BLK-004](BLOCKERS.md) |
| EPIC-HR | 6 | NOT_STARTED | — | PRE: SPEC-HR-001 G2 (backlog) |
| EPIC-ONBOARDING | 6 | NOT_STARTED | — | PRE: onboarding spec G2 (backlog) |
| EPIC-EMPLOYEE | 6 | NOT_STARTED | — | PRE: SPEC-EMP-001 G2 (backlog) |
| EPIC-DOCUMENTS | 6 | NOT_STARTED | — | [BLK-005](BLOCKERS.md) |
| EPIC-CONSENT | 6 | NOT_STARTED | — | [BLK-006](BLOCKERS.md) |
| EPIC-COMPLIANCE | 6 | NOT_STARTED | — | PRE: SPEC-COMPLIANCE-001 G2 (backlog) |
| EPIC-RETENTION | 6 | NOT_STARTED | — | PRE: SPEC-RETENTION-001 G2 (backlog) |
| EPIC-CHATBOT | 7 | NOT_STARTED | — | [BLK-007](BLOCKERS.md) |
| EPIC-GEO | 7 | NOT_STARTED | — | [BLK-008](BLOCKERS.md) |
| EPIC-FE-WEB | continuous | NOT_STARTED | — | Builds only against frozen contracts |
| EPIC-MOBILE-WORKER | continuous | NOT_STARTED | — | Builds only against frozen contracts |
| EPIC-MOBILE-CHECKER | continuous | NOT_STARTED | — | Builds only against frozen contracts |

## Completion Criteria (per phase)

A phase is `G5 pass` / closed only when its exit gate — verbatim in
[IMPLEMENTATION_PHASES.md](../04-implementation/IMPLEMENTATION_PHASES.md) — is met and evidenced.
This tracker records the outcome; it does not restate or relax the criteria. See
[PROGRESS.md](PROGRESS.md) for the aggregate view and [BLOCKERS.md](BLOCKERS.md) for anything
currently preventing a status change.

## Change Log

Status transitions in this tracker are recorded in [CHANGELOG.md](CHANGELOG.md); do not overwrite
history in the tables above — update status forward and let the changelog carry the "when/why."
