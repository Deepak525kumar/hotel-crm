# Implementation Backlog — Workforce Operations Platform

| Field | Value |
|---|---|
| Artifact ID | `ART-PLAN-001` companion (requirement-to-work backlog) |
| Parent | [IMPLEMENTATION_MASTER_PLAN.md](IMPLEMENTATION_MASTER_PLAN.md) |
| Baseline revision | `09e0b162297162c8a93975ce55ccd3c406218606` |
| Status | Draft for G3 review |

This backlog holds one **epic per module** plus the three cross-cutting epics. Each epic follows a
fixed template:

- **Prerequisites** — gates and upstream work that must complete first.
- **Deliverables** — concrete repository changes (code, migrations, tests, docs, graph updates).
- **Dependencies** — upstream/downstream edges (see [Dependency Graph](IMPLEMENTATION_DEPENDENCY_GRAPH.md)).
- **Acceptance criteria** — the "done" conditions; for FROZEN specs these trace to the spec's
  `REQ-*`/`RULE-*` IDs (the engineer maps each ID to a test at G5).
- **Parallelization** — what may run alongside this epic.

> **Frozen-spec rule restated:** epics whose spec is `REVIEW` carry `PRE: G2 freeze of SPEC-X`.
> That prerequisite is reserved human authority; this backlog does not satisfy it, it records it.
> Acceptance criteria for REVIEW-spec epics are stated at capability level and are **finalized
> against the frozen spec** once G2 passes.

---

## Cross-Cutting Epics

### EPIC-PLATFORM — Foundation & Enablement
- **Phase:** 0 · **Spec:** n/a · **Surface:** infrastructure
- **Prerequisites:** G0 (repository truth). Baseline revision current.
- **Deliverables:**
  - CI pipeline running `npm run type-check`, `npm run build`, `npm test` (`package.json`) as blocking checks, per workspace (backend/frontend/mobile).
  - Prisma migration + rollback harness; production-shaped snapshot for dry-runs (ADR-004/005).
  - Observability baseline (structured logs via existing `requestLoggerMiddleware`, error tracking, health checks).
  - Feature-flag mechanism for the pivot cutover (marketplace ↔ direct-dispatch).
- **Dependencies:** upstream of all epics; no upstream itself.
- **Acceptance criteria:**
  - Every PR runs the full gate harness; a failing check blocks merge.
  - A no-op migration proves forward + rollback end-to-end.
  - The feature flag can independently toggle backend, web, and mobile pivot paths.
- **Parallelization:** its four workstreams (CI ∥ migrations ∥ observability ∥ flags) run fully in parallel.

### EPIC-SECREM — Security Release-Prerequisite Remediation
- **Phase:** 0 (deployed defects) + per-epic (spec-scoped) · **Spec:** the frozen specs' release-prereqs · **Surface:** backend
- **Prerequisites:** EPIC-PLATFORM (regression-test harness).
- **Deliverables:**
  - **Immediate (live, deployed defect):** guard `GET /analytics/leaderboard` and `/by-hotel/:hotel_id` with `requireRole`/`checkHotelAccess` to match `/quality/leaderboard` (OQ-ANALYTICS-01, Critical — `MODULE_REGISTRY.yaml` unresolved list).
  - **Scheduled into owning epics:** auth 4 High + absent MFA (EPIC-AUTH); job-dispatch Critical `PATCH /assignments/:id` unguarded + 2 High (EPIC-JOBDISPATCH); attendance cross-tenant hotel-scoping High, OQ-02 (EPIC-ATTENDANCE).
  - One **security-regression test per finding**.
- **Dependencies:** the analytics hotfix is independent (start now); others ride their epic.
- **Acceptance criteria:** every listed finding closed by code fix (or authorized Risk Assessment); each has a regression test; all closed before **G8**.
- **Parallelization:** analytics hotfix ∥ everything; the rest serialize into their epics.

