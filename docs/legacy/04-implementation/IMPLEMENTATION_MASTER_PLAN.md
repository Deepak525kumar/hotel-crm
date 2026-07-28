# Implementation Master Plan — Workforce Operations Platform

| Field | Value |
|---|---|
| Artifact ID | `ART-PLAN-001` (Implementation Master Plan) |
| Workflow | Implementation Planning (`.claude/workflows/implementation.md`) |
| Gate target | **G3** (plan review) — this plan is the G3 candidate; it authorizes no code |
| Framework version | 1.3.0 (`.claude/VERSION.yaml`) |
| Baseline revision | `09e0b162297162c8a93975ce55ccd3c406218606` (`.claude/knowledge/SESSION_STATE.yaml`) |
| Authoring agent | Implementation Planner (under Lead Architect coordination) |
| Status | Draft for G3 review |
| Scope | Entire Workforce Operations Platform (all backend modules, web, two mobile clients, operations) |

> **Authority note.** This plan is an *execution* artifact. It converts already-frozen
> specifications into ordered, reversible, testable work. It **does not** modify any
> specification, reopen any Architecture Decision Record, or perform repository
> synchronization. Where a module's specification is not yet `FROZEN`, this plan records the
> G2 Specification Freeze (reserved human authority) as an explicit **prerequisite gate**, never
> as work this plan is entitled to bypass. Per the Engineering Constitution and
> `.claude/CLAUDE.md`: *"No implementation may begin from an unfrozen specification."*

---

## 1. Executive Summary

The Workforce Operations Platform is a **modular monolith** (ADR-003) — one Express/TypeScript
backend of 15+ in-process modules, a Next.js web client, and two Expo/React-Native mobile
clients (worker, checker) — deployed to AWS eu-central-1 (ADR-006), backed by PostgreSQL
(ADR-005) via Prisma (ADR-004). The codebase already exists and runs; the platform is
**mid-pivot**, not greenfield.

The single most important fact governing this plan is the **confirmed pivot** recorded across
the frozen specifications and disposed by **ADR-018**:

- **`[CURRENT STATE]`** — an implemented **marketplace apply/accept** flow: a hotel publishes a
  `WorkRequest`, rostered workers browse and `apply` (`WorkApplication`), a manager `accepts`,
  and a 7-step transaction atomically provisions a `WorkerAssignment` and an `EXPECTED`
  `Attendance` row (`docs/03-modules/job-dispatch/MODULE_SPEC.md`).
- **`[TARGET STATE]`** — a confirmed **two-tier direct-dispatch** model: PRIMARY = manager places
  workers on a calendar day-by-day (**no accept step**); FALLBACK = a standalone broadcast
  `JobRequest` (skill × headcount) to eligible workers, **first-accept-wins**. The
  `WorkApplication` module and model are **removed**. Attendance pivots to a **geofenced
  Start/Close** model with coordinate capture and a 6-month hard-delete retention job
  (`docs/03-modules/attendance/MODULE_SPEC.md`).

Therefore implementation is not "build from zero." It is a disciplined **migration**: retire the
marketplace flow, stand up the calendar-direct-assignment spine, re-home the cross-owner writes
that ADR-018 classified *superseded-by-pivot*, and remediate the security findings that were
frozen as **release prerequisites** (not freeze blockers) at the 2026-07-15 G2 Approval Workflow.

### What is ready to build now (FROZEN)

Four modules across three frozen specifications are implementable immediately:

| Spec | Modules | Status | Path |
|---|---|---|---|
| `SPEC-AUTH-001 @0.3.0` | `backend-auth` | **FROZEN** | `docs/03-modules/auth/MODULE_SPEC.md` |
| `SPEC-JOB-DISPATCH-001 @0.3.0` | `backend-work-requests`, `backend-work-applications`, `backend-assignments` | **FROZEN** | `docs/03-modules/job-dispatch/MODULE_SPEC.md` |
| `SPEC-ATT-001 @0.2.0` | `backend-attendance` | **FROZEN** | `docs/03-modules/attendance/MODULE_SPEC.md` |

