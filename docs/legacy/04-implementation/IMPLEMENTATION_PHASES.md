# Implementation Phases — Workforce Operations Platform

| Field | Value |
|---|---|
| Artifact ID | `ART-PLAN-001` companion (phase definition) |
| Parent | [IMPLEMENTATION_MASTER_PLAN.md](IMPLEMENTATION_MASTER_PLAN.md) |
| Baseline revision | `09e0b162297162c8a93975ce55ccd3c406218606` |
| Status | Draft for G3 review |

Each phase below states its **entry gate**, **exit gate**, the **backend / frontend / mobile /
infrastructure sequences** inside it, and the **release milestone** it produces. Phases are
ordered by the dependency graph in
[IMPLEMENTATION_DEPENDENCY_GRAPH.md](IMPLEMENTATION_DEPENDENCY_GRAPH.md). Gate names (G0, G1.5,
G2, G3, G5, G6, G8) are the framework's (`.claude/constitution/REVIEW_GATES.md`).

> **Reading rule.** "Backend sequence" lists ordered work *within* the phase. A phase does not
> require every REVIEW spec to be frozen before it *opens*; it requires each **epic** inside it to
> be frozen before that epic's code (G3→G5) starts. Frozen epics (auth, job-dispatch, attendance)
> may begin the moment their upstream contracts exist.

---

## Phase 0 — Foundation & Enablement

**Goal:** make the repository safe to change at scale — gates, migrations, observability, and the
already-shipped security defects — before touching business logic.

| | |
|---|---|
| **Entry** | G0 pass (repository truth established; this plan set exists). Baseline revision current. |
| **Exit** | CI runs the full gate harness on every PR; migration+rollback harness proven on a no-op migration; observability baseline live; **EPIC-SECREM** deployed defects closed with regression tests; feature-flag mechanism exists; owners assigned (or escalation on record). |
| **Milestone** | **M0 — Enablement** |
| **Epics** | EPIC-PLATFORM, EPIC-SECREM, EPIC-OWNERSHIP |

**Infrastructure sequence (lead):**
1. Wire CI to run `npm run type-check`, `npm run build`, `npm test` (`package.json`) as blocking checks; add per-workspace jobs (backend, frontend, mobile).
2. Establish the Prisma migration + rollback harness and the production-shaped snapshot used for migration dry-runs (ADR-004/005).
3. Observability baseline: structured request logging (`requestLoggerMiddleware` already in `app.ts`), error tracking, health checks.
4. Feature-flag mechanism for the pivot cutover (marketplace ↔ direct-dispatch).

**Backend sequence (parallel, security-first):**
1. **EPIC-SECREM immediate hotfixes on already-deployed code** — highest urgency is the unguarded `GET /analytics/leaderboard` / `/by-hotel/:hotel_id` routes (Critical, OQ-ANALYTICS-01, `MODULE_REGISTRY.yaml` unresolved list) — add `requireRole`/`checkHotelAccess` to match the sibling `/quality/leaderboard`. These are live data-exposure defects and do not wait for the analytics epic's own freeze.
2. Stage the remaining release-prerequisite fixes as tracked items to be closed inside their owning epics (auth 4 High + MFA, job-dispatch Critical `PATCH /assignments/:id` + 2 High, attendance cross-tenant scoping).

**Governance (human):**
- **EPIC-OWNERSHIP** — assign accountable owners for every module, shared contract, and state domain (`SYNC-001`); designate the `state-user` authoritative writer already settled by ADR-017 in code terms. Blocking for first G5 sign-off.

---

## Phase 1 — Identity & Access Core

**Goal:** a spec-conformant, secured identity layer that every other module's authorization
depends on.

| | |
|---|---|
| **Entry** | Phase 0 exit. `SPEC-AUTH-001` **FROZEN** (satisfied). `SPEC-USERS-001` G2 freeze for the USERS portion. |
| **Exit** | Auth built to `SPEC-AUTH-001`; RBAC/scope model live; `auth-middleware` + `permissions-middleware` contracts frozen and published; auth release-prerequisites (4 High + MFA) closed with regression tests; users bounded-profile writer live (ADR-017). G5 pass. |
| **Milestone** | **M1 — Secured Identity** |
| **Epics** | EPIC-AUTH *(FROZEN)*, EPIC-USERS *(needs G2)* |