### EPIC-OWNERSHIP — Accountable Owner Assignment (governance)
- **Phase:** 0 · **Spec:** governance (`SYNC-001`) · **Surface:** governance (human)
- **Prerequisites:** none (reserved human authority).
- **Deliverables:** assign accountable owners for every module, shared contract, and state domain; create CODEOWNERS; confirm `state-user` writer split already settled by ADR-017 is reflected operationally.
- **Dependencies:** blocks first G5 sign-off (a gate needs an accountable owner).
- **Acceptance criteria:** no module/contract/state-domain remains `owner: unassigned` at first G5.
- **Parallelization:** off the code path; parallel with all Phase 0 code work. **If unresolved, escalate — do not invent owners.**

---

## Backend Epics

### EPIC-AUTH — Authentication & Access  *(FROZEN)*
- **Phase:** 1 · **Spec:** `SPEC-AUTH-001 @0.3.0` **FROZEN** · **Module:** `backend-auth`
- **Prerequisites:** EPIC-PLATFORM. Spec FROZEN (satisfied).
- **Deliverables:**
  - Auth to spec: sessions, JWT, login/logout/me, password reset (Critical already fixed by HOTFIX-AUTH-002 — verify), registration.
  - **Release-prereq fixes:** JWT refresh-secret fallback; `checkHotelAccess` admin/manager/checker blanket-bypass; cleartext `Session.refresh_token` storage; **MFA** (currently absent).
  - `AuditLog` authoritative writer (ADR-016); `User` authoritative writer, role/permission/credential writes auth-only (ADR-017).
  - **Freeze + publish** `auth-middleware` and `permissions-middleware` contracts.
- **Dependencies:** upstream of every module (authz middleware); writes `state-user`, `state-session`, `state-password-reset-token`, `state-audit-log`.
- **Acceptance criteria:** trace to `SPEC-AUTH-001` `REQ-*`; the 4 High findings + MFA closed with regression tests (release prereqs, G8); middleware contract frozen and consumed by ≥1 downstream in an integration test.
- **Parallelization:** internally serial (owns middleware + base-service). Mobile location-permission scaffolding runs ∥.

### EPIC-USERS — Bounded User Profiles
- **Phase:** 1 · **Spec:** `SPEC-USERS-001 @0.1.1` REVIEW · **Module:** `backend-users`
- **Prerequisites:** `PRE: G2 freeze of SPEC-USERS-001`. EPIC-AUTH middleware frozen.
- **Deliverables:** bounded profile CRUD on non-security `User` fields (ADR-017); `listUsers` hotel filter (`edge-users-reads-hotel-worker`); confirm `createUser` admin-guard (HOTFIX-AUTH-003) present.
- **Dependencies:** upstream: AUTH. Downstream: hotel-workers reads `User`.
- **Acceptance criteria:** trace to `SPEC-USERS-001` `REQ-USERS-*` once frozen; no security-field write path exists in `backend-users` (ADR-017 boundary test); ID-collision fix (SIR-USERS-010) reflected.
- **Parallelization:** ∥ CRM, notifications-contract, web auth shell.

### EPIC-CRM — Hotels / CRM  *(+Hotels capability, ADR-011)*
- **Phase:** 2 · **Spec:** `SPEC-CRM-001 @0.1.1` REVIEW · **Module:** `backend-crm`
- **Prerequisites:** `PRE: G2 freeze of SPEC-CRM-001`. EPIC-AUTH. Dispositions of OD-CRM-01/02/05/07/10 (roles, manager write-authority, list-audience, hotel-group model).
- **Deliverables:** `Hotel` CRUD + Hotels capability (no standalone `backend-hotels`, ADR-011); reconcile manager write-authority (OD-CRM-02) and list-audience (OD-CRM-07); define the **pause-jobs → job-dispatch** contract (OD-CRM-16).
- **Dependencies:** upstream: AUTH. Downstream: hotel-workers, work-requests (read `Hotel`), pause-jobs consumer job-dispatch.
- **Acceptance criteria:** trace to `SPEC-CRM-001` `REQ-CRM-*` once frozen; authoritative writer of `state-hotel`; pause-jobs contract has a bilateral test with job-dispatch.
- **Parallelization:** ∥ USERS; **precedes** hotel-workers (✕).