Every other module carries a `REVIEW` specification (or none) and is **gated behind a G2
Specification Freeze** that is reserved human authority (`SYNC_STATE.yaml`,
`SPECIFICATION_INDEX.yaml`). Those modules appear in this plan with their freeze recorded as a
prerequisite, so the plan is complete for the *entire* platform while remaining honest about what
may legally start.

### Plan shape

- **8 phases** (Phase 0–7), gate-sequenced, each with explicit entry/exit criteria.
- **25 implementation epics** (19 backend + 3 client + 3 cross-cutting) — one per module plus the
  enabling and security-remediation tracks.
- A **critical path** running Identity → Organizational Core → Calendar/Direct-Dispatch spine →
  Attendance → Quality → Analytics, with HR/GDPR and assistive tracks parallelizable behind it.
- Companion documents carry the detail: [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md),
  [IMPLEMENTATION_DEPENDENCY_GRAPH.md](IMPLEMENTATION_DEPENDENCY_GRAPH.md),
  [IMPLEMENTATION_PARALLELIZATION_MATRIX.md](IMPLEMENTATION_PARALLELIZATION_MATRIX.md),
  [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md).

---

## 2. Governing Constraints (non-negotiable inputs)

These are inherited authorities, not decisions this plan makes.

1. **Frozen-spec-only rule.** No epic enters implementation (G3→G5) until its specification is
   `FROZEN`. REVIEW-spec epics carry a `PRE: G2 freeze of SPEC-X` prerequisite.
2. **No specification edits, no ADR reopening, no repository synchronization** — explicit task
   exclusions.
3. **Ratified ownership boundaries** (must be honored by every epic):
   - ADR-011 — Hotels capability owned by `backend-crm`; Scheduling owned by `backend-calendar`. No standalone `backend-hotels`/`backend-scheduling`.
   - ADR-012 — Contracts capability owned by `backend-hr`. No `backend-contracts`.
   - ADR-013 — Chatbot/AI-execution owned by `backend-chatbot`; Onboarding workflow owned by `backend-onboarding`, consuming Chatbot via `IF-CHATBOT-*`.
   - ADR-014 — Payslip request→fulfilment owned by `backend-hr`. No `backend-payslips`.
   - ADR-015 — Consent lifecycle owned by `backend-consent`.
   - ADR-016 — `AuditLog` authoritative writer = `backend-auth`; `backend-compliance` is read-only.
   - ADR-017 — `User` authoritative writer = `backend-auth`; `backend-users` is a bounded profile writer (non-security fields only).
   - ADR-018 — the accept-transaction cross-owner coupling is **superseded-by-pivot**: it is retired by the pivot, **not** adopted as a permanent pattern. Live-code removal is implementation work (this plan).
4. **Security findings are release prerequisites, not freeze blockers.** They MUST be closed (fix
   or authorized Risk Assessment) before **G8 Release Readiness**. They are scheduled explicitly
   in Phase 0 / per-epic hardening, never deferred silently.
5. **Ownership assignment (`SYNC-001`) is open, blocking human authority.** Every module `owner`
   is `unassigned`; no CODEOWNERS file exists. Accountable-owner assignment is a **Phase 0
   prerequisite** for G5 sign-off but is not invented here.

---

## 3. Module & Epic Inventory

19 backend modules/specs consolidate to the epics below (ownership consolidations per ADRs
already applied — Hotels folded into CRM, Contracts/Payslips into HR, Scheduling into Calendar).

