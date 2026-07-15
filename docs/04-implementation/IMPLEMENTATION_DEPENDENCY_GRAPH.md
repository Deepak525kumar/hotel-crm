# Implementation Dependency Graph — Workforce Operations Platform

| Field | Value |
|---|---|
| Artifact ID | `ART-PLAN-001` companion (execution DAG) |
| Parent | [IMPLEMENTATION_MASTER_PLAN.md](IMPLEMENTATION_MASTER_PLAN.md) |
| Derived from | `.claude/knowledge/DEPENDENCY_GRAPH.yaml`, `.claude/knowledge/MODULE_REGISTRY.yaml`, `.claude/knowledge/STATE_OWNERSHIP_INDEX.yaml`, the three FROZEN specs |
| Baseline revision | `09e0b162297162c8a93975ce55ccd3c406218606` |
| Status | Draft for G3 review |

> This document is the **execution DAG**: what each epic must wait for, why (with repository
> evidence), the dependency order, and the critical path. Every edge is grounded in an observed
> code relationship (`DEPENDENCY_GRAPH.yaml`) or a frozen-spec `[TARGET STATE]` requirement.
> Where an edge is a *target-state* dependency (does not yet exist in code), it is marked
> **`[TARGET]`**.

---

## 1. Dependency Legend

- **`→` (hard):** downstream epic cannot reach G5 until the upstream **contract** is frozen.
- **`⇢` (contract-only):** downstream needs only the upstream's frozen interface/fixture, not its
  finished internals (enables early parallel start — see the Parallelization Matrix).
- **`[TARGET]`:** dependency introduced by the pivot; not present in current code.
- Evidence citations use `DEPENDENCY_GRAPH.yaml` edge IDs and `path:line` where available.

---

## 2. Foundational (cross-cutting) dependencies

Every backend epic depends on these; they are drawn once here rather than repeated per epic.

| Shared dependency | Nature | Evidence | Consumers |
|---|---|---|---|
| `prisma-schema` | Central data contract; all modules use `@prisma/client` + shared `PrismaClient` | `DEPENDENCY_GRAPH.yaml` contracts.prisma-schema | all 11+ active backend modules |
| `base-service` | Abstract base every service extends; provides Prisma access + `logAudit` (writes `state-audit-log`) | `backend/src/lib/base-service.ts:5,19` | all 13 backend services |
| `auth-middleware` | `authMiddleware`/`optionalAuthMiddleware`; global on v1 router + per-module | `backend/src/middleware/auth.ts` | ~13 modules |
| `permissions-middleware` | `requireRole`/`requirePermission`/`checkHotelAccess` | `backend/src/middleware/permissions.ts` | ~10 modules |
| `notification-service` | `sendNotification` fire-and-forget | `backend/src/modules/notifications/service.ts` | work-requests, work-applications, attendance, quality |

**Implication:** `prisma-schema` and `base-service` are owned by no single module (`owner:
unassigned`), so **schema migrations must be serialized under one migration owner per phase**
(Master Plan R7). `auth-middleware`/`permissions-middleware` come from **EPIC-AUTH**, making auth
a universal upstream.

---

## 3. Epic-level execution DAG