### EPIC-HOTELWORKERS — Worker Roster
- **Phase:** 2 · **Spec:** none (UNKNOWN) · **Module:** `backend-hotel-workers`
- **Prerequisites:** **Author a specification and G2-freeze it** (no spec exists — `SPECIFICATION_INDEX.yaml`). EPIC-CRM `Hotel` frozen; EPIC-USERS `User` frozen.
- **Deliverables:** `HotelWorker` roster lifecycle (invite/activate/deactivate); authoritative writer of `state-hotel-worker`; reads `Hotel` + `User` (`edge-hotel-workers-reads-hotel`, `-reads-user`).
- **Dependencies:** upstream: CRM, USERS. Downstream: calendar eligibility, job-dispatch, assignments, analytics.
- **Acceptance criteria:** trace to the authored spec once frozen; roster status transitions guarded; readers see a stable `HotelWorker` contract.
- **Parallelization:** after CRM (✕); ∥ attendance/quality later once its contract is up.
- **Note:** this epic's **missing spec is a critical-path risk** — flag for early authoring.

### EPIC-CALENDAR — Scheduling & CalendarEntry  *(+Scheduling, ADR-011)*  *(pivot foundation)*
- **Phase:** 3 · **Spec:** `SPEC-CALENDAR-001 @0.1.0` REVIEW · **Module:** `backend-calendar` (stub today)
- **Prerequisites:** `PRE: G2 freeze of SPEC-CALENDAR-001` — **highest sequencing priority** (critical path). EPIC-HOTELWORKERS.
- **Deliverables:** `CalendarEntry` model (PIVOT §9.3); scheduling/availability primitives; day-by-day placement API the dispatch tier consumes; replace `NotImplementedError` stub with real service; route-register; add tests (closes `active-no-tests`).
- **Dependencies:** upstream: hotel-workers, CRM. Downstream: **EPIC-JOBDISPATCH direct assignment [TARGET]**.
- **Acceptance criteria:** trace to `SPEC-CALENDAR-001` once frozen; `CalendarEntry` supports the PRIMARY direct-placement tier; eligibility ("free that day") computable over the roster.
- **Parallelization:** on the spine (✕ with job-dispatch); ∥ Phase 6 GDPR cluster.

### EPIC-JOBDISPATCH — Job Dispatch & Assignment  *(FROZEN — headline)*
- **Phase:** 3 · **Spec:** `SPEC-JOB-DISPATCH-001 @0.3.0` **FROZEN** · **Modules:** `backend-work-requests`, `backend-work-applications`, `backend-assignments`
- **Prerequisites:** Spec FROZEN (satisfied). **EPIC-CALENDAR `CalendarEntry` frozen** (hard). EPIC-NOTIFICATIONS contract frozen. Feature flag live. Migration harness + snapshot ready.
- **Deliverables (target-state migration):**
  - Repurpose `work-requests` as broadcast **`JobRequest`** (skill × headcount; eligibility = matching skill ∧ free that day) — PIVOT §9.1.
  - **Direct assignment:** create `WorkerAssignment` from a `CalendarEntry` placement, **no accept step**; drop mandatory `application_id` — PIVOT §9.1.
  - **Remove `backend-work-applications` module + `WorkApplication` model** (retire marketplace apply/accept) — PIVOT §9.2.
  - Broadcast accept: **first-accept-wins** concurrency; 6-hour timer / manual close; slot-exhaustion "requirement fulfilled" notifications.
  - Migrations: daily-exclusivity partial unique index (PIVOT §9.4); capacity/double-booking CHECK + partial unique index; **forward + rollback**; dry-run on snapshot.
  - Re-home the `EXPECTED` `Attendance` seed (OQ-05) — coordinated with EPIC-ATTENDANCE (B6/SYNC-impl-1). Old cross-owner seed retired per ADR-018, not preserved.
  - **Release-prereq fix:** guard `PATCH /assignments/:id` (Critical) + 2 High.