| Epic | Module(s) | Spec | Spec status | Code today |
|---|---|---|---|---|
| EPIC-PLATFORM | (cross-cutting) | — | n/a | partial (CI, compose, nginx, ecosystem) |
| EPIC-SECREM | auth, job-dispatch, attendance, analytics | frozen specs' release-prereqs | n/a | deployed defects |
| EPIC-OWNERSHIP | all | governance (`SYNC-001`) | n/a | none (human) |
| EPIC-AUTH | backend-auth | `SPEC-AUTH-001` | **FROZEN** | active |
| EPIC-USERS | backend-users | `SPEC-USERS-001` | REVIEW | active |
| EPIC-CRM | backend-crm (+Hotels) | `SPEC-CRM-001` | REVIEW | active |
| EPIC-HOTELWORKERS | backend-hotel-workers | none | UNKNOWN | active |
| EPIC-CALENDAR | backend-calendar (+Scheduling) | `SPEC-CALENDAR-001` | REVIEW | stub (NotImplemented) |
| EPIC-JOBDISPATCH | work-requests, work-applications, assignments | `SPEC-JOB-DISPATCH-001` | **FROZEN** | active (marketplace) |
| EPIC-ATTENDANCE | backend-attendance | `SPEC-ATT-001` | **FROZEN** | active (timestamp) |
| EPIC-QUALITY | backend-quality | `SPEC-QUAL-001` | REVIEW | active |
| EPIC-NOTIFICATIONS | backend-notifications | `SPEC-NOTIF-001` | REVIEW | active |
| EPIC-ANALYTICS | backend-analytics | `SPEC-ANALYTICS-001` | REVIEW (sec FAIL) | active |
| EPIC-HR | backend-hr (+Contracts +Payslips) | `SPEC-HR-001` | REVIEW | stub (NotImplemented) |
| EPIC-ONBOARDING | backend-onboarding | onboarding business spec (no formal `SPEC-*` ID) | REVIEW | zero-code |
| EPIC-EMPLOYEE | backend-employee-management | `SPEC-EMP-001` | REVIEW | zero-code |
| EPIC-DOCUMENTS | backend-documents | `SPEC-DOCUMENTS-001` | REVIEW | zero-code |
| EPIC-CONSENT | backend-consent | `SPEC-CONSENT-001` | REVIEW | zero-code |
| EPIC-COMPLIANCE | backend-compliance | `SPEC-COMPLIANCE-001` | REVIEW | zero-code |
| EPIC-RETENTION | backend-retention | `SPEC-RETENTION-001` | REVIEW | zero-code |
| EPIC-CHATBOT | backend-chatbot | `SPEC-CHATBOT-001` | REVIEW | placeholder |
| EPIC-GEO | backend-geo | `SPEC-GEO-001` | REVIEW | placeholder |
| EPIC-FE-WEB | frontend-web | none | UNKNOWN | active |
| EPIC-MOBILE-WORKER | mobile/worker-app | none | UNKNOWN | active |
| EPIC-MOBILE-CHECKER | mobile/checker-app | none | UNKNOWN | active |

Full per-epic detail (prerequisites, deliverables, dependencies, acceptance criteria,
parallelization) is in [IMPLEMENTATION_BACKLOG.md](IMPLEMENTATION_BACKLOG.md).

---

## 4. Implementation Phases (summary)

Phases are gate-sequenced. Full entry/exit criteria and per-surface sequences are in
[IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md).

| Phase | Name | Primary outcome | Epics (lead) |
|---|---|---|---|
| **0** | Foundation & Enablement | CI gate harness, migration/rollback tooling, observability baseline, security-prereq remediation, owner assignment | EPIC-PLATFORM, EPIC-SECREM, EPIC-OWNERSHIP |
| **1** | Identity & Access Core | Frozen auth built to spec; RBAC/scope model; bounded user profiles | EPIC-AUTH, EPIC-USERS |
| **2** | Organizational Core | Hotels/CRM + worker roster as authoritative `Hotel`/`HotelWorker` state | EPIC-CRM, EPIC-HOTELWORKERS |
| **3** | Pivot Spine: Calendar & Direct Dispatch | `CalendarEntry`; job-dispatch target-state (direct assignment + broadcast `JobRequest`); **remove `WorkApplication`** | EPIC-CALENDAR, EPIC-JOBDISPATCH |
| **4** | Presence & Quality | Geofenced attendance (Start/Close + coordinate capture + 6-month sweep); quality verification & ratings | EPIC-ATTENDANCE, EPIC-QUALITY |
| **5** | Insight & Engagement | Notifications hardening (push); analytics aggregation with authz remediation | EPIC-NOTIFICATIONS, EPIC-ANALYTICS |
| **6** | Workforce Lifecycle & GDPR | HR (contracts, payslips), onboarding, employee-management, documents, consent, compliance, retention | EPIC-HR, EPIC-ONBOARDING, EPIC-EMPLOYEE, EPIC-DOCUMENTS, EPIC-CONSENT, EPIC-COMPLIANCE, EPIC-RETENTION |
| **7** | Assistive & Geo | Chatbot (AI capability + guardrails), geo services | EPIC-CHATBOT, EPIC-GEO |