```
                         ┌─────────────────┐
                         │  EPIC-PLATFORM  │  (CI gates, migration/rollback harness,
                         │  (Phase 0)      │   feature flags, observability)
                         └───────┬─────────┘
                                 │ enables everything
                                 ▼
                         ┌─────────────────┐
                         │   EPIC-AUTH     │  FROZEN — publishes auth-middleware +
                         │  (Phase 1)      │  permissions-middleware; AuditLog writer (ADR-016);
                         └───┬────────┬────┘  User authoritative writer (ADR-017)
              ⇢ contract     │        │  ⇢ contract
        ┌───────────────────┘        └───────────────────┐
        ▼                                                ▼
┌───────────────┐                                ┌────────────────┐
│  EPIC-USERS   │  bounded profile writer        │  (all modules) │  consume authz middleware
│  (Phase 1)    │  (ADR-017)                     └────────────────┘
└───────────────┘
        │
        ▼  (identity in place)
┌───────────────┐        ┌──────────────────────┐
│   EPIC-CRM    │──────▶ │  EPIC-HOTELWORKERS   │  hotel-workers reads Hotel
│  (Phase 2)    │ Hotel  │  (Phase 2)           │  (edge-hotel-workers-reads-hotel)
│  +Hotels      │ state  └───────────┬──────────┘  authoritative writer of HotelWorker
└───────┬───────┘                    │
        │ pause-jobs contract        │ roster (state-hotel-worker)
        │ (OD-CRM-16)                │
        └──────────────┬─────────────┘
                       ▼
              ┌──────────────────┐
              │  EPIC-CALENDAR   │  [TARGET] CalendarEntry — PRIMARY dispatch tier foundation
              │  (Phase 3)       │  (PIVOT §9.3); +Scheduling (ADR-011)
              └────────┬─────────┘
                       ▼
        ┌───────────────────────────────┐   ⇢ notification-service (contract frozen Phase 2)
        │        EPIC-JOBDISPATCH        │◀───────────────────────────────┐
        │        (Phase 3, FROZEN)       │                                │
        │  • direct assignment from      │                     ┌──────────┴─────────┐
        │    CalendarEntry [TARGET]      │                     │ EPIC-NOTIFICATIONS │
        │  • broadcast JobRequest        │                     │  contract (Ph 2)   │
        │  • REMOVE WorkApplication      │                     │  internals (Ph 5)  │
        │  • daily-exclusivity index     │                     └──────────┬─────────┘
        └───────────────┬───────────────┘                                │
                        │ WorkerAssignment (confirmed)                   │
                        ▼                                                │
              ┌──────────────────┐                                      │
              │  EPIC-ATTENDANCE │  reads WorkerAssignment               │
              │  (Phase 4,FROZEN)│  (edge-attendance-reads-worker-assignment)
              │  [TARGET]geofence│  calls notifications ─────────────────┤
              └────────┬─────────┘                                      │
                       │ Attendance                                     │
                       ▼                                                │
              ┌──────────────────┐                                      │
              │   EPIC-QUALITY   │  reads WorkerAssignment + Attendance  │
              │  (Phase 4)       │  calls notifications ─────────────────┤
              └────────┬─────────┘                                      │
                       │ QualityVerification, Rating, WorkerOverallRating
                       ▼                                                │
              ┌──────────────────┐                                      │
              │  EPIC-ANALYTICS  │  read-only aggregator across ALL owned domains (leaf)
              │  (Phase 5)       │  reads work-request, worker-assignment, attendance,
              │  +security fix   │  quality-verification, rating, worker-overall-rating, hotel-worker
              └──────────────────┘

  ── GDPR / lifecycle stack (Phase 6, parallel behind identity) ──
    EPIC-CONSENT ⇢ EPIC-RETENTION  →  consumed by HR, ONBOARDING, EMPLOYEE, DOCUMENTS
    EPIC-HR (+Contracts +Payslips) → EPIC-ONBOARDING (consumes IF-CHATBOT-* stub, IF-CONSENT-*)
    EPIC-DOCUMENTS, EPIC-EMPLOYEE
    EPIC-COMPLIANCE  (read-only consumer of AuditLog/Consent/Retention/Documents — ADR-016)

  ── Assistive (Phase 7) ──
    EPIC-CHATBOT (blocked: OD-CHAT-005/006) ,  EPIC-GEO (blocked: OD-GEO-001/002)

  ── Client tracks (continuous, consume each contract after freeze) ──
    EPIC-FE-WEB , EPIC-MOBILE-WORKER , EPIC-MOBILE-CHECKER
```

---

## 4. Per-epic dependency table