- **Dependencies:** upstream: CALENDAR **[TARGET]**, HOTELWORKERS; contract: NOTIFICATIONS. Downstream: attendance, quality, analytics.
- **Acceptance criteria:** trace to `SPEC-JOB-DISPATCH-001` `REQ-*` (current-state removal AND target-state creation both mapped); marketplace apply/accept endpoints + `WorkApplication` absent (or flag-disabled) — asserted by a regression test; first-accept-wins proven under concurrency; migration rollback proven; Critical + 2 High closed with regression tests.
- **Parallelization:** ✕ with CALENDAR (upstream) and ATTENDANCE/QUALITY (downstream); ∥ GDPR cluster; web/mobile UI ⊳ its target contract.

### EPIC-ATTENDANCE — Geofenced Presence  *(FROZEN)*
- **Phase:** 4 · **Spec:** `SPEC-ATT-001 @0.2.0` **FROZEN** · **Module:** `backend-attendance`
- **Prerequisites:** Spec FROZEN (satisfied). EPIC-JOBDISPATCH target `WorkerAssignment` frozen (B5). NOTIFICATIONS contract frozen. Mobile location-permission scaffolding ready (from Phase 1).
- **Deliverables (target-state):**
  - **Geofenced Start/Close** replacing timestamp check-in/out; location sampled **only** at button press (never continuous).
  - **100 m geofence** enforcement; coordinate capture + storage at each clock-in/out; distance-to-hotel display **without revealing** exact hotel location.
  - **6-month hard-delete** scheduled sweep of coordinates (interlocks with EPIC-RETENTION model; the attendance-local sweep is in-scope here per spec).
  - Push-only notifications (CONFIRMED §18); confirmed-absent working-hours legal-limit warning (do not build it — CONFIRMED §28).
  - **Release-prereq fix:** cross-tenant hotel-scoping (OQ-02, High).
  - Receive the re-homed `EXPECTED` seed (B6) from job-dispatch.
- **Dependencies:** upstream: JOBDISPATCH; contract: NOTIFICATIONS; loose: GEO (geofence UX). Downstream: quality, analytics.
- **Acceptance criteria:** trace to `SPEC-ATT-001` `REQ-*`/`RULE-*`; geofence blocks Start/Close outside 100 m; coordinates deleted at exactly 6 months (sweep test with clock control); cross-tenant scoping closed with regression test.
- **Parallelization:** ✕ with quality (downstream); ∥ GDPR cluster; mobile worker geofence ∥ checker verification.

### EPIC-QUALITY — Verification & Ratings
- **Phase:** 4 · **Spec:** `SPEC-QUAL-001 @0.1.2` REVIEW · **Module:** `backend-quality`
- **Prerequisites:** `PRE: G2 freeze of SPEC-QUAL-001` (pending OQ-01 headline 1-5 vs 0-100 Rating reconciliation through OQ-09). EPIC-ATTENDANCE + EPIC-JOBDISPATCH contracts frozen.
- **Deliverables:** `QualityVerification` lifecycle; `Rating` + `WorkerOverallRating` recompute (incl. `on_time_rate` from attendance — `edge-quality-reads-attendance`); notifications on verification.
- **Dependencies:** upstream: ATTENDANCE, JOBDISPATCH; contract: NOTIFICATIONS. Downstream: analytics.
- **Acceptance criteria:** trace to `SPEC-QUAL-001` once frozen (Rating scale settled by OQ-01); recompute correctness tested; reads assignment + attendance only (no writes to them).
- **Parallelization:** ✕ after attendance; ∥ GDPR cluster.