Client tracks (EPIC-FE-WEB, EPIC-MOBILE-WORKER, EPIC-MOBILE-CHECKER) are **not a phase** — they
run as continuous surface tracks that consume each backend contract *after it freezes*, phase by
phase (see the Parallelization Matrix).

> **Phase 0–4 are the critical spine and must be sequenced.** Phases 5–7 overlap heavily and are
> gated by spec-freeze availability, not by a hard temporal wall.

---

## 5. Dependency Order & Critical Path

Derived in full (with evidence) in
[IMPLEMENTATION_DEPENDENCY_GRAPH.md](IMPLEMENTATION_DEPENDENCY_GRAPH.md). Summary:

**Critical path (longest dependency chain that gates a shippable pivot):**

```
EPIC-PLATFORM
  → EPIC-AUTH (identity, authz middleware, AuditLog writer per ADR-016/017)
    → EPIC-CRM (Hotel state) ─┐
    → EPIC-HOTELWORKERS (roster)─┤
                                 → EPIC-CALENDAR (CalendarEntry — target foundation)
                                   → EPIC-JOBDISPATCH (direct assignment + broadcast; remove WorkApplication)
                                     → EPIC-ATTENDANCE (geofence, reads WorkerAssignment)
                                       → EPIC-QUALITY (reads assignment + attendance)
                                         → EPIC-ANALYTICS (read-only aggregator; leaf)
```

`EPIC-NOTIFICATIONS` is a **leaf dependency of the whole graph** — every producing module calls
`notificationService.sendNotification` fire-and-forget (four observed `calls` edges,
`DEPENDENCY_GRAPH.yaml`). Its **contract** must freeze early (Phase 0/1) so callers can integrate;
its **internals** (push transport hardening) can finish later in Phase 5. This split — freeze the
contract early, harden the implementation late — is the single most important parallelization
lever in the plan.

**Rationale for the spine ordering:**

- Auth is upstream of everything: `authMiddleware`, `requireRole`/`checkHotelAccess`, and (per
  ADR-016) the authoritative `AuditLog` writer used by `BaseService.logAudit` across all modules.
- The pivot's PRIMARY dispatch tier is *calendar-day placement*, so `CalendarEntry`
  (`backend-calendar`, currently a `NotImplementedError` stub) is a **hard prerequisite** for
  target-state job-dispatch — it is on the critical path even though its spec is still REVIEW.
- Attendance target-state consumes a confirmed `WorkerAssignment`; quality consumes assignment +
  attendance; analytics reads all owned domains. This is a strict read-dependency chain.

---

## 6. Backend Implementation Sequence

Ordered by the dependency graph; frozen epics may start as soon as their upstream **contracts**
(not full implementations) are available.