| Epic | Hard upstream (`→`) | Contract-only upstream (`⇢`) | Downstream consumers | Key evidence |
|---|---|---|---|---|
| EPIC-PLATFORM | — | — | all | CI/compose/nginx/ecosystem |
| EPIC-AUTH | EPIC-PLATFORM | — | every module (authz), users, audit | `middleware/auth.ts`, ADR-016/017 |
| EPIC-USERS | EPIC-AUTH | — | hotel-workers (reads User) | ADR-017; `edge-hotel-workers-reads-user` |
| EPIC-CRM | EPIC-AUTH | — | hotel-workers, work-requests (reads Hotel) | `edge-work-requests-reads-hotel`, ADR-011 |
| EPIC-HOTELWORKERS | EPIC-CRM, EPIC-USERS | — | work-requests, work-applications*, assignments, users, analytics | `state-hotel-worker` readers |
| EPIC-NOTIFICATIONS | EPIC-AUTH | — | work-requests, work-applications*, attendance, quality | four `calls` edges |
| EPIC-CALENDAR | EPIC-HOTELWORKERS, EPIC-CRM | — | job-dispatch **[TARGET]** | PIVOT §9.3; ADR-011 |
| EPIC-JOBDISPATCH | **EPIC-CALENDAR [TARGET]**, EPIC-HOTELWORKERS | EPIC-NOTIFICATIONS | attendance, quality, analytics | `SPEC-JOB-DISPATCH-001`; ADR-018 |
| EPIC-ATTENDANCE | EPIC-JOBDISPATCH | EPIC-NOTIFICATIONS | quality, analytics | `edge-attendance-reads-worker-assignment` |
| EPIC-QUALITY | EPIC-ATTENDANCE, EPIC-JOBDISPATCH | EPIC-NOTIFICATIONS | analytics | `edge-quality-reads-*` |
| EPIC-ANALYTICS | EPIC-QUALITY, EPIC-ATTENDANCE, EPIC-JOBDISPATCH, EPIC-HOTELWORKERS | — | (leaf) | seven `edge-analytics-reads-*` edges |
| EPIC-CONSENT | EPIC-AUTH | — | HR, onboarding, employee, documents, compliance | ADR-015; `IF-CONSENT-*` |
| EPIC-RETENTION | EPIC-AUTH | — | documents, compliance, attendance (sweep model) | `SPEC-RETENTION-001`; `IF-RETENTION-*` |
| EPIC-HR | EPIC-AUTH, EPIC-CONSENT | — | onboarding, employee, mobile payslip | ADR-012/014 |
| EPIC-ONBOARDING | EPIC-HR, EPIC-CONSENT | EPIC-CHATBOT (`IF-CHATBOT-*`, stubbable) | — | ADR-013 |
| EPIC-EMPLOYEE | EPIC-AUTH, EPIC-HR | EPIC-DOCUMENTS | — | `SPEC-EMP-001` |
| EPIC-DOCUMENTS | EPIC-AUTH, EPIC-RETENTION | EPIC-CONSENT | employee, compliance, onboarding | `SPEC-DOCUMENTS-001` (OD-DOC-005/007) |
| EPIC-COMPLIANCE | EPIC-AUTH | EPIC-CONSENT, EPIC-RETENTION, EPIC-DOCUMENTS (all read-only) | (leaf) | ADR-016 (read-only) |
| EPIC-CHATBOT | EPIC-AUTH | EPIC-DOCUMENTS (OD-CHAT-003) | onboarding (`IF-CHATBOT-*`) | ADR-013; OD-CHAT-005/006 |
| EPIC-GEO | EPIC-AUTH | — | attendance geofence UX (loose) | `SPEC-GEO-001`; OD-GEO-001/002 |
| EPIC-FE-WEB | per-contract (auth→crm→dispatch→…) | all backend contracts | users | `frontend/lib/api.ts` edges |
| EPIC-MOBILE-WORKER | per-contract | auth, dispatch, attendance, hr, notifications, analytics | workers | `mobile/worker-app/src/lib/api.ts` edges |
| EPIC-MOBILE-CHECKER | per-contract | auth, attendance, quality, notifications | checkers | `mobile/checker-app/src/lib/api.ts` edges |

`*` `backend-work-applications` is **removed** in target-state (ADR-018); its edges exist only in
current-state and are retired during EPIC-JOBDISPATCH.

---

## 5. Critical path

The critical path is the longest chain of **hard** dependencies gating the headline pivot release
(M3) and the full presence/insight stack (M4/M5):

```
EPIC-PLATFORM → EPIC-AUTH → EPIC-CRM → EPIC-HOTELWORKERS → EPIC-CALENDAR
   → EPIC-JOBDISPATCH → EPIC-ATTENDANCE → EPIC-QUALITY → EPIC-ANALYTICS
```

**Why each link is on the path (not shortcuttable):**

1. **PLATFORM → AUTH** — auth needs the migration harness and CI gates; auth ships the authz
   middleware ~13 modules import.
