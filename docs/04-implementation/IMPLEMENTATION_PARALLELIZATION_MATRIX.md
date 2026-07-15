# Implementation Parallelization Matrix — Workforce Operations Platform

| Field | Value |
|---|---|
| Artifact ID | `ART-PLAN-001` companion (parallelization matrix) |
| Parent | [IMPLEMENTATION_MASTER_PLAN.md](IMPLEMENTATION_MASTER_PLAN.md) |
| Derived from | [IMPLEMENTATION_DEPENDENCY_GRAPH.md](IMPLEMENTATION_DEPENDENCY_GRAPH.md), `.claude/workflows/implementation.md` (SYNC-impl-1) |
| Baseline revision | `09e0b162297162c8a93975ce55ccd3c406218606` |
| Status | Draft for G3 review |

> **Governing rule** (`.claude/workflows/implementation.md` §Synchronization Points): *"Parallel
> implementers MUST NOT write to the same file or share unreviewed intermediate output; where a
> shared boundary exists, the producer's contract-frozen fixture is consumed instead of the
> producer's in-flight diff."* Independent surfaces may run in parallel **only after contracts
> freeze**. This matrix says exactly what may run at the same time, what the barriers are, and who
> owns each serialized resource.

---

## 1. The two levers that create parallelism

1. **Contract-before-internals split.** A downstream epic needs only an upstream's *frozen
   interface*, not its finished code. The clearest case is **notifications**: freeze
   `notification-service` in Phase 2, and all four callers (work-requests, attendance, quality,
   broadcast JobRequest) integrate against the frozen fixture while notification *internals* are
   still being hardened in Phase 5.
2. **Surface independence.** Backend, web, and the two mobile apps are separate workspaces
   (`npm` workspaces, `package.json`). Once a backend contract freezes, the web and mobile teams
   build against it in parallel with each other and with later backend epics.

---

## 2. Serialized (single-owner) resources — the anti-parallel list

These MUST NOT have two concurrent writers. Each gets one owner per phase.

| Resource | Why serialized | Owner rule |
|---|---|---|
| `backend/prisma/schema.prisma` | Shared unowned data contract; concurrent migrations corrupt each other | One **migration owner per phase** (see Dependency Graph §7) |
| `backend/src/routes/v1/index.ts` | Single route-registration file for all modules | Edited only at each module's mount step; batch per phase |
| `backend/src/middleware/*` (`auth`, `permissions`, `validation`) | Cross-module contracts owned by EPIC-AUTH | Changed only in Phase 1; frozen thereafter |
| `backend/src/lib/base-service.ts` | Base every service extends | Changed only in Phase 0/1; frozen thereafter |
| The pivot feature flag | Coordinates backend + web + mobile cutover atomically | One flag owner (Infrastructure Engineer) across all three surfaces |

---

## 3. Parallelization matrix (epic × epic)

Legend: **∥** = may run fully in parallel · **⊳** = may start once the other's *contract* freezes
(contract-only) · **✕** = must be sequenced (hard dependency) · **⚠** = parallel but shares a
serialized resource → coordinate via SYNC-impl-1.

| ↓ vs → | AUTH | USERS | CRM | HOTELWK | CALENDAR | JOBDISP | ATTEND | QUALITY | NOTIF | ANALYT | GDPR* | CHATBOT/GEO |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AUTH** | — | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| **USERS** | ✕ | — | ∥ | ⊳ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ |
| **CRM** | ✕ | ∥ | — | ✕ | ⊳ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ |
| **HOTELWK** | ✕ | ⊳ | ✕ | — | ✕ | ✕ | ∥ | ∥ | ∥ | ⊳ | ∥ | ∥ |
| **CALENDAR** | ✕ | ∥ | ⊳ | ✕ | — | ✕ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ |
| **JOBDISP** | ✕ | ∥ | ∥ | ✕ | ✕ | — | ✕ | ✕ | ⊳ | ⊳ | ∥ | ∥ |
| **ATTEND** | ✕ | ∥ | ∥ | ∥ | ∥ | ✕ | — | ✕ | ⊳ | ⊳ | ∥ | ⊳ |
| **QUALITY** | ✕ | ∥ | ∥ | ∥ | ∥ | ✕ | ✕ | — | ⊳ | ⊳ | ∥ | ∥ |
| **NOTIF** | ✕ | ∥ | ∥ | ∥ | ∥ | ⊳ | ⊳ | ⊳ | — | ∥ | ∥ | ∥ |
| **ANALYT** | ✕ | ∥ | ∥ | ⊳ | ∥ | ⊳ | ⊳ | ⊳ | ∥ | — | ∥ | ∥ |
| **GDPR*** | ✕ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ∥ | ⚠ | ∥ |
| **CHATBOT/GEO** | ✕ | ∥ | ∥ | ∥ | ∥ | ∥ | ⊳ | ∥ | ∥ | ∥ | ∥ | ⚠ |