1. **EPIC-PLATFORM** — CI gates, migration/rollback harness, test scaffolding, observability, feature-flag mechanism for the pivot cutover.
2. **EPIC-AUTH** *(FROZEN — start immediately)* — authn, RBAC/scope, `AuditLog` writer (ADR-016), `User` authoritative writer (ADR-017), password-reset hardening, session model. Publishes `auth-middleware` + `permissions-middleware` contracts.
3. **EPIC-USERS** *(needs G2)* — bounded profile writer/reader; non-security `User` fields only.
4. **EPIC-CRM** *(needs G2)* — `Hotel` CRUD + Hotels capability (ADR-011); pause-jobs contract toward job-dispatch (OD-CRM-16).
5. **EPIC-HOTELWORKERS** *(needs spec authoring + G2)* — `HotelWorker` roster; authoritative writer of `state-hotel-worker`.
6. **EPIC-NOTIFICATIONS (contract)** *(needs G2)* — freeze `notification-service` contract early; internals later.
7. **EPIC-CALENDAR** *(needs G2)* — `CalendarEntry` model + scheduling capability (ADR-011); **pivot foundation**.
8. **EPIC-JOBDISPATCH** *(FROZEN)* — implement target-state: direct assignment from calendar, broadcast `JobRequest` (first-accept-wins, 6-hour timer), **remove `WorkApplication` module/model**, drop mandatory `application_id`, add daily-exclusivity partial unique index. Migrate off marketplace flow behind a flag.
9. **EPIC-ATTENDANCE** *(FROZEN)* — geofenced Start/Close, coordinate capture, distance display, 6-month hard-delete sweep; re-home the `EXPECTED`-seed (OQ-05, moved to implementation track by ADR-018).
10. **EPIC-QUALITY** *(needs G2)* — verification + `Rating`/`WorkerOverallRating` recompute.
11. **EPIC-ANALYTICS** *(needs G2 + security fix)* — read-only aggregation; **must** gate the currently-unguarded `/analytics/leaderboard` routes (OQ-ANALYTICS-01, Critical) before or within this epic.
12. **EPIC-HR / ONBOARDING / EMPLOYEE / DOCUMENTS / CONSENT / COMPLIANCE / RETENTION** *(needs G2 each)* — GDPR & workforce-lifecycle stack; consent + retention are cross-cutting gates consumed by many modules.
13. **EPIC-NOTIFICATIONS (internals)** — push-transport hardening.
14. **EPIC-CHATBOT / GEO** *(needs G2 + open decisions)* — assistive layer; chatbot blocked on guardrail/RBAC decisions (OD-CHAT-005/006).

---

## 7. Frontend (Web) Implementation Sequence

`frontend-web` (Next.js) consumes backend APIs via `frontend/lib/api.ts`. It consumes each
contract **after freeze**, mirroring the backend phase order:

1. Auth/session shell, login, role-aware routing (after EPIC-AUTH contract).
2. Hotel/CRM management console, worker roster views (after EPIC-CRM / EPIC-HOTELWORKERS).
3. **Calendar placement UI** — the manager's day-by-day direct-assignment surface (after EPIC-CALENDAR + EPIC-JOBDISPATCH target contracts). This replaces marketplace apply/accept screens; retire those screens on the same flag as the backend cutover.
4. Broadcast `JobRequest` creation + fulfilment monitoring UI.
5. Attendance/verification dashboards; quality review console (after Phase 4).
6. Analytics dashboards (after EPIC-ANALYTICS; **do not** ship leaderboard views until the authz fix lands).
7. HR/GDPR admin surfaces (Phase 6).

Fix `edge-frontend-crm` truncation (per_page=100 vs backend default 20 — `OD-CRM-08`,
`DEPENDENCY_GRAPH.yaml`) during the CRM integration step.

---

## 8. Mobile Implementation Sequence

Two Expo/React-Native clients. The pivot changes their core loops materially.

**Worker app** (`mobile/worker-app`):
1. Auth/session (after EPIC-AUTH).
2. **Replace** the "browse & apply" job-marketplace screens (`app/job/[id].tsx` apply/withdraw,
   `mobile/worker-app/src/lib/api.ts:173-183`) with **"my calendar / assigned shifts"** and
   **broadcast-offer accept** screens (after EPIC-JOBDISPATCH target). This is a removal +
   rebuild, coordinated with the same feature flag.
3. **Geofenced Start/Close** attendance: device-location permission, 100 m geofence gate,
   coordinate capture at button press, distance display (after EPIC-ATTENDANCE target).
4. Notifications (push), assignments, HR self-service (payslip request), analytics read views.

**Checker app** (`mobile/checker-app`):
1. Auth/session.
2. Quality verification capture + attendance verification (after Phase 4).
3. Notifications.

> Mobile permission/geofence work (location) is a **long-lead platform item** (store review,
> permission prompts). Start the permission scaffolding in Phase 1 even though the attendance
> feature lands in Phase 4.