**Backend sequence:**
1. EPIC-AUTH — sessions, JWT (fix refresh-secret fallback), password-reset (Critical already fixed by HOTFIX-AUTH-002; verify), `checkHotelAccess` bypass fixes, MFA, cleartext refresh-token storage fix. `AuditLog` authoritative writer (ADR-016), `User` authoritative writer (ADR-017).
2. Publish and **freeze** `auth-middleware` and `permissions-middleware` contracts (consumed by ~12 modules per `DEPENDENCY_GRAPH.yaml`).
3. EPIC-USERS — bounded profile CRUD (non-security `User` fields only); `createUser` admin-guard already mirrored in code (HOTFIX-AUTH-003).

**Frontend sequence:** auth/session shell, login, role-aware routing/guards (consumes frozen auth contract).

**Mobile sequence:** auth/session on both apps (`worker-app`, `checker-app`); **begin location-permission scaffolding now** (long-lead, needed in Phase 4).

---

## Phase 2 — Organizational Core

**Goal:** authoritative `Hotel` and `HotelWorker` state — the entities every dispatch decision
references.

| | |
|---|---|
| **Entry** | Phase 1 exit (auth contract frozen). `SPEC-CRM-001` G2 freeze; `backend-hotel-workers` spec authored + G2 freeze. |
| **Exit** | CRM owns `Hotel` (incl. Hotels capability, ADR-011); hotel-workers owns `HotelWorker`; pause-jobs contract toward job-dispatch defined (OD-CRM-16); notification-service **contract frozen** for downstream callers. G5 pass. |
| **Milestone** | **M2 — Organizational Core** |
| **Epics** | EPIC-CRM *(needs G2)*, EPIC-HOTELWORKERS *(needs spec + G2)*, EPIC-NOTIFICATIONS *(contract only, needs G2)* |

**Backend sequence:**
1. EPIC-CRM — `Hotel` CRUD, Hotels capability; reconcile manager write-authority (OD-CRM-02) and list-audience (OD-CRM-07) per their dispositions; define the pause-jobs → job-dispatch contract (OD-CRM-16).
2. EPIC-HOTELWORKERS — `HotelWorker` roster lifecycle; authoritative writer of `state-hotel-worker` (readers: work-requests, work-applications, assignments, users, analytics).
3. EPIC-NOTIFICATIONS (contract) — freeze the `notification-service` interface so downstream callers integrate against a stable fixture; internals deferred to Phase 5.

**Frontend sequence:** hotel/CRM management console; worker roster views; **fix `edge-frontend-crm` per_page truncation** (OD-CRM-08).

**Mobile sequence:** (no new core loop yet) roster-dependent read screens stubbed against frozen contracts.

---

## Phase 3 — Pivot Spine: Calendar & Direct Dispatch  *(headline phase)*

**Goal:** replace the marketplace apply/accept flow with the confirmed two-tier direct-dispatch
model. **This is the program's defining phase.**

| | |
|---|---|
| **Entry** | Phase 2 exit. `SPEC-CALENDAR-001` G2 freeze (**critical-path blocker**). `SPEC-JOB-DISPATCH-001` **FROZEN** (satisfied). Feature-flag mechanism live (Phase 0). |
| **Exit** | `CalendarEntry` model + calendar direct-placement live; broadcast `JobRequest` (first-accept-wins, 6-hour timer, slot-exhaustion notifications) live; **`WorkApplication` module + model removed**; mandatory `application_id` dropped; daily-exclusivity partial unique index + capacity CHECK constraints migrated; marketplace→direct-dispatch data migration executed behind flag with **proven rollback**; job-dispatch Critical + 2 High release-prereqs closed. G5 pass. |
| **Milestone** | **M3 — Pivot GA** |
| **Epics** | EPIC-CALENDAR *(needs G2)*, EPIC-JOBDISPATCH *(FROZEN)* |