### EPIC-NOTIFICATIONS — Delivery
- **Phase:** 2 (contract) + 5 (internals) · **Spec:** `SPEC-NOTIF-001 @0.1.1` REVIEW · **Module:** `backend-notifications`
- **Prerequisites:** `PRE: G2 freeze of SPEC-NOTIF-001`. EPIC-AUTH.
- **Deliverables:**
  - **Phase 2:** freeze + publish `notification-service` interface (`sendNotification`, `getNotifications`, `markAsRead`) as a stable fixture (B2).
  - **Phase 5:** push-only transport hardening (CONFIRMED §18); `NotificationType` category handling; delivery reliability. Contract unchanged from Phase 2.
- **Dependencies:** upstream: AUTH. Downstream (contract): work-requests, attendance, quality, broadcast JobRequest.
- **Acceptance criteria:** trace to `SPEC-NOTIF-001` once frozen; the four callers integrate against the frozen fixture; push delivery tested; fire-and-forget semantics preserved (a delivery failure never rolls back a caller's transaction).
- **Parallelization:** contract ∥ everything in Phase 2; internals ∥ analytics in Phase 5. **The plan's key parallel lever.**

### EPIC-ANALYTICS — Aggregation & Reporting
- **Phase:** 5 · **Spec:** `SPEC-ANALYTICS-001 @0.1.1` REVIEW (**security FAIL**) · **Module:** `backend-analytics`
- **Prerequisites:** `PRE: G2 freeze of SPEC-ANALYTICS-001` — **freeze is blocked by the security FAIL** (1 Critical/1 Medium). The Critical leaderboard-authz fix (EPIC-SECREM, Phase 0) must land first. All read-source epics (Phases 3–4) complete.
- **Deliverables:** read-only aggregation across owned domains (seven `edge-analytics-reads-*`); confirm the Phase 0 leaderboard authz fix present + regression-tested; no writes anywhere.
- **Dependencies:** upstream: QUALITY, ATTENDANCE, JOBDISPATCH, HOTELWORKERS (all read). Downstream: none (leaf).
- **Acceptance criteria:** trace to `SPEC-ANALYTICS-001` once frozen; **all** leaderboard routes authz-gated (Critical closed); analytics performs zero state writes (boundary test).
- **Parallelization:** ∥ NOTIFICATIONS internals; leaf, blocks nothing.

### EPIC-HR — HR, Contracts & Payslips  *(ADR-012, ADR-014)*
- **Phase:** 6 · **Spec:** `SPEC-HR-001` REVIEW · **Module:** `backend-hr` (stub today)
- **Prerequisites:** `PRE: G2 freeze of SPEC-HR-001`. EPIC-AUTH; EPIC-CONSENT gate. Replace `NotImplementedError` stub.
- **Deliverables:** contract lifecycle/templates/generation/versions/amendments/signatures/renewals/expiry/archival (ADR-012, no `backend-contracts`); payslip **request→fulfilment** state machine (`Requested → Fulfilled`, `RULE-HR-09/12`, `IF-HR-RequestPayslip`/`IF-HR-FulfilPayslipRequest`, ADR-014, no `backend-payslips`); close `active-no-tests`.
- **Dependencies:** upstream: AUTH, CONSENT. Downstream: onboarding, employee, mobile payslip request.
- **Acceptance criteria:** trace to `SPEC-HR-001` once frozen; payslip state machine enforced; a consumer can initiate payslip only via `IF-HR-*` (boundary test); no standalone contracts/payslips module exists.
- **Parallelization:** ∥ spine (Phases 3–5) once identity exists; internally precedes onboarding/employee.

### EPIC-ONBOARDING — Onboarding Workflow  *(ADR-013)*
- **Phase:** 6 · **Spec:** onboarding business specification (`docs/03-modules/onboarding/MODULE_SPEC.md`; no formal `SPEC-*` ID assigned) REVIEW · **Module:** `backend-onboarding` (zero-code)
- **Prerequisites:** `PRE: G2 freeze of the onboarding specification`. EPIC-HR, EPIC-CONSENT. `IF-CHATBOT-*` available (stub acceptable until Phase 7).
- **Deliverables:** onboarding workflow/state/steps/validation/completion/business rules; consumes Chatbot via `IF-CHATBOT-*` and Consent via `IF-CONSENT-*` (owns neither — ADR-013/015); resolves `OPQ-3` consent portion via Consent's interface.
- **Dependencies:** upstream: HR, CONSENT; contract: CHATBOT. Downstream: none.
- **Acceptance criteria:** trace to spec once frozen; onboarding never executes chatbot or consent logic first-person (boundary tests); works with a chatbot stub.
- **Parallelization:** ∥ documents/employee; after HR + consent.

### EPIC-EMPLOYEE — Employee Management
- **Phase:** 6 · **Spec:** `SPEC-EMP-001` REVIEW · **Module:** `backend-employee-management` (zero-code)
- **Prerequisites:** `PRE: G2 freeze`. EPIC-AUTH, EPIC-HR.
- **Deliverables:** employee record lifecycle per spec; consumes Documents/Contracts via interfaces.
- **Dependencies:** upstream: AUTH, HR; contract: DOCUMENTS.
- **Acceptance criteria:** trace to spec once frozen; ownership boundaries with HR/Documents respected.
- **Parallelization:** ∥ documents, onboarding.

### EPIC-DOCUMENTS — Document Storage
- **Phase:** 6 · **Spec:** `SPEC-DOCUMENTS-001 @0.1.2` REVIEW · **Module:** `backend-documents` (zero-code)
- **Prerequisites:** `PRE: G2 freeze` — **blocked by OD-DOC-005 (permission-half) + OD-DOC-007** (no document-level RBAC model), which block G2 per the G4 Security round. Resolve the RBAC/management-chain model first. EPIC-RETENTION (retention-tier), EPIC-CONSENT.
- **Deliverables:** document upload/storage/retrieval with the resolved RBAC model; retention-tier assignment (OD-DOC-001); self-scoping + manager-on-behalf-of-worker discipline on every `IF-DOC-*`.
- **Dependencies:** upstream: AUTH, RETENTION; contract: CONSENT. Downstream: employee, compliance, onboarding, chatbot (OD-CHAT-003).
- **Acceptance criteria:** trace to spec once frozen; RBAC model enforced (blocking decisions resolved); retention tier applied.
- **Parallelization:** ∥ HR/employee; RBAC decision is its gating risk.

### EPIC-CONSENT — Consent Lifecycle  *(ADR-015)*
- **Phase:** 6 (early) · **Spec:** `SPEC-CONSENT-001 @0.1.1` REVIEW · **Module:** `backend-consent` (zero-code)
- **Prerequisites:** `PRE: G2 freeze`. EPIC-AUTH. Owner assignment + 11 open decisions (SIR-CONSENT-001..011).
- **Deliverables:** consent lifecycle/records/versions/withdrawal/renewal/audit-history/validation; `IF-CONSENT-*` interfaces (GDPR access gate, CRR §24; one-time chatbot-consent).
- **Dependencies:** upstream: AUTH. Downstream: HR, onboarding, documents, employee, compliance, chatbot.
- **Acceptance criteria:** trace to spec once frozen; consumers request consent only via `IF-CONSENT-*` (no consent logic outside this module — ADR-015 boundary test).
- **Parallelization:** **runs first inside Phase 6** (cross-cutting gate); ∥ RETENTION.

### EPIC-COMPLIANCE — Governance & Reporting  *(read-only, ADR-016)*
- **Phase:** 6 · **Spec:** `SPEC-COMPLIANCE-001 @0.1.0` REVIEW · **Module:** `backend-compliance` (zero-code)
- **Prerequisites:** `PRE: G2 freeze`. EPIC-AUTH; read access to Consent/Retention/Documents/AuditLog.
- **Deliverables:** governance, verification, reporting, policy evaluation, evidence generation, regulatory workflows; **read-only** consumer of `AuditLog` (ADR-016), Consent, Retention's deletion-audit, Documents' worker-scoped retrievability. **Never** a writer/lifecycle owner.
- **Dependencies:** upstream: AUTH; contract (read): CONSENT, RETENTION, DOCUMENTS. Downstream: none (leaf).
- **Acceptance criteria:** trace to spec once frozen; **zero write** to `AuditLog`/Consent/Retention/Documents (boundary test — ADR-016).
- **Parallelization:** leaf; ∥ everything in Phase 6; consumes only frozen read contracts.

### EPIC-RETENTION — GDPR Retention
- **Phase:** 6 (early) · **Spec:** `SPEC-RETENTION-001 @0.2.0` REVIEW · **Module:** `backend-retention` (zero-code)
- **Prerequisites:** `PRE: G2 freeze`. EPIC-AUTH. OD-RETENTION-01/05/10/14.
- **Deliverables:** three-tier retention-classification model; `RetentionLog`; **daily automatic-deletion sweep** job; `IF-RETENTION-*` interfaces.
- **Dependencies:** upstream: AUTH. Downstream: documents, compliance (reads deletion-audit); model aligns with attendance's 6-month coordinate sweep.
- **Acceptance criteria:** trace to spec once frozen; daily sweep deletes per tier (clock-controlled test); `RetentionLog` records every deletion.
- **Parallelization:** runs early in Phase 6 with CONSENT (cross-cutting gate).

### EPIC-CHATBOT — AI Capability  *(ADR-013)*
- **Phase:** 7 · **Spec:** `SPEC-CHATBOT-001 @0.1.3` REVIEW · **Module:** `backend-chatbot` (placeholder-unregistered)
- **Prerequisites:** `PRE: G2 freeze` — **blocked by OD-CHAT-005 (conversation RBAC) + OD-CHAT-006 (prompt-injection guardrail)**. EPIC-AUTH; `IF-CONSENT-*`; optional Documents (OD-CHAT-003).
- **Deliverables:** conversation lifecycle, provider abstraction, prompts, orchestration, context assembly, tool execution (scope per OD-CHAT-002), memory, AI sessions, token/cost management, **guardrails** (prompt-injection resistance), AI audit; **route-register** the currently-unregistered module.
- **Dependencies:** upstream: AUTH; contract: CONSENT, DOCUMENTS. Downstream: onboarding (`IF-CHATBOT-*`).
- **Acceptance criteria:** trace to spec once frozen; guardrail design (OD-CHAT-006) implemented + tested; conversation RBAC enforced; module route-registered and reachable.
- **Parallelization:** ∥ GEO; terminal (blocks nothing but its own onboarding consumer, which uses a stub earlier).

### EPIC-GEO — Geo Services
- **Phase:** 7 · **Spec:** `SPEC-GEO-001 @0.1.1` REVIEW · **Module:** `backend-geo` (placeholder-unregistered)
- **Prerequisites:** `PRE: G2 freeze` — blocked by OD-GEO-001/002 (ownership split) + owner assignment. EPIC-AUTH.
- **Deliverables:** geo services per resolved ownership split; **route-register** the module; support attendance geofence UX (loose coupling).
- **Dependencies:** upstream: AUTH; loose downstream: attendance geofence UX.
- **Acceptance criteria:** trace to spec once frozen; ownership split (OD-GEO-001/002) honored; module route-registered.
- **Parallelization:** ∥ CHATBOT.

---

## Client Epics

### EPIC-FE-WEB — Web Client
- **Phase:** continuous track · **Spec:** none (UNKNOWN) · **Surface:** `frontend/` (Next.js)
- **Prerequisites:** each backend contract frozen before the screen that consumes it is built.
- **Deliverables (in contract order):** auth/login/role-routing → hotel/CRM console + roster (fix `edge-frontend-crm` per_page truncation, OD-CRM-08) → **calendar placement UI + broadcast JobRequest UI (retire marketplace screens on the shared flag)** → attendance/quality dashboards → analytics (leaderboard only after authz fix) → HR/GDPR admin.
- **Dependencies:** consumes every backend contract (`frontend/lib/api.ts` edges). Writes no backend files.
- **Acceptance criteria:** every screen built against a **frozen** contract; retired marketplace screens gone on cutover; leaderboard view gated behind the analytics authz fix.
- **Parallelization:** ∥ all backend + both mobile tracks.

### EPIC-MOBILE-WORKER — Worker App
- **Phase:** continuous track · **Spec:** none · **Surface:** `mobile/worker-app` (Expo)
- **Prerequisites:** contracts frozen; location-permission scaffolding begun in Phase 1.
- **Deliverables:** auth/session → **replace browse&apply (`app/job/[id].tsx`, `src/lib/api.ts:173-183`) with "my calendar / assigned shifts" + broadcast-offer accept** → **geofenced Start/Close** (permission, 100 m gate, coordinate capture, distance display) → push notifications, assignments, HR payslip request, analytics read.
- **Dependencies:** consumes auth, dispatch, attendance, hr, notifications, analytics contracts.
- **Acceptance criteria:** apply/withdraw calls removed on cutover; geofence UX matches `SPEC-ATT-001`; built only against frozen contracts.
- **Parallelization:** ∥ web + checker tracks.

### EPIC-MOBILE-CHECKER — Checker App
- **Phase:** continuous track · **Spec:** none · **Surface:** `mobile/checker-app` (Expo)
- **Prerequisites:** contracts frozen.
- **Deliverables:** auth/session → attendance verification + quality capture → push notifications.
- **Dependencies:** consumes auth, attendance, quality, notifications contracts.
- **Acceptance criteria:** verification/quality-capture match frozen specs; built only against frozen contracts.
- **Parallelization:** ∥ web + worker tracks.

---

## Backlog Coverage Check

| Registered module / surface (`MODULE_REGISTRY.yaml`) | Epic |
|---|---|
| backend-auth | EPIC-AUTH |
| backend-users | EPIC-USERS |
| backend-crm (+hotels) | EPIC-CRM |
| backend-hotel-workers | EPIC-HOTELWORKERS |
| backend-work-requests / -applications / -assignments | EPIC-JOBDISPATCH |
| backend-attendance | EPIC-ATTENDANCE |
| backend-quality | EPIC-QUALITY |
| backend-hr (+contracts +payslips) | EPIC-HR |
| backend-notifications | EPIC-NOTIFICATIONS |
| backend-analytics | EPIC-ANALYTICS |
| backend-calendar (+scheduling) | EPIC-CALENDAR |
| backend-chatbot | EPIC-CHATBOT |
| backend-geo | EPIC-GEO |
| backend-onboarding | EPIC-ONBOARDING |
| backend-employee-management | EPIC-EMPLOYEE |
| backend-documents | EPIC-DOCUMENTS |
| backend-consent | EPIC-CONSENT |
| backend-compliance | EPIC-COMPLIANCE |
| backend-retention | EPIC-RETENTION |
| frontend-web | EPIC-FE-WEB |
| mobile-worker | EPIC-MOBILE-WORKER |
| mobile-checker | EPIC-MOBILE-CHECKER |
| operations | EPIC-PLATFORM |
| (cross-cutting security) | EPIC-SECREM |
| (governance/ownership) | EPIC-OWNERSHIP |

Every registered module and surface maps to exactly one epic. Ownership-consolidated capabilities
(Hotels→CRM, Contracts/Payslips→HR, Scheduling→Calendar) carry no standalone epic, per
ADR-011/012/014.