---

## 9. Testing Strategy

Testing is gated by the framework's own workflow (`.claude/workflows/testing.md`, QA Engineer)
and by G5/G6. This plan defines *what* must be tested and *when*; QA owns execution against frozen
acceptance criteria.

| Layer | Scope | Owner | Gate |
|---|---|---|---|
| **Unit** | Per-module service logic; every `REQ-*`/`RULE-*` acceptance criterion in the frozen spec maps to ≥1 test | Backend/Frontend/Mobile Engineer | Component checks (G5 input) |
| **Contract/integration** | Cross-module boundaries: notification-service calls, cross-owner reads, the pivot's daily-exclusivity unique index & CHECK constraints, RBAC middleware gates | Backend Engineer + QA | SYNC-impl-1 |
| **Migration** | Every schema migration has a forward + verified rollback; marketplace→direct-dispatch data migration is dry-run tested against a production-shaped snapshot | Backend + Infrastructure Engineer | G5 (migration/rollback evidence mandatory) |
| **Security regression** | One test per closed release-prerequisite finding (auth 4 High + MFA, job-dispatch Critical `PATCH /assignments/:id`, attendance cross-tenant scoping, analytics leaderboard authz) — proves the hole is closed and stays closed | Security-aware Backend Engineer + Security Reviewer | G8 |
| **End-to-end** | The two pivot journeys: (a) manager calendar-places worker → worker sees shift → geofenced Start/Close → checker verifies → rating; (b) broadcast JobRequest → first-accept-wins → losers notified | QA Engineer | G6/G7 |
| **Regression on retired paths** | Assert the marketplace apply/accept endpoints and `WorkApplication` are gone (or flag-disabled) and return the expected gone/blocked response | QA Engineer | G6 |

**Principles.**
- **Acceptance-criterion traceability is mandatory:** the frozen specs enumerate `REQ-*`/`RULE-*`
  IDs; the QA matrix must show every ID mapped to a test (Implementation Workflow G5 requires
  complete plan mapping).
- **No destructive migration runs without rollback evidence** (Constitution; Implementation
  Workflow escalation condition).
- **Security regression tests are release gates,** not optional — the findings were frozen as
  release prerequisites.
- Reuse the existing backend test harness (`backend/src/__tests__/`); close the `active-no-tests`
  gap for `backend-hr` and `backend-calendar` (`MODULE_REGISTRY.yaml`) as those epics land.

---

## 10. Release Milestones

Releases are cut by the Release Manager at **G8 Release Readiness** with immutable candidate +
migration + rollback evidence. Milestones are capability-complete slices, not calendar dates
(dates are human authority and not invented here).

| Milestone | Contents | Precondition gates | Release-prereq security debt cleared |
|---|---|---|---|
| **M0 — Enablement** | CI gates live; migration/rollback harness; observability baseline; feature-flag mechanism; owners assigned | Phase 0 exit | — |
| **M1 — Secured Identity** | Frozen auth to spec; RBAC/scope; users profiles | Phase 1 exit; G5 | **auth**: 4 High + MFA closed |
| **M2 — Organizational Core** | Hotels/CRM + roster; notification contract frozen | Phase 2 exit | — |
| **M3 — Pivot GA (headline release)** | Calendar direct-dispatch + broadcast JobRequest; marketplace flow retired; **WorkApplication removed** | Phase 3 exit; migration rollback proven; G5 | **job-dispatch**: Critical `PATCH /assignments/:id` + 2 High closed |
| **M4 — Presence & Quality** | Geofenced attendance; 6-month sweep; quality/ratings | Phase 4 exit; G5 | **attendance**: cross-tenant hotel-scoping (High) closed |
| **M5 — Insight** | Analytics + hardened push notifications | Phase 5 exit | **analytics**: leaderboard authz (Critical) closed |
| **M6 — Workforce Lifecycle & GDPR** | HR/contracts/payslips, onboarding, employee-mgmt, documents, consent, compliance, retention sweep | Phase 6 exit; each sub-spec frozen | GDPR retention/consent operative |
| **M7 — Assistive** | Chatbot (guardrails), geo | Phase 7 exit | chatbot prompt-injection guardrail (OD-CHAT-006) resolved |