`*` **GDPR** = the Phase 6 lifecycle cluster (HR, ONBOARDING, EMPLOYEE, DOCUMENTS, CONSENT,
COMPLIANCE, RETENTION). Internally it has ordering (`CONSENT ⇢ RETENTION` before their consumers;
HR before onboarding/employee) — hence **⚠** with itself: parallel where the sub-graph permits,
serialized on shared `schema.prisma`.

**Reading the matrix:** AUTH's entire row/column is **✕** — nothing parallelizes with the thing
everything imports; it is the universal predecessor. The bottom-right block (GDPR, CHATBOT/GEO) is
mostly **∥** with the spine — the lifecycle and assistive stacks float alongside Phases 3–5 once
identity exists.

---

## 4. Concurrent execution waves

Wave = a set of work items with no unresolved hard dependency among them. A wave opens when its
entry gate passes; items inside a wave run in parallel across engineers/surfaces.

### Wave 0 (Phase 0)
- Infra: CI gates ∥ migration harness ∥ observability ∥ feature-flag mechanism.
- Backend: analytics-leaderboard hotfix (independent, live-defect).
- Governance: owner assignment (human, off the code path).
> All four fully parallel — no shared code among them except CI config.

### Wave 1 (Phase 1)
- Backend: **EPIC-AUTH** (serial internally — it owns middleware + base-service).
- Mobile: location-permission scaffolding on both apps ∥ AUTH (no backend dependency).
> USERS waits for the AUTH middleware freeze (**✕**), then joins.

### Wave 2 (Phase 2) — opens at AUTH contract freeze
Parallel:
- **EPIC-CRM** (owns `Hotel`) ∥ **EPIC-USERS** (bounded profiles).
- **EPIC-NOTIFICATIONS contract** authoring (∥ everything; freeze the interface).
- Web: auth/login/routing shell (consumes frozen auth).
Sequenced inside the wave: **EPIC-HOTELWORKERS** starts after CRM's `Hotel` contract freezes (✕).

### Wave 3 (Phase 3) — opens at CALENDAR G2 freeze  *(headline)*
Mostly serial on the spine:
- **EPIC-CALENDAR** → **EPIC-JOBDISPATCH** (✕: CalendarEntry precedes direct assignment).
- Parallel behind the spine: **GDPR cluster** (Phase 6 work can begin here — depends only on AUTH).
- Web + mobile: calendar/broadcast UI **⊳** the JOBDISPATCH target contract; retire marketplace
  screens on the shared flag.
> Migration is serialized: CalendarEntry/JobRequest/drop-application_id/drop-WorkApplication all
> on one migration owner.

### Wave 4 (Phase 4) — opens at JOBDISPATCH `WorkerAssignment` shape freeze
- **EPIC-ATTENDANCE** ∥ **EPIC-QUALITY**? — **No**: quality reads attendance (✕). Sequence
  attendance → quality. But attendance ∥ any Phase 6 GDPR item.
- Mobile: geofenced Start/Close (worker) ∥ verification (checker), both **⊳** attendance contract.