**Backend sequence (strict order — shared `schema.prisma` serialized under one migration owner):**
1. EPIC-CALENDAR — `CalendarEntry` model + scheduling capability (ADR-011); availability/placement primitives the dispatch tier consumes.
2. EPIC-JOBDISPATCH target-state:
   a. Repurpose `backend-work-requests` as broadcast `JobRequest` (skill × headcount, eligibility = matching skill ∧ free that day).
   b. Direct assignment: `WorkerAssignment` created from a `CalendarEntry` placement (no accept step); drop mandatory `application_id`.
   c. **Remove** `backend-work-applications` module + `WorkApplication` model (retire marketplace apply/accept).
   d. First-accept-wins concurrency on broadcast accept; 6-hour timer / manual close; slot-exhaustion "requirement fulfilled" notifications (via frozen notification contract).
   e. Migrations: daily-exclusivity partial unique index (PIVOT §9.4), capacity/double-booking CHECK + partial unique index; forward + rollback; dry-run on snapshot.
   f. Re-home the `EXPECTED` `Attendance` seed (OQ-05) — coordinate with Phase 4 attendance (SYNC-impl-1 barrier). Under ADR-018 the old cross-owner seed is retired, not preserved.
   g. Close job-dispatch release-prereqs: guard `PATCH /assignments/:id` (Critical) + 2 High.

**Frontend sequence:** manager **calendar placement UI** (replaces apply/accept screens); broadcast `JobRequest` creation + fulfilment monitor; retire marketplace screens on the shared flag.

**Mobile (worker) sequence:** replace "browse & apply" (`app/job/[id].tsx`, `src/lib/api.ts:173-183`) with "my calendar / assigned shifts" + broadcast-offer accept; retire apply/withdraw calls on the shared flag.

---

## Phase 4 — Presence & Quality

**Goal:** geofenced attendance against confirmed assignments, plus verification and ratings.

| | |
|---|---|
| **Entry** | Phase 3 exit (confirmed `WorkerAssignment` shape stable). `SPEC-ATT-001` **FROZEN** (satisfied). `SPEC-QUAL-001` G2 freeze. Mobile location permission scaffolding ready (from Phase 1). |
| **Exit** | Geofenced Start/Close (100 m gate, coordinate capture at button press, distance display) live; 6-month coordinate hard-delete sweep job scheduled; attendance cross-tenant hotel-scoping (High) closed; quality verification + `Rating`/`WorkerOverallRating` recompute live. G5 pass. |
| **Milestone** | **M4 — Presence & Quality** |
| **Epics** | EPIC-ATTENDANCE *(FROZEN)*, EPIC-QUALITY *(needs G2)* |

**Backend sequence:**
1. EPIC-ATTENDANCE target-state — geofenced Start/Close replacing timestamp check-in/out; coordinate capture + storage; 100 m geofence enforcement; distance-without-location display; 6-month hard-delete scheduled sweep (interlocks with EPIC-RETENTION model in Phase 6, but the attendance-local sweep is in-scope here per `SPEC-ATT-001`); fix cross-tenant hotel-scoping (OQ-02, High).
2. EPIC-QUALITY — verification lifecycle; `Rating` and `WorkerOverallRating` recompute (reads assignment + attendance).

**Frontend sequence:** attendance/verification dashboards; quality review console.

**Mobile sequence:** worker app — geofenced Start/Close with location permission + distance display; checker app — attendance verification + quality capture.

---

## Phase 5 — Insight & Engagement

**Goal:** finish analytics (secured) and harden notification delivery.

| | |
|---|---|
| **Entry** | Phase 4 exit (all read-source domains populated). `SPEC-ANALYTICS-001` G2 freeze **with security fix landed**; `SPEC-NOTIF-001` G2 freeze. |
| **Exit** | Analytics aggregation live with **all leaderboard routes authz-gated** (Critical closed); notification push transport hardened behind the already-frozen contract. G5 pass. |
| **Milestone** | **M5 — Insight** |
| **Epics** | EPIC-ANALYTICS *(needs G2 + fix)*, EPIC-NOTIFICATIONS *(internals)* |

**Backend sequence:**
1. EPIC-ANALYTICS — read-only aggregation across owned domains; confirm the Phase 0 leaderboard authz fix is present and covered by a regression test; no writes.
2. EPIC-NOTIFICATIONS internals — push-only transport (CONFIRMED §18), delivery hardening; contract unchanged from Phase 2 freeze.

**Frontend sequence:** analytics dashboards (leaderboard views only after authz fix verified).
**Mobile sequence:** analytics read views; push-notification receipt handling.

---

## Phase 6 — Workforce Lifecycle & GDPR

**Goal:** the HR/onboarding/GDPR stack. Highly parallel *within* the phase; each sub-epic gated by
its own G2 freeze.

