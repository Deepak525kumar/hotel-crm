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
execution status and owner.

| Epic | Phase | Status | Owner | Notes / current blocker |
|---|---|---|---|---|
| EPIC-PLATFORM | 0 | IN_PROGRESS | *unassigned — see [BLOCKERS.md](BLOCKERS.md)* | Sprint 0 scope; see [CURRENT_SPRINT.md](CURRENT_SPRINT.md) |
| EPIC-SECREM | 0 | IN_PROGRESS | *unassigned — see [BLOCKERS.md](BLOCKERS.md)* | Analytics leaderboard hotfix is the immediate, independent item |
| EPIC-OWNERSHIP | 0 | IN_PROGRESS | Human (reserved authority) | Blocking for first G5 sign-off across all epics |
| EPIC-AUTH | 1 | NOT_STARTED | — | Spec FROZEN; waiting on Phase 0 exit |
| EPIC-USERS | 1 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-USERS-001` |
| EPIC-CRM | 2 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-CRM-001` |
| EPIC-HOTELWORKERS | 2 | NOT_STARTED | — | No spec exists yet — critical-path risk (see [BLOCKERS.md](BLOCKERS.md)) |
| EPIC-NOTIFICATIONS | 2 (contract) / 5 (internals) | NOT_STARTED | — | `PRE: G2 freeze of SPEC-NOTIF-001` |
| EPIC-CALENDAR | 3 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-CALENDAR-001` — highest sequencing priority |
| EPIC-JOBDISPATCH | 3 | NOT_STARTED | — | Spec FROZEN; hard prerequisite on EPIC-CALENDAR |
| EPIC-ATTENDANCE | 4 | NOT_STARTED | — | Spec FROZEN; prerequisite on EPIC-JOBDISPATCH target state |
| EPIC-QUALITY | 4 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-QUAL-001` (pending OQ-01) |
| EPIC-ANALYTICS | 5 | NOT_STARTED | — | Freeze blocked by security FAIL until EPIC-SECREM leaderboard fix lands |
| EPIC-HR | 6 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-HR-001` |
| EPIC-ONBOARDING | 6 | NOT_STARTED | — | `PRE: G2 freeze` of onboarding spec |
| EPIC-EMPLOYEE | 6 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-EMP-001` |
| EPIC-DOCUMENTS | 6 | NOT_STARTED | — | Blocked by OD-DOC-005/007 RBAC decisions |
| EPIC-CONSENT | 6 | NOT_STARTED | — | Blocked by owner assignment + SIR-CONSENT-001..011 |
| EPIC-COMPLIANCE | 6 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-COMPLIANCE-001` |
| EPIC-RETENTION | 6 | NOT_STARTED | — | `PRE: G2 freeze of SPEC-RETENTION-001` |
| EPIC-CHATBOT | 7 | NOT_STARTED | — | Blocked by OD-CHAT-005/006 decisions |
| EPIC-GEO | 7 | NOT_STARTED | — | Blocked by OD-GEO-001/002 ownership split |
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