2. **AUTH → CRM** — CRM's routes gate on `requireRole`/`checkHotelAccess` (`permissions-middleware`).
3. **CRM → HOTELWORKERS** — hotel-workers reads `Hotel` (`edge-hotel-workers-reads-hotel`,
   `service.ts:37,87`).
4. **HOTELWORKERS → CALENDAR** — calendar placement targets rostered workers; eligibility ("free
   that day") is defined over the roster.
5. **CALENDAR → JOBDISPATCH** *(TARGET)* — the PRIMARY dispatch tier *is* calendar-day placement;
   `WorkerAssignment` is created from a `CalendarEntry` (PIVOT §9.1/§9.3). Job-dispatch cannot
   reach its target-state without `CalendarEntry`.
6. **JOBDISPATCH → ATTENDANCE** — attendance is keyed to a confirmed `WorkerAssignment`
   (`edge-attendance-reads-worker-assignment`, `service.ts:35,195`).
7. **ATTENDANCE → QUALITY** — quality reads assignment + attendance
   (`edge-quality-reads-worker-assignment`, `edge-quality-reads-attendance`).
8. **QUALITY → ANALYTICS** — analytics aggregates quality/rating outputs
   (`edge-analytics-reads-quality-verification`, `-rating`, `-worker-overall-rating`).

**The critical-path risk is CALENDAR** (Master Plan R2): it is on the spine but its spec is
`REVIEW` and its code is a `NotImplementedError` stub. **Its G2 freeze is the single highest
sequencing priority** — every phase from 3 onward waits behind it.

**Off critical path (can float):**
- `EPIC-NOTIFICATIONS` — leaf dependency; only its *contract* is on the path (freeze Phase 2),
  internals float to Phase 5.
- The **entire Phase 6 GDPR/lifecycle stack** depends only on AUTH (+ Consent/Retention among
  themselves) and can proceed in parallel with Phases 3–5 once identity is in place.
- `EPIC-CHATBOT`/`EPIC-GEO` — terminal; blocked on their own open decisions, never blocking others
  (onboarding consumes chatbot through a stubbable `IF-CHATBOT-*` interface).

---

## 6. Cycles & coupling notes

- **No code-import cycle exists** (`DEPENDENCY_GRAPH.yaml` analysis.circular_dependencies:
  `code_imports: none`). The only cross-module import is the `notification-service` singleton.
- A **data-level bidirectional coupling** between `backend-work-requests` and
  `backend-work-applications` exists in current-state (work-requests reads `WorkApplication`;
  work-applications reads+writes `WorkRequest`). This coupling is **retired by the pivot** —
  `WorkApplication` is removed — so it does not constrain the target-state ordering. It only
  matters as *migration* care during EPIC-JOBDISPATCH.
- The **accept-transaction cross-owner writes** (work-applications writing `WorkRequest`,
  `WorkerAssignment`, `Attendance` — `edge-work-applications-writes-*`) are **ADR-018
  superseded-by-pivot**. Implementation removes them; it does not preserve them as a pattern. The
  `EXPECTED`-seed re-homing (OQ-05) is a coordinated JOBDISPATCH↔ATTENDANCE work item at the
  Phase 3/4 boundary (SYNC-impl-1 barrier).

---

## 7. Schema-migration ordering (single serialized track)

Because `prisma-schema` is a shared unowned contract, migrations are ordered on one track to avoid
parallel writers colliding on `backend/prisma/schema.prisma`:

1. Phase 1 — auth: `PasswordResetToken` (already added), session/MFA fields.
2. Phase 2 — CRM/hotel-workers: any `Hotel`/`HotelWorker` field additions.
3. Phase 3 — **pivot**: add `CalendarEntry`, add `JobRequest`, drop mandatory `application_id`,
   add daily-exclusivity partial unique index + capacity CHECK, then (deprecation window) drop
   `WorkApplication`. Forward + rollback for each; dry-run on snapshot.
4. Phase 4 — attendance: coordinate columns; index for the 6-month sweep.
5. Phase 6 — GDPR: `RetentionLog`, `Consent`, HR/contract/payslip/document/onboarding models.
6. Phase 7 — chatbot/geo models.

Each step is owned by that phase's single migration owner; no two open migrations touch
`schema.prisma` concurrently (Master Plan R7).
