# Blockers Register

| Field | Value |
|---|---|
| Purpose | Execution-layer register of open impediments to phase/epic progress |
| Sources | [IMPLEMENTATION_PHASES.md — Phase Gate Summary](../04-implementation/IMPLEMENTATION_PHASES.md#phase-gate-summary), [IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md) prerequisites, [Specification Issues Register](../../.claude/governance/SPECIFICATION_ISSUES_REGISTER.md) |
| Status | Active |
| Last verified against repository state | 2026-07-17 (BLK-004's Critical leaderboard-authz component resolved in code by Sprint 0 S0-5; blocker remains OPEN on the Medium + reserved-human G2. Other 9 blockers unchanged since the 2026-07-16 full re-check.) |

This register tracks **execution blockers** — things stopping a phase or epic from moving to its
next status in [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). It does not restate or
resolve open specification questions (`OQ-*`, `OD-*`, `SIR-*`) — those are owned by the
[Specification Issues Register](../../.claude/governance/SPECIFICATION_ISSUES_REGISTER.md) and the
relevant module specs; this register only tracks that they are currently blocking, and links to
where they are actually resolved.

Fields: **ID · Blocks · Description · Resolution owner · Linked issue · Status**. Status values:
`OPEN` · `ESCALATED` · `RESOLVED`.

## Open Blockers

| ID | Blocks | Description | Resolution owner | Linked reference | Status |
|---|---|---|---|---|---|
| BLK-001 | First G5 sign-off (any epic) | No accountable owners assigned yet for modules/contracts/state domains; CODEOWNERS not created | Human (reserved authority, EPIC-OWNERSHIP) | [Backlog §EPIC-OWNERSHIP](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-ownership--accountable-owner-assignment-governance) | OPEN |
| BLK-002 | Phase 2 entry (EPIC-HOTELWORKERS) | `backend-hotel-workers` has no specification yet — must be authored and G2-frozen before the epic can start | Requirements Analyst / Module Author | [Backlog §EPIC-HOTELWORKERS](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-hotelworkers--worker-roster) | OPEN |
| BLK-003 | Phase 3 entry (EPIC-CALENDAR, critical path) | `SPEC-CALENDAR-001` requires G2 freeze — highest sequencing priority; blocks EPIC-JOBDISPATCH target-state and the whole pivot spine | Human approver (G2) | [Backlog §EPIC-CALENDAR](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-calendar--scheduling--calendarentry--scheduling-adr-011--pivot-foundation) | OPEN |
| BLK-004 | Phase 5 entry (EPIC-ANALYTICS) | `SPEC-ANALYTICS-001` freeze blocked by security FAIL (1 Critical/1 Medium); the Critical leaderboard-authz defect (= Sprint 0 item S0-5) is **RESOLVED in code 2026-07-17** (see `SIR-ANLY-001`), leaving only the Medium `OQ-ANALYTICS-11` cross-module-read decision (`SIR-GLOB-010`) plus reserved-human G2 approval | Human approver (G2) — code prerequisite (EPIC-SECREM Critical) satisfied | [Backlog §EPIC-ANALYTICS](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-analytics--aggregation--reporting) | OPEN — Critical closed; Medium + G2 remain |
| BLK-005 | Phase 6 entry (EPIC-DOCUMENTS) | G2 freeze blocked by OD-DOC-005 (permission-half) + OD-DOC-007 — no document-level RBAC model resolved | Human approver (Decision Record) | [Backlog §EPIC-DOCUMENTS](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-documents--document-storage) | OPEN |
| BLK-006 | Phase 6 entry (EPIC-CONSENT) | Owner assignment + 11 open decisions (SIR-CONSENT-001..011) unresolved | Human approver + EPIC-OWNERSHIP | [Backlog §EPIC-CONSENT](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-consent--consent-lifecycle--adr-015) | OPEN |
| BLK-007 | Phase 7 entry (EPIC-CHATBOT) | G2 freeze blocked by OD-CHAT-005 (conversation RBAC) + OD-CHAT-006 (prompt-injection guardrail) — unresolved decisions | Human approver (Decision Record) | [Backlog §EPIC-CHATBOT](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-chatbot--ai-capability--adr-013) | OPEN |
| BLK-008 | Phase 7 entry (EPIC-GEO) | G2 freeze blocked by OD-GEO-001/002 (ownership split) + owner assignment | Human approver (Decision Record) + EPIC-OWNERSHIP | [Backlog §EPIC-GEO](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-geo--geo-services) | OPEN |
| BLK-009 | Phase 1 exit (EPIC-AUTH release-prereqs) | 4 High findings + absent MFA must close with regression tests before Phase 1 exit | backend-engineer (EPIC-AUTH) | [Backlog §EPIC-AUTH](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-auth--authentication--access--frozen) | OPEN |
| BLK-010 | Phase 4 entry readiness | Mobile location-permission scaffolding must be ready (begun in Phase 1) before geofenced Start/Close can build | mobile-engineer | [Backlog §EPIC-ATTENDANCE](../04-implementation/IMPLEMENTATION_BACKLOG.md#epic-attendance--geofenced-presence--frozen) | OPEN |

## Sprint-Scoped Blockers

None recorded yet for Sprint 0. Log any impediment to an item in
[CURRENT_SPRINT.md](CURRENT_SPRINT.md) here as it arises, with an ID continuing the sequence
above.

## Resolution Protocol

A blocker moves to `RESOLVED` only when its linked reference (spec freeze record, Decision Record,
or governance register entry) shows the resolution — this register records the fact, it is never
the authority that resolves it. On resolution, update the corresponding row in
[IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) and log the change in
[CHANGELOG.md](CHANGELOG.md).