### Wave 5 (Phase 5) — opens at QUALITY freeze
- **EPIC-ANALYTICS** (leaf; reads everything) ∥ **EPIC-NOTIFICATIONS internals** (contract already
  frozen since Wave 2 — pure parallel).

### Wave 6 (Phase 6) — runs alongside Waves 3–5 (entry: AUTH only)
- Internal order: `CONSENT ⇢ RETENTION` → {HR → ONBOARDING/EMPLOYEE, DOCUMENTS} → COMPLIANCE.
- Within that order, HR ∥ DOCUMENTS ∥ EMPLOYEE where they don't share `schema.prisma` concurrently.

### Wave 7 (Phase 7)
- **EPIC-CHATBOT** ∥ **EPIC-GEO** (independent), both gated on their own open decisions.

---

## 5. SYNC-impl-1 contract barriers

The Implementation Workflow defines **SYNC-impl-1** as the contract-integration barrier: a
producer completes its contract-side change before consumers run integration checks. The barriers
in this plan:

| Barrier | Producer completes | Consumers may then integrate |
|---|---|---|
| B1 — Authz middleware | EPIC-AUTH freezes `auth-middleware`/`permissions-middleware` | every route-gated module |
| B2 — Notification contract | EPIC-NOTIFICATIONS freezes `notification-service` interface | work-requests, attendance, quality, broadcast JobRequest |
| B3 — Hotel/roster state | CRM + hotel-workers freeze `Hotel`/`HotelWorker` shapes | calendar, job-dispatch, analytics |
| B4 — CalendarEntry | EPIC-CALENDAR freezes `CalendarEntry` | EPIC-JOBDISPATCH (direct assignment) |
| B5 — WorkerAssignment (target) | EPIC-JOBDISPATCH freezes target `WorkerAssignment` (no `application_id`) | attendance, quality, analytics |
| B6 — EXPECTED-seed re-home | JOBDISPATCH + ATTENDANCE agree seed ownership (OQ-05, ADR-018) | attendance start/close flow |
| B7 — Consent/Retention gates | CONSENT + RETENTION freeze `IF-CONSENT-*`/`IF-RETENTION-*` | HR, documents, onboarding, employee, compliance |
| B8 — Chatbot interface | CHATBOT freezes `IF-CHATBOT-*` (or a stub contract earlier) | onboarding |

**B6 is the delicate one:** it spans two epics in two phases and undoes a cross-owner write
pattern. It gets a dedicated coordinated work item and an explicit join, per Master Plan R5.

---

## 6. Surface-track parallelism (clients)

The three client epics run as **continuous tracks**, not a phase. Each consumes backend contracts
as they freeze:

| Client track | Consumes (in order) | Parallel with |
|---|---|---|
| **EPIC-FE-WEB** | auth → crm/roster → calendar+dispatch → attendance/quality → analytics → GDPR admin | all backend epics after the contract it needs freezes |
| **EPIC-MOBILE-WORKER** | auth → (retire apply/rebuild calendar+broadcast) → geofenced attendance → notifications/hr/analytics | web track; later backend epics |
| **EPIC-MOBILE-CHECKER** | auth → attendance-verify + quality-capture → notifications | web + worker tracks |

Because clients only ever *consume* frozen contracts and never write backend files, all three run
in parallel with each other and with backend work — the only rule is **never build a client screen
against an unfrozen contract** (it would be building against an unfrozen spec by proxy).

---

## 7. Maximum concurrency snapshot (mid-program, ~Phase 3–5 overlap)

At peak, these can be in flight simultaneously without violating any barrier:

- Backend spine: EPIC-JOBDISPATCH (Phase 3) **or** EPIC-ATTENDANCE/QUALITY (Phase 4) — serial spine, one at a time.
- Backend parallel: EPIC-NOTIFICATIONS internals; the entire GDPR cluster (CONSENT→RETENTION→HR→…).
- Web track: whichever contract just froze.
- Mobile worker track + mobile checker track: independent screens.
- Infra: migration owner for the current phase; observability/runbook updates.

That is **~5–7 concurrent work streams** with one serialized spine and one serialized migration
track — the ceiling the dependency graph allows.