**M3 is the program's headline milestone** — it is the point at which the confirmed pivot is
actually live. Everything in Phases 0–3 exists to make M3 safe and reversible.

---

## 11. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Pivot data migration** (marketplace → direct-dispatch) is irreversible or corrupts live assignments | High | Feature-flag cutover; forward+rollback migrations with mandatory dry-run against a production-shaped snapshot (G5 evidence); keep `WorkApplication` table read-only for a deprecation window before drop |
| R2 | **REVIEW specs block the critical path** — `backend-calendar` (CalendarEntry) is on the spine but is REVIEW/stub | High | Escalate CalendarEntry's G2 freeze as the top sequencing dependency; do not start job-dispatch target build until Calendar contract freezes |
| R3 | **Security release-prerequisites slip to the release edge** and stall G8 | High | Schedule remediation explicitly in Phase 0 (EPIC-SECREM) for already-deployed defects and per-epic for the rest; one regression test per finding; track against G8 from day one |
| R4 | **Ownership (`SYNC-001`) never assigned** — no accountable owner for G5 sign-off | Medium | Phase 0 EPIC-OWNERSHIP escalates owner assignment as blocking human authority before first G5 |
| R5 | **Cross-owner writes re-homing** (`EXPECTED`-seed OQ-05) done inconsistently across job-dispatch/attendance | Medium | ADR-018 dispositions it superseded-by-pivot; single coordinated work item spanning both epics at the Phase 3/4 boundary; SYNC-impl-1 barrier |
| R6 | **Chatbot AI guardrail** (prompt-injection, OD-CHAT-006) unresolved blocks Phase 7 | Medium | Isolate to Phase 7; do not let it gate earlier phases; escalate the guardrail design decision early so it's ready when Phase 7 opens |
| R7 | **Parallel implementers collide on shared files** (`schema.prisma`, middleware, `routes/v1/index.ts`) | Medium | Contract-freeze-before-parallel rule (SYNC-impl-1); single migration-owner per phase serializes `schema.prisma`; consume frozen fixtures, never in-flight diffs |
| R8 | **Analytics unguarded leaderboard** is a live, deployed data-exposure defect right now | High | Treat as immediate Phase 0 hotfix candidate (EPIC-SECREM) even ahead of the analytics epic's own freeze — it exists in shipped code |
| R9 | **Notifications internals** finish late and starve callers | Low | Freeze the contract in Phase 0/1; callers integrate against the frozen fixture; internals harden in Phase 5 without changing the contract |

---

## 12. How This Plan Is Consumed (G3 → G5)

Per `.claude/workflows/implementation.md`:

1. **G3 evaluation** — Lead Architect reviews this plan set; on pass, authorizes implementer
   invocation. This document is the G3 candidate.
2. **Context packaging (`ART-PLAN-002`)** — Lead Architect builds minimal per-engineer context
   manifests from the [Backlog](IMPLEMENTATION_BACKLOG.md) (each engineer receives only their
   surface's work items + the frozen spec slice + contract fixtures, not the whole plan).
3. **Implementation** — Backend/Frontend/Mobile/Infrastructure Engineers execute in dependency
   order, parallel only where the [Parallelization Matrix](IMPLEMENTATION_PARALLELIZATION_MATRIX.md)
   permits, joining at **SYNC-impl-1** contract barriers.
4. **G5 evaluation** — Lead Architect consolidates `ART-IMPL-*-002` reports into `ART-IMPL-000`;
   G5 requires complete plan mapping, clean checks, no unapproved deviation, and
   migration/rollback evidence. Hands a testable candidate to QA (testing workflow).

Deviations discovered during implementation return to the originating gate — **the spec is never
patched through code** (Implementation Workflow failure handling).

---

## 13. Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-15 | Implementation Planner | Initial platform-wide implementation plan set (this document + 4 companions), G3 candidate. |