| | |
|---|---|
| **Entry** | Phase 1 exit (identity) minimum; independent of Phases 3–5 except where noted. Each sub-spec G2 freeze. ADR-011..017 boundaries honored. |
| **Exit** | HR (contracts, payslips), onboarding, employee-management, documents, consent, compliance (read-only per ADR-016), retention (three-tier model + daily deletion sweep) live; GDPR consent + retention operative platform-wide. G5 pass per sub-epic. |
| **Milestone** | **M6 — Workforce Lifecycle & GDPR** |
| **Epics** | EPIC-HR, EPIC-ONBOARDING, EPIC-EMPLOYEE, EPIC-DOCUMENTS, EPIC-CONSENT, EPIC-COMPLIANCE, EPIC-RETENTION |

**Backend sequence (dependency-ordered within phase):**
1. **EPIC-CONSENT** and **EPIC-RETENTION** first — they are cross-cutting gates other modules consume (`IF-CONSENT-*`, `IF-RETENTION-*`).
2. **EPIC-HR** — contract lifecycle (ADR-012), payslip request→fulfilment state machine (ADR-014); close the `active-no-tests` gap.
3. **EPIC-ONBOARDING** — onboarding workflow (ADR-013); consumes Chatbot via `IF-CHATBOT-*` (stub until Phase 7) and Consent via `IF-CONSENT-*`.
4. **EPIC-EMPLOYEE**, **EPIC-DOCUMENTS** — employee records; document storage (resolve OD-DOC-005/007 RBAC before build).
5. **EPIC-COMPLIANCE** — read-only consumer of `AuditLog`/Consent/Retention/Documents (ADR-016); governance/reporting only.

**Frontend sequence:** HR/GDPR admin surfaces; onboarding flows; document management; consent/retention admin.
**Mobile sequence:** worker self-service (payslip request via `IF-HR-*`, document upload, consent capture, onboarding).

---

## Phase 7 — Assistive & Geo

**Goal:** the assistive AI layer and geo services — last because chatbot carries unresolved
guardrail/RBAC decisions and geo is a supporting capability.

| | |
|---|---|
| **Entry** | `SPEC-CHATBOT-001` G2 freeze (blocked on OD-CHAT-005 RBAC, OD-CHAT-006 prompt-injection guardrail); `SPEC-GEO-001` G2 freeze (blocked on OD-GEO-001/002 ownership split). |
| **Exit** | Chatbot conversation lifecycle + provider abstraction + guardrails live (ADR-013); geo services live; both route-registered (they are placeholder-unregistered today). G5 pass. |
| **Milestone** | **M7 — Assistive** |
| **Epics** | EPIC-CHATBOT *(needs G2 + decisions)*, EPIC-GEO *(needs G2 + decisions)* |

**Backend sequence:**
1. EPIC-CHATBOT — implement only after OD-CHAT-006 (prompt-injection guardrail) and OD-CHAT-005 (conversation RBAC) are resolved by Decision Record; conversation lifecycle, provider abstraction, memory, AI audit; register the currently-unregistered module.
2. EPIC-GEO — geo services per resolved ownership split; register the module.

**Frontend / mobile sequence:** chatbot conversational UI; geo-assisted surfaces (interlocks with attendance geofence UX from Phase 4).

---

## Phase Gate Summary

| Phase | Entry gate | Exit gate | Milestone | Critical-path blocker to watch |
|---|---|---|---|---|
| 0 | G0 | Harness + SECREM + owners | M0 | Analytics leaderboard hotfix (live defect) |
| 1 | Phase 0; SPEC-AUTH FROZEN | G5 | M1 | Auth release-prereqs (4 High + MFA) |
| 2 | Phase 1; CRM/hotel-workers G2 | G5 | M2 | hotel-workers has **no spec yet** — author + freeze |
| 3 | Phase 2; **Calendar G2** | G5 + rollback proof | M3 | Calendar G2 freeze; pivot data migration |
| 4 | Phase 3; ATT FROZEN; Quality G2 | G5 | M4 | Mobile location permission readiness |
| 5 | Phase 4; Analytics G2 **+ fix** | G5 | M5 | Analytics security fix must precede freeze use |
| 6 | Identity; per-sub-spec G2 | G5 ×7 | M6 | Consent/Retention must precede consumers |
| 7 | Chatbot/Geo G2 **+ decisions** | G5 | M7 | OD-CHAT-006 guardrail decision |
