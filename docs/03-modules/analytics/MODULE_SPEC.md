# Module Specification: `analytics` (backend-analytics)

> Specification of ONE bounded backend capability — **read-only cross-module analytics
> aggregation** — implemented by the single module `backend-analytics`. This capability is
> **MID-PIVOT**. It carries labeled layers: `[CURRENT STATE]` — already-implemented
> leaderboard/dashboard-stats/hotel-summary aggregation, reverse-specified at repository revision
> `ef25dae6`; `[TARGET STATE]` — the confirmed "basic analytics" scope (active workers/day, rooms
> completed per worker, rating/warning counts, sick/vacation counts per hotel), which is largely
> unbuilt and, for one metric, in tension with another confirmed decision; `[MIGRATION GAP]` marks
> the delta between the two; `[OPEN DECISION]` marks genuine human-authority items. Current-state
> claims cite `path:line @ef25dae6`. Target-state claims cite `CONFIRMED_REQUIREMENTS_REGISTER.md`
> (CONFIRMED §x) and `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x). This document records behavior and
> confirmed contract; it does not create product policy and does not resolve any open decision.
> Nothing here is frozen: G2 freeze is reserved human authority.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-ANALYTICS-001 / 0.1.1` |
| Status | `REVIEW` |
| Owner | `unassigned`. `MODULE_REGISTRY.yaml` records `backend-analytics` owner as `unassigned` (`.claude/knowledge/MODULE_REGISTRY.yaml:161-171`); no CODEOWNERS entry exists. Owner assignment is reserved human authority (`SYNC-001`, `TERMINOLOGY.md:51`) and is blocked pending it — NOT invented here (OQ-ANALYTICS-06). |
| Authors / reviewers | Author: Module Author agent. Reviewers: Architecture, Dependency, Consistency, and Performance reviews completed — all returned `PASS_WITH_ACTIONS`; dispositions applied at v0.1.1 (see Review and Change Log). Security review completed — returned **`FAIL`** (1 Critical, 1 Medium); the Critical finding cannot be resolved by this document (it is a live code defect) and is recorded as a blocking, unassigned residual risk pending a code fix or an authorized Risk Assessment (see OQ-ANALYTICS-01 and "Trust boundaries/authorization" below). This status does NOT clear the Security gate — it only ensures the finding is accurately represented. |
| Repository revision | `ef25dae6a5e89cabe1f5e82453386705decbc3cf` |
| Approved by / at | Not approved — G2 freeze reserved to human. Do NOT mark FROZEN. |
| Supersedes | None. First specification for `backend-analytics` (registry `specification: UNKNOWN` prior, `MODULE_REGISTRY.yaml:170`). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel platform's read-only, cross-module analytics
aggregation capability. This is ONE bounded capability implemented by a single backend module. It
owns NO Prisma model and NO state domain of its own — it is a pure aggregator that reads six
state domains owned by other modules and projects them into three read endpoints.

- `[CURRENT STATE]` (implemented @ef25dae6): three read-only endpoints — a worker **leaderboard**
  (global and per-hotel), **dashboard stats** (platform-wide operational counts), and a
  **hotel summary** (per-hotel operational snapshot including a top-5 leaderboard slice) — built
  directly on top of `WorkRequest`, `WorkerAssignment`, `Attendance`, `QualityVerification`,
  `Rating`, and `WorkerOverallRating` rows owned by other modules. The leaderboard is deliberately
  the same query/ordering as `/quality/leaderboard` so the two surfaces never disagree
  (`analytics/service.ts:20-25`).
- `[TARGET STATE]` (confirmed, largely unbuilt — CONFIRMED §21/§34; PIVOT §3 row 8, §4.11, §10,
  §12, §14 Appendix): the marketplace-era "full" analytics module is confirmed **reduced to a
  basic scope, not removed** — four specific metrics: active workers/day, rooms completed per
  worker, rating/warning counts, and sick/vacation counts per hotel, "derived from existing data,
  no new pipeline" (PIVOT §14 Appendix, line 490) — plus hotel-scoped filtering of
  analytics/workforce (CONFIRMED §21).

**In scope:**
- `backend/src/modules/analytics/{service.ts,controller.ts,routes.ts,types.ts}` — `getLeaderboard`,
  `getDashboardStats`, `getHotelSummary`.
- The read contract against `WorkRequest`, `WorkerAssignment`, `Attendance`,
  `QualityVerification`, `Rating`, and `WorkerOverallRating` (`schema.prisma:236,314,359,395,419,445`)
  as consumed (never owned) state.
- `[TARGET]` the four confirmed "basic analytics" metrics and hotel-scoped filtering — specified
  only to the extent the confirmed authorities settle them; all currently UNBUILT.

**Out of scope:**
- Ownership of any of the six domains this module reads — each is owned and written by its own
  module (`backend-work-requests`/`backend-job-dispatch`, `backend-assignments`, `backend-attendance`,
  `backend-quality` for `QualityVerification`/`Rating`/`WorkerOverallRating`). Referenced only as
  consumed state.
- Notification delivery — analytics emits none (no `sendNotification` call observed in
  `analytics/service.ts`).
- Mobile/frontend rendering logic and the mobile client's own `DashboardStats` type — referenced
  only as a downstream consumer and recorded as a consumer-side contract-mismatch risk
  (OQ-ANALYTICS-02), not remediated here.
- `ReceptionData`, `CalendarEntry`, and any warning-tier entity — target-state models/concepts
  owned by other (also largely unbuilt) modules; analytics is a candidate future reader, not a
  builder, of these.

**Non-goals:** Requirements discovery, product-policy invention (e.g. deciding what "rooms
completed per worker" means), code planning, independent review, or resolving any open decision
below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-ANALYTICS-001..010) — reverse-specified at `ef25dae6`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-ANALYTICS-001` module owns no Prisma model / state domain; mounted at `/api/v1/analytics` | `backend/src/modules/analytics/{service.ts,types.ts}` (no model); `backend/src/routes/v1/index.ts:33` @ef25dae6 | Code | Observed (High) |
| `REQ-ANALYTICS-002` all analytics routes require `authMiddleware`; `AnalyticsService extends BaseService` | `analytics/routes.ts:6-7`; `analytics/service.ts:19` @ef25dae6 | Code | Observed (High) |
| `REQ-ANALYTICS-003` `GET /leaderboard` and `GET /leaderboard/by-hotel/:hotel_id` have NO `requireRole` and NO `checkHotelAccess` — any authenticated actor of any role may call either, for any `hotel_id` | `analytics/routes.ts:9-14` | Code | Observed (High); UNTESTED |
| `REQ-ANALYTICS-004` `GET /stats` requires `requireRole(['admin','manager'])` | `analytics/routes.ts:15-19` | Code | Observed (High); TESTED (`analytics.test.ts:36,48,54`) |
| `REQ-ANALYTICS-005` `GET /hotel-summary/:hotel_id` requires `requireRole(['admin','manager'])` | `analytics/routes.ts:20-24` | Code | Observed (High); TESTED (`analytics.test.ts:42`) |
| `REQ-ANALYTICS-006` `getLeaderboard(hotelId?)` reads `WorkerOverallRating`, `orderBy average_score desc`, `take 50`, optional hotel filter via `worker.hotel_workers.some({hotel_id, status:ACTIVE})` | `analytics/service.ts:26-57` | Code | Observed (High); ordering/filter UNTESTED |
| `REQ-ANALYTICS-007` leaderboard is the deliberate single source of truth shared with `/quality/leaderboard` (same rows, same ordering) | `analytics/service.ts:20-25` (comment) | Code (documented intent) | Observed (High) |
| `REQ-ANALYTICS-008` `getDashboardStats(hotelId?)` issues 11 parallel Prisma calls across `WorkRequest`/`WorkerAssignment`/`Attendance`/`QualityVerification`/`Rating`, optionally scoped by `hotel_id` | `analytics/service.ts:59-172` | Code | Observed (High); math/mapping UNTESTED |
| `REQ-ANALYTICS-009` `getHotelSummary(hotelId)` returns a per-hotel snapshot including `getLeaderboard(hotelId).slice(0,5)` as `top_workers` | `analytics/service.ts:174-256` | Code | Observed (High); UNTESTED |
| `REQ-ANALYTICS-010` responses use the shared envelope `{status,data,meta}`; NO pagination on any analytics endpoint; NO audit-log writes (module is read-only, never calls `BaseService.logAudit`) | `analytics/controller.ts:9-13,23-27,36-40`; absence of `logAudit` call in `analytics/service.ts` | Code | Observed (High) |

`[TARGET STATE]` requirements (REQ-ANALYTICS-011..016) — confirmed authorities, largely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-ANALYTICS-011` analytics module is reduced to a **basic scope, not removed entirely** | CONFIRMED §34 (line 395); PIVOT §3 row 8 (line 79), §10 Phase 1 (line 412) | Confirmed authority | Target; confirmed decision, not yet scoped in code |
| `REQ-ANALYTICS-012` basic analytics = **active workers/day** | CONFIRMED §21 (line 293); PIVOT §14 Appendix (line 490) | Confirmed authority | Target; gap (OQ-ANALYTICS-09) |
| `REQ-ANALYTICS-013` basic analytics = **rooms completed per worker** | CONFIRMED §21 (line 293); PIVOT §14 Appendix (line 490); PIVOT §4.9 (line 131, manual manager entry) | Confirmed authority | Target; BLOCKED / contradicts CONFIRMED §33 (OQ-ANALYTICS-03) |
| `REQ-ANALYTICS-014` basic analytics = **rating/warning counts** | CONFIRMED §21 (line 293); PIVOT §14 Appendix (line 490) | Confirmed authority | Target; gap (OQ-ANALYTICS-08) |
| `REQ-ANALYTICS-015` basic analytics = **sick/vacation counts per hotel** | CONFIRMED §21 (line 293); PIVOT §14 Appendix (line 490) | Confirmed authority | Target; gap, blocked on Calendar module (OQ-ANALYTICS-07) |
| `REQ-ANALYTICS-016` filter analytics/workforce by hotel, "designed to scale as hotels are added" | CONFIRMED §21 (lines 290-292); PIVOT §4.11 (lines 135-137) | Confirmed authority | Target; PARTIALLY satisfied today (`hotelId` optional param on all three current endpoints) |

Hedge disclosure (consistency-review finding, recorded not resolved): CONFIRMED §21, line 293
itself hedges the four basic-analytics metrics as "proposed" inside a nominally confirmed (🔵)
bullet — verbatim: "only BASIC analytics to be built (scope to be defined by Zirove — **proposed**:
active workers/day, rooms completed per worker, rating/warning counts, sick/vacation counts per
hotel)". The `Authority: Confirmed authority` label on REQ-ANALYTICS-012..015 above should not be
read as implying §21 line 293 alone settles the metric list unambiguously. This spec treats PIVOT
§14 Appendix (line 490), which repeats the identical four-item list WITHOUT the "proposed" hedge
and under an "Assumptions (inferred, labelled)" heading, as the authoritative concrete resolution
of that hedge — i.e. two independently-worded target-state sources converge on the same four
metrics, which is why they are labeled "Confirmed authority" here rather than merely "proposed."
Which document formally resolved the hedge (and when) is not itself evidenced; only the convergence
is.

Dangling cross-reference (recorded as a documentation-consistency observation, not resolved here):
PIVOT §4.11 (line 137) states "Basic analytics only (scope defined in Section 7)", but PIVOT
Section 7 "Component Design" (lines 261-298) contains only §7.1-7.7 (Onboarding, Calendar, Job
Requests, Attendance, Quality, Consent Gate, HR) — **no analytics subsection exists**. The only
concrete scope definition in the target-state documents is PIVOT §14 Appendix, line 490. This spec
treats §14 Appendix as authoritative and records the §4.11→"Section 7" reference as a dangling
cross-reference (OQ-ANALYTICS-05), not as an unmet requirement.

## Actors and Terminology

Per `.claude/knowledge/TERMINOLOGY.md`, no analytics-specific canonical terms exist yet. "Worker" /
"Checker" / "Manager" / "Admin" are used below as `Definition unresolved` per that file — this spec
does not promote new canonical terminology.

| Term/actor | Canonical definition | Source |
|---|---|---|
| Leaderboard entry | A per-worker projection of `WorkerOverallRating` — `worker_id`, `name`, `total_tasks` (=`total_assignments`), `completed_tasks` (=`round(completion_rate*total_assignments)`), `average_rating` (=`average_score`, rounded to 2dp), `position` (1-based rank by `average_score desc`). `[CURRENT]` local type, not yet promoted canonical. | `analytics/types.ts:1-8`; `analytics/service.ts:46-56` |
| Dashboard stats | A platform-wide (or hotel-scoped, via optional `hotel_id`) operational snapshot: `work_requests{total,open,partially_filled,filled,cancelled,expired}`, `assignments{total,completed,in_progress,no_show,cancelled}`, `attendance{total,present,late,absent,on_time_rate}`, `quality{total_verifications,average_score,pass_rate}`, `ratings{total,average_score}`. | `analytics/types.ts:10-42`; `analytics/service.ts:59-172` |
| Hotel summary | A single-hotel operational snapshot: open-request counts/sums, in-progress assignment count, today's attendance breakdown, quality aggregate + pass rate, and the top-5 leaderboard slice for that hotel. | `analytics/types.ts:44-63`; `analytics/service.ts:174-256` |
| Basic analytics `[TARGET]` | The confirmed reduced scope of this module: active workers/day, rooms completed per worker, rating/warning counts, sick/vacation counts per hotel — "derived from existing data, no new pipeline." No code representation today. | CONFIRMED §21; PIVOT §14 Appendix (line 490) |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @ef25dae6 unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-ANALYTICS-001 | The module owns no Prisma model; it is mounted at `/api/v1/analytics`. | Must | No model file/domain under `analytics/`; mount `routes/v1/index.ts:33`. | RULE-ANALYTICS-001 |
| REQ-ANALYTICS-002 | All analytics routes require authentication. | Must | `router.use(authMiddleware)` (`routes.ts:7`); missing/invalid token → 401. | RULE-ANALYTICS-001 |
| REQ-ANALYTICS-003 | `GET /leaderboard` and `GET /leaderboard/by-hotel/:hotel_id` have no role or hotel-membership gate. | Must (as observed) | Any authenticated role (WORKER/CHECKER/MANAGER/ADMIN) receives 200 for any `hotel_id` path segment. | RULE-ANALYTICS-002 |
| REQ-ANALYTICS-004 | `GET /stats` is restricted to admin/manager. | Must | Actor with role outside `{admin,manager}` → 403 `ForbiddenError`, before the service runs. | RULE-ANALYTICS-002 |
| REQ-ANALYTICS-005 | `GET /hotel-summary/:hotel_id` is restricted to admin/manager. | Must | Actor with role outside `{admin,manager}` → 403 `ForbiddenError`, before the service runs. | RULE-ANALYTICS-002 |
| REQ-ANALYTICS-006 | The leaderboard returns the top 50 workers by overall average, optionally scoped to one hotel's active workers. | Must | `workerOverallRating.findMany` `orderBy average_score desc`, `take 50`; when `hotelId` supplied, filter to workers with an ACTIVE `HotelWorker` row at that hotel. | RULE-ANALYTICS-003 |
| REQ-ANALYTICS-007 | The leaderboard is the single source of truth shared with `/quality/leaderboard`. | Should (documented intent) | Both read the same `WorkerOverallRating` rows with the same `average_score desc` ordering, so the two surfaces cannot disagree on rank — enforced only by shared query shape, not by a shared code path (`quality/service.ts:214-223` is a separate implementation reading the same table). | RULE-ANALYTICS-003 |
| REQ-ANALYTICS-008 | Dashboard stats aggregate counts/groupBy across five state domains, optionally scoped by hotel. | Must | 11 parallel Prisma calls (`Promise.all`); `null` `_avg.score` maps to `null` in the response, not `0`, for `quality.average_score` and `ratings.average_score`. | RULE-ANALYTICS-004 |
| REQ-ANALYTICS-009 | Hotel summary returns a per-hotel snapshot including a top-5 leaderboard slice. | Must | `open_requests` sums `workers_needed`/`workers_confirmed` for OPEN+PARTIALLY_FILLED requests; `today_attendance` is scoped to `created_at` within the current calendar day (`[today, tomorrow)`); `top_workers` = `getLeaderboard(hotelId).slice(0,5)` (a second, nested query for the same hotel already computed by `getLeaderboard`). | RULE-ANALYTICS-004, RULE-ANALYTICS-005 |
| REQ-ANALYTICS-010 | Responses use the shared envelope; no pagination; no audit writes. | Must | `{status:'success', data, meta:{timestamp,request_id}}` on all three endpoints, HTTP 200; no `AuditLog` row is ever written by this module. | RULE-ANALYTICS-001 |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-ANALYTICS-011 | Analytics is reduced to a basic, intentional scope — not removed. | Must | The module continues to exist and serve the four confirmed metrics below; "full marketplace analytics" is not rebuilt. | RULE-ANALYTICS-006 |
| REQ-ANALYTICS-012 | Active workers/day is derivable per hotel. | Must | A count of distinct active workers for a given day is available; exact derivation (assignment-based vs attendance-based vs calendar-based) is a design decision (OQ-ANALYTICS-09). | RULE-ANALYTICS-006 |
| REQ-ANALYTICS-013 | Rooms completed per worker is derivable. | Must | BLOCKED — undefined against the confirmed no-room-level-task-layer decision (OQ-ANALYTICS-03); no acceptance criteria can be written until that conflict is resolved by human/product authority. | RULE-ANALYTICS-006 |
| REQ-ANALYTICS-014 | Rating/warning counts are derivable. | Must | Rating counts are already derivable from `WorkerOverallRating`/`Rating` (current state); warning counts require a warning-tier entity that does not yet exist (OQ-ANALYTICS-08). | RULE-ANALYTICS-006 |
| REQ-ANALYTICS-015 | Sick/vacation counts per hotel are derivable. | Must | Requires the target `CalendarEntry` model (PIVOT §9.3, unbuilt); zero current-state capability (OQ-ANALYTICS-07). | RULE-ANALYTICS-006 |
| REQ-ANALYTICS-016 | Analytics/workforce can be filtered by hotel. | Must | PARTIALLY satisfied: all three current endpoints already accept an optional `hotel_id`; whether this fully satisfies "designed to scale as hotels are added" (CONFIRMED §21) is not otherwise specified. | RULE-ANALYTICS-006 |

## Business Rules

`[CURRENT STATE]` rules (RULE-ANALYTICS-001..005) — reverse-specified @ef25dae6:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-ANALYTICS-001 | Any analytics request | All routes require `authMiddleware`. Responses use the shared envelope; NO pagination. No audit log is written for any read. | Missing/invalid auth → 401. | `unassigned (OQ-ANALYTICS-06/SYNC-001)`; `analytics/routes.ts:6-24`; `analytics/controller.ts` |
| RULE-ANALYTICS-002 | Route-level authorization | `/leaderboard` and `/leaderboard/by-hotel/:hotel_id` add NO further gate beyond authentication. `/stats` and `/hotel-summary/:hotel_id` additionally require `requireRole(['admin','manager'])`. NEITHER leaderboard route applies `checkHotelAccess()`. | Any authenticated role reads any hotel's leaderboard; `/stats` and `/hotel-summary` reject WORKER/CHECKER with 403. This asymmetry is a genuine open question (OQ-ANALYTICS-01), not resolved here. | `unassigned (OQ-ANALYTICS-06/SYNC-001)`; `analytics/routes.ts:9-24` |
| RULE-ANALYTICS-003 | `getLeaderboard(hotelId?)` | Ordered strictly by `WorkerOverallRating.average_score desc`, unpaginated `take 50`; hotel scope (when supplied) filters to workers with an ACTIVE `HotelWorker` row at that hotel via a relation filter, never a direct `hotel_id` column on the aggregate itself. Query shape mirrors `quality/service.ts:214-223` by design (REQ-ANALYTICS-007) but is a separately maintained implementation. | No tie-break rule beyond Prisma's stable-ish ordering; not specified further. | `unassigned (OQ-ANALYTICS-06/SYNC-001)`; `analytics/service.ts:26-57` |
| RULE-ANALYTICS-004 | `getDashboardStats`/`getHotelSummary` aggregate computation | All counts/groupBy/aggregate calls for one response run inside a single `Promise.all` (not a DB transaction — no atomicity guarantee across the parallel reads); `_avg.score` of `null` (no rows) is surfaced as `null`, not `0`, in `quality.average_score`/`ratings.average_score`. Rate fields (`on_time_rate`, `pass_rate`) are `0` (not `null`) when the denominator is `0`. | Because reads are NOT transactional, `getDashboardStats`/`getHotelSummary` can observe a torn snapshot across concurrent writes from other modules — recorded as an observed characteristic, not remediated here. | `unassigned (OQ-ANALYTICS-06/SYNC-001)`; `analytics/service.ts:59-172,174-256` |
| RULE-ANALYTICS-005 | `getHotelSummary` | Internally calls `this.getLeaderboard(hotelId)` (a second, independent query already covered by RULE-ANALYTICS-003) and slices the first 5 rows as `top_workers`; `today_attendance` is scoped by `created_at` in `[startOfDay, startOfDay+1day)`, not by the attendance record's own shift/work date. | If `Attendance.created_at` diverges from the shift date it reports for (e.g. backfilled rows), `today_attendance` reflects row-creation time, not shift date — observed characteristic, not remediated here. | `unassigned (OQ-ANALYTICS-06/SYNC-001)`; `analytics/service.ts:174-256` |

`[TARGET STATE]` rules (RULE-ANALYTICS-006) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-ANALYTICS-006 | Presenting analytics/workforce data | Scope is reduced to the four confirmed basic-analytics metrics (REQ-ANALYTICS-012..015) plus hotel filtering (REQ-ANALYTICS-016); "full marketplace analytics" reporting is out of scope. | "Rooms completed per worker" cannot be implemented as stated without either contradicting CONFIRMED §33's no-room-level-task-layer decision or redefining the metric — human decision required (OQ-ANALYTICS-03). | CONFIRMED §21, §34; PIVOT §3 row 8, §4.11, §10, §14 Appendix |

## Ownership and Boundaries

**Module owner:** `unassigned (OQ-ANALYTICS-06 / SYNC-001, human authority required)`. MODULE_REGISTRY
records `owner: unassigned` (`MODULE_REGISTRY.yaml:161-171`); no CODEOWNERS entry exists. Owner
assignment is reserved human authority and is NOT invented here.

**Owned state:** NONE. `backend-analytics` owns no Prisma model and no state domain. It is a pure
read-only cross-module aggregator (`MODULE_REGISTRY.yaml:167` `dependencies: []` — that field
tracks direct module→module service calls only, not the Prisma `reads-state` edges below, which
live in `DEPENDENCY_GRAPH.yaml`; the empty `dependencies: []` does NOT contradict the reads-state
edges recorded here).

**Consumed state (read only, per `DEPENDENCY_GRAPH.yaml` `edge-analytics-reads-*`):**
- `state-work-request` (owner `backend-work-requests`/`backend-job-dispatch`) —
  `analytics/service.ts:75,76,189`; edge `edge-analytics-reads-work-request` (`DEPENDENCY_GRAPH.yaml:217-223`).
- `state-worker-assignment` (owner `backend-assignments`) — `analytics/service.ts:81,82,197`; edge
  `edge-analytics-reads-worker-assignment` (`:224-230`).
- `state-attendance` (owner `backend-attendance`) — `analytics/service.ts:87,88,200`; edge
  `edge-analytics-reads-attendance` (`:231-237`).
- `state-quality-verification` (owner `backend-quality`) — `analytics/service.ts:93,97,100,208,212,215`;
  edge `edge-analytics-reads-quality-verification` (`:238-244`).
- `state-rating` (owner `backend-quality`) — `analytics/service.ts:101,105`; edge
  `edge-analytics-reads-rating` (`:245-251`).
- `state-worker-overall-rating` (owner `backend-quality`) — `analytics/service.ts:37`; edge
  `edge-analytics-reads-worker-overall-rating` (`:252-258`).
- `state-hotel-worker` (owner `backend-hotel-workers`, via `HotelWorker` relation filter,
  `schema.prisma:206`) — read only via the `worker.hotel_workers.some(...)` relation filter in
  `getLeaderboard` (`analytics/service.ts:29-33`). No dedicated `edge-analytics-reads-hotel-worker`
  entry exists in `DEPENDENCY_GRAPH.yaml` today; dependency review (FIND-DEP-001) confirmed this IS
  a genuine missing edge — see the required "Proposed Knowledge Deltas" addition below.

All six read edges are recorded `compatibility: not-applicable`, `kind: reads-state`,
`status: observed` (`DEPENDENCY_GRAPH.yaml:217-258`).

**Permitted writes:** NONE. `backend-analytics` writes nothing — not even an `AuditLog` row
(REQ-ANALYTICS-010). It has zero code-import dependencies on other modules; all coupling is through
direct Prisma reads of tables owned elsewhere.

**Consumers of this module's state (downstream — NOT owned here):**
- `mobile-worker` consumes `/analytics` (`edge-mobile-worker-analytics`, `DEPENDENCY_GRAPH.yaml:275`):
  `mobile/worker-app/src/app/(app)/index.tsx:36` calls `api.analytics.stats()`
  (`GET /analytics/stats`) unconditionally for every logged-in user, and
  `mobile/worker-app/src/app/ratings.tsx:19` calls `api.analytics.leaderboard()`
  (`mobile/worker-app/src/lib/api.ts:223-226`). See OQ-ANALYTICS-02 for the observed
  contract mismatch on the `/stats` call.
- No `frontend-web` or `mobile-checker` consumer of `/analytics` is observed (verified absent by
  repository search — neither client calls this module's routes).

**Boundary/non-responsibilities:** This module does NOT own or write any of the six domains it
reads; does not own notification delivery (it sends none); does not own the mobile/frontend
rendering of its data (OQ-ANALYTICS-02 is a consumer-side finding, not a defect in this module's
contract); does not own `ReceptionData`, `CalendarEntry`, or any future warning-tier entity — it is,
at most, a candidate future reader of those target-state models (OQ-ANALYTICS-07/08), never their
owner.

## Interfaces and Contracts

Base router mounts at `routes/v1/index.ts:33` (`/api/v1/analytics`). All routes require
`authMiddleware` (`routes.ts:7`). Envelope: `{ status:"success", data, meta:{timestamp,request_id} }`
— NO pagination on any analytics endpoint. Errors bubble to the shared centralized error handler via
`next(error)` in every controller method (`controller.ts:14,28,42`); no analytics-specific error type
is thrown by the service (unlike quality's `NotFoundError`/`ForbiddenError`/`ConflictError` — a
malformed/missing `hotel_id` on the leaderboard or stats routes simply yields an empty/zeroed
result, not a 4xx, because `hotelId` is optional in the service signature). Compatibility
vocabulary: these contracts are **unversioned** in code (no contract version / registry entry), so
their compatibility posture is recorded as **baseline/UNKNOWN**.

`[CURRENT STATE]` endpoints (implemented @ef25dae6):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `GET /analytics/leaderboard` (unversioned) | inbound | none (no pagination params); optional `?hotel_id=` query supported by the controller but unused by this route in practice | 200 `LeaderboardEntry[]` (top 50, `average_score desc`) | none typed (falls to centralized handler) | `authMiddleware` only — NO role gate, NO `checkHotelAccess` | baseline/UNKNOWN |
| `GET /analytics/leaderboard/by-hotel/:hotel_id` (unversioned) | inbound | path `hotel_id` | 200 `LeaderboardEntry[]` (top 50 within hotel, `average_score desc`) | none typed | `authMiddleware` only — NO role gate, NO `checkHotelAccess` (REQ-ANALYTICS-003) | baseline/UNKNOWN |
| `GET /analytics/stats` (unversioned) | inbound | optional `?hotel_id=` query (path variant not routed) | 200 `DashboardStats` | none typed | `authMiddleware` + `requireRole(['admin','manager'])` | baseline/UNKNOWN |
| `GET /analytics/hotel-summary/:hotel_id` (unversioned) | inbound | path `hotel_id` (required — not optional at the service signature) | 200 `HotelSummary` | none typed (invalid/absent hotel yields a zeroed summary, not 404 — `getHotelSummary` performs no existence check on the hotel itself) | `authMiddleware` + `requireRole(['admin','manager'])` | baseline/UNKNOWN |

`[TARGET STATE]` interfaces (unbuilt): endpoints or response fields surfacing active workers/day,
rooms completed per worker (BLOCKED, OQ-ANALYTICS-03), rating/warning counts, and sick/vacation
counts per hotel. Not specified beyond the confirmed metric list (PIVOT §14 Appendix, line 490);
will be authored at milestone M5 (Platform, PIVOT §12, line 456), which depends on M2-M4.

## Events

No event bus exists (`MODULE_REGISTRY.yaml` — no `published_events`/`consumed_events` entries other
than the repository-wide `none-observed` convention, `TERMINOLOGY.md:52`). `backend-analytics`
publishes and consumes no events; it neither calls `notificationService.sendNotification` nor
listens for any signal — it is invoked synchronously, per-request, by its callers.

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| — | — | — | — | — | None observed. |

## Dependencies

`[CURRENT]` existing DEPENDENCY_GRAPH edges referenced (see also the Proposed Knowledge Deltas
section for one missing edge):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-analytics-reads-work-request` (`DEPENDENCY_GRAPH.yaml:217-223`) | Dashboard/hotel-summary counts by status | Prisma read `state-work-request` | not-applicable | Prisma error bubbles to centralized handler (untyped) |
| `edge-analytics-reads-worker-assignment` (`:224-230`) | Dashboard/hotel-summary counts by status | Prisma read `state-worker-assignment` | not-applicable | same |
| `edge-analytics-reads-attendance` (`:231-237`) | Dashboard/hotel-summary attendance breakdown | Prisma read `state-attendance` | not-applicable | same |
| `edge-analytics-reads-quality-verification` (`:238-244`) | Dashboard/hotel-summary quality average + pass rate | Prisma read `state-quality-verification` | not-applicable | same |
| `edge-analytics-reads-rating` (`:245-251`) | Dashboard-stats rating average/total | Prisma read `state-rating` | not-applicable | same |
| `edge-analytics-reads-worker-overall-rating` (`:252-258`) | Leaderboard (global and per-hotel, and via hotel-summary's `top_workers`) | Prisma read `state-worker-overall-rating` | not-applicable | same |
| `edge-mobile-worker-analytics` (`:275`) | `mobile-worker` API client of `/analytics` | HTTP (unversioned) | unknown | Client-side; see OQ-ANALYTICS-02 for an observed mismatch |

Shared contracts consumed: `prisma-schema` (data, read-only here), `base-service` (Prisma client
access only — `logAudit` is inherited but never called), `auth-middleware`,
`permissions-middleware` (`requireRole` only — `checkHotelAccess` is imported nowhere in this
module).

`[TARGET]` new dependencies (unbuilt): the `CalendarEntry` model (PIVOT §9.3) for sick/vacation
counts (OQ-ANALYTICS-07); a warning-tier entity, currently only Quality-module notification logic
and not a stored/countable domain (OQ-ANALYTICS-08); and, if "rooms completed per worker" is ever
resolved, a read of the target `ReceptionData` model (PIVOT §9.3, §4.9) — none of these exist yet.
Architecture anchors modular-monolith (ADR-003, Proposed) and Prisma-over-PostgreSQL (ADR-004,
Proposed) are retained; no ADR specifically governs analytics' own module boundary.

## State and Lifecycle

`backend-analytics` has no owned state and therefore no state machine, no transitions, no
invariants of its own, and no retention policy to define — every value it returns is a live,
point-in-time Prisma read of another module's rows, recomputed on every request. There is no
caching layer observed (`analytics/service.ts` issues fresh queries per call; `getHotelSummary`
even re-issues `getLeaderboard`'s query rather than reusing a cached result within the same
request-composition, RULE-ANALYTICS-005).

**Concurrency:** `getDashboardStats` and `getHotelSummary` run their multiple Prisma calls inside a
`Promise.all`, NOT inside a `$transaction` — there is no read-isolation guarantee across the
parallel queries (RULE-ANALYTICS-004). This is a genuine observed characteristic of a
cross-domain aggregator; whether stronger consistency is required is unspecified by any authority
and is not decided here.

**Retention:** Not applicable — no data is written or retained by this module. Retention of the
underlying rows is governed by each owning module.

`[TARGET]` flows: none of the four basic-analytics metrics have a defined read/derivation flow yet
beyond the one-line description in PIVOT §14 Appendix (line 490); "derived from existing data, no
new pipeline" implies these remain Prisma reads over existing (or, for sick/vacation, target-state)
tables rather than a new ETL/aggregation pipeline — but this is an inference from wording, not a
confirmed design (recorded as an assumption, ASM-ANALYTICS-01).

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` no analytics-specific error type is thrown; any Prisma
failure propagates untyped to the centralized error handler via `next(error)` in every controller
method. A missing/unknown `hotel_id` does not 404 — it silently yields an empty leaderboard array
or a summary with zeroed counts (`getHotelSummary` performs no existence check on the hotel before
querying). This is an observed characteristic (silent zero-result on bad input), not remediated
here.

**Trust boundaries/authorization:** `[CURRENT]` route RBAC is INCONSISTENT across the module's own
three endpoint groups:
- `[CRITICAL — BLOCKING]` OQ-ANALYTICS-01 — `GET /analytics/leaderboard` and
  `GET /analytics/leaderboard/by-hotel/:hotel_id` require only `authMiddleware`: no `requireRole`
  and no `checkHotelAccess`/tenant-boundary check (`analytics/routes.ts:9-14`), while `/stats`
  (`:15-19`) and `/hotel-summary/:hotel_id` (`:20-24`) both require `requireRole(['admin','manager'])`.
  Any authenticated user — including a self-signup-obtainable WORKER, who holds no quality/analytics
  permission elsewhere in the system — can view worker names and performance ratings for ANY hotel
  by passing its `hotel_id`, with no verification of hotel membership. This is the SAME data
  (`WorkerOverallRating`) that the sibling `GET /quality/leaderboard/by-hotel/:hotel_id` gates with
  BOTH `requirePermission('quality:read')` AND `checkHotelAccess()` (`quality/routes.ts:18`) —
  i.e. one module protects this exact data and the other does not. Independent security review
  classified this **Critical (Confidence High)**, not a routine open question: it is a live
  cross-tenant personal-data disclosure in already-deployed code. Given the Germany-only,
  GDPR-governed operating context (CONFIRMED §33), it is also a plausible confidentiality /
  purpose-limitation concern requiring DPO/legal determination, beyond a pure access-control read.
  Residual risk is LIVE and UNASSIGNED (owner `unassigned`, OQ-ANALYTICS-06/SYNC-001 blocks even
  accountable acceptance of the risk, let alone remediation). **This finding BLOCKS G2 freeze** per
  Constitution §12: it cannot be resolved by this specification (fixing the route guard is a code
  change, out of scope here) and must be either fixed in code or formally accepted via an
  authorized, time-bounded Risk Assessment before this module can be frozen. It MUST NOT be treated
  as a routine "OPEN" item awaiting convenience.
- The `/stats` and `/hotel-summary` admin/manager gate has a downstream consequence recorded in
  OQ-ANALYTICS-02: it makes `/stats` categorically unreachable for the WORKER role that the mobile
  worker app calls it for.

**Data classification/retention:** Leaderboard responses disclose worker first/last name
(`analytics/service.ts:40,50`) plus a computed rating/task-count to any authenticated actor,
cross-hotel, per OQ-ANALYTICS-01 — worker-performance data, though notably NOT the worker's email
(unlike `/quality/leaderboard`, which does return email — `quality/service.ts:216-219` — a
narrower PII footprint here, recorded as an observation, not a mitigation). `/stats` and
`/hotel-summary` expose only aggregate counts, not individual worker identities (aside from the
embedded `top_workers` leaderboard slice in `/hotel-summary`, which carries the same disclosure as
the leaderboard endpoints but is at least gated to admin/manager there).

**Performance budgets/workload:** No explicit budgets or SLOs are defined in code or authority
docs (`[OPEN DECISION]` OQ-ANALYTICS-10; blocked on ownership `SYNC-001`). Observations:
- Indexing (broadened per performance review; the underlying columns of every current-state
  aggregate/groupBy/count call site are covered, not just the leaderboard's): the leaderboard's
  `average_score` is indexed (`@@index([average_score])`, `schema.prisma:457`); `WorkRequest.status`
  is indexed (`schema.prisma:270`); `WorkerAssignment.status` is indexed (`schema.prisma:349`);
  `Attendance.status` is indexed (`schema.prisma:385`); `QualityVerification.hotel_id` and `.status`
  are indexed (`schema.prisma:413,415`); `Rating.hotel_id` is indexed (`schema.prisma:436`). No
  missing-index defect is identified against the current query set.
- The leaderboard is an UNPAGINATED `take 50`; `getDashboardStats` issues 11 parallel Prisma calls
  per request; `getHotelSummary` issues 7 parallel calls PLUS a nested, independent `getLeaderboard`
  call (effectively 8 top-level operations) — none of these are memoized or shared across the
  fan-out. No caching layer exists.
- **Unbounded/unfiltered aggregation (performance review finding, Medium):** when `hotelId` is
  omitted, ALL 11 `getDashboardStats` Prisma calls run with an empty `where` clause
  (`analytics/service.ts:60,74-106`) — i.e. unfiltered, unwindowed counts/groupBy/aggregate over the
  platform's ENTIRE historical `WorkRequest`/`WorkerAssignment`/`Attendance`/`QualityVerification`/
  `Rating` volume, every call, with no caching and no rate limit. This is distinct from the
  missing-index question above (there is no missing index; the concern is unbounded row volume as
  history grows) and is tracked as part of OQ-ANALYTICS-10 — no budget currently bounds it.
- **10x over-fetch in `getHotelSummary` (performance review finding, Low):** `getHotelSummary`'s
  nested `getLeaderboard(hotelId)` call (RULE-ANALYTICS-005) fetches and transforms the full top-50
  ranked `WorkerOverallRating[]` result set (`analytics/service.ts:26-57`) in order to serve only
  the top 5 as `top_workers` (`.slice(0,5)`, `analytics/service.ts:254`) — a 10x over-fetch ratio on
  every `/hotel-summary` call, on top of (not the same issue as) the "no caching / re-issued query"
  characteristic already noted for RULE-ANALYTICS-005.
- **No index on the `getHotelSummary` today-attendance filter column (performance review finding,
  Low):** `getHotelSummary`'s today-attendance groupBy filters `Attendance` by `created_at` within
  `[today, tomorrow)` (`analytics/service.ts:200-207`, RULE-ANALYTICS-005), but `Attendance` has no
  index on `created_at` and no `[hotel_id, created_at]` composite index — `schema.prisma:383-388`
  indexes `worker_id`, `hotel_id`, `status`, `check_in_at`, `[worker_id, check_in_at]`, and
  `[hotel_id, is_verified]` (the closest existing composite pattern), but not `created_at` alone or
  in combination with `hotel_id`.

Single-tenant-per-client deployment (PIVOT §5.1) suggests modest scale; no figures confirmed for
any of the above.

**Observability/audit:** NO audit-log writes occur (REQ-ANALYTICS-010) — consistent with a
read-only module, but also means there is no record of who viewed which hotel's leaderboard or
stats. Security review flagged this as a **severity multiplier for OQ-ANALYTICS-01 (Critical)**,
not a neutral characteristic: the absence of any audit trail removes the one mitigating factor —
detectability — that might otherwise partially offset the missing access control on
`/analytics/leaderboard`(`/by-hotel/:hotel_id`). There is no way to determine, after the fact,
which actors read which hotel's worker-performance data through the unguarded leaderboard routes.
No metrics/tracing observed beyond the shared `request_id` in the response envelope's `meta`.

## Rollout and Compatibility

`[CURRENT]` behavior is already deployed at `ef25dae6`; the current-state layer is a reverse
specification, not a change. No feature flags observed for this module.

`[TARGET]` migration strategy — a **forward build** aligned to PIVOT §12 milestone **M5
(Platform)** ("basic analytics" — depends on M2-M4; PIVOT §10 Phase 4 line 428). Because the
system is pre-launch, there is no production analytics data to migrate; this is scope reduction
plus additive metric work, not a data migration. `[MIGRATION GAP]` enumeration, one row per
confirmed basic-analytics metric (per the required gap analysis):

| Gap ID | Current state (evidence) | Target requirement (evidence) | Phase |
|---|---|---|---|
| MIG-GAP-ANALYTICS-01 | `getHotelSummary.active_assignments` counts IN_PROGRESS `WorkerAssignment` rows; `today_attendance` counts `Attendance` rows created today (`analytics/service.ts:197-207,239-246`) — both count ROWS, not DISTINCT workers | **Active workers/day** — a distinct-worker-count metric (PIVOT §14 Appendix, line 490; CONFIRMED §21) | M5; partially analogous today, not identical (OQ-ANALYTICS-09) |
| MIG-GAP-ANALYTICS-02 | No room-level concept anywhere in code or schema; `getDashboardStats`/`getHotelSummary` operate at the `WorkRequest`/`WorkerAssignment` (full-day/shift) granularity only | **Rooms completed per worker** (PIVOT §14 Appendix, line 490) — CONTRADICTS CONFIRMED §33 (line 387): "No room-level task layer — 'Task' and 'Work Request' do NOT need separating; full-day employment model." Source for the metric itself is PIVOT §4.9 (line 131, "Manager logs rooms completed per worker"); §9.3 (line 397) only says "Manager-entered checkout / long-stay data" for `ReceptionData` and does NOT itself mention rooms-completed data — this spec INFERS (not cites) that rooms-completed data would land on `ReceptionData` given §4.9's description, though that model's own listed fields do not include it. That model is itself unbuilt target state and no analytics read of it exists | M5; BLOCKING open question (OQ-ANALYTICS-03), not silently resolved |
| MIG-GAP-ANALYTICS-03 | `WorkerOverallRating.average_score`/`total_ratings` give a raw score and count; no warning-tier entity exists anywhere in code | **Rating/warning counts** (PIVOT §14 Appendix, line 490). PIVOT §4.6/§7.5 (quality module) defines warning THRESHOLDS (first <70, second <50 → manager notification) but this is Quality-module notification logic, not a stored/countable "warning" entity analytics can aggregate today | M5; gap, no warning state to read yet (OQ-ANALYTICS-08) |
| MIG-GAP-ANALYTICS-04 | Zero current-state capability — no sick/vacation concept exists in the schema | **Sick/vacation counts per hotel** (PIVOT §14 Appendix, line 490) — depends entirely on the target `CalendarEntry` model (PIVOT §9.3, line 393), which is itself unbuilt and scheduled for M2 (Dispatch), BEFORE M5 (Platform) | M5, blocked on M2 delivery (OQ-ANALYTICS-07) |

Additional migration/dependency risk (not a metric gap, recorded per the required gap analysis):
current-state `getDashboardStats`/`getHotelSummary`/`getLeaderboard` read `WorkRequest` and
`WorkerAssignment`. PIVOT §9.1 (line 377) repurposes `WorkRequest` into a broadcast `JobRequest`
and drops the application linkage; PIVOT §9.1 (line 378) changes `WorkerAssignment` creation to be
direct (from calendar or broadcast accept) rather than via the removed `WorkApplication`. Analytics'
current status-enum-based counts (OPEN/PARTIALLY_FILLED/FILLED/CANCELLED/EXPIRED for `WorkRequest`;
COMPLETED/IN_PROGRESS/NO_SHOW/CANCELLED for `WorkerAssignment`) will need re-validation once those
owning modules pivot, even though the underlying Prisma table names may not change. This spec does
NOT approve any target implementation for those owning modules — it records the dependency as a
migration/consumer risk only (OQ-ANALYTICS-04).

Internal inconsistency in the target-state source document itself (not resolved here): PIVOT §9.1
(line 377) states `WorkRequest` "Repurposed as broadcast `JobRequest`" (implying `JobRequest` IS
`WorkRequest` renamed/modified), while PIVOT §9.3 (line 394) lists `JobRequest` under "Models
added" (implying it is a NEW, separate model). This spec cannot resolve which reading is correct
and flags it as an open question (OQ-ANALYTICS-04), not a decision.

**Backward compatibility:** current `/analytics` endpoints are consumed only by `mobile-worker`
(`edge-mobile-worker-analytics`, `DEPENDENCY_GRAPH.yaml:275`); no `frontend-web` or `mobile-checker`
edge exists (verified absent). Because contracts are unversioned (baseline/UNKNOWN), any future
change to `DashboardStats`/`HotelSummary`/`LeaderboardEntry` shape must be assessed against a future
versioned baseline before it can be classified breaking/non-breaking. **Rollback:** the PIVOT
`FEATURE_*` env convention (PIVOT §10, "Rollback, flags, risk") is the stated mechanism for gating
new modules; analytics is an existing module being scope-reduced, not a new module, so no flag is
observed or proposed here. **Removal criteria:** none — CONFIRMED §34 explicitly rejects removal
("Reduce the analytics module to basic scope (not remove entirely)").

## Validation Plan

`[CURRENT STATE]` criteria (mapped to `backend/src/__tests__/analytics.test.ts` @ef25dae6):

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-ANALYTICS-004 `/stats` RBAC gating (RULE-ANALYTICS-002) | Unit (middleware) | `analytics.test.ts:36,48,54` | Deny worker; allow admin; allow manager |
| REQ-ANALYTICS-005 `/hotel-summary` RBAC gating (RULE-ANALYTICS-002) | Unit (middleware) | `analytics.test.ts:42` | Deny worker |
| REQ-ANALYTICS-003 `/leaderboard`(`/by-hotel`) absence of role/hotel-scope restriction (RULE-ANALYTICS-002) | — | — | **UNTESTED** — no test exercises that any role, including worker, is currently ALLOWED through the leaderboard routes |
| REQ-ANALYTICS-006 `getLeaderboard` ordering/filter/hotel-scope math (RULE-ANALYTICS-003) | — | — | **UNTESTED** — no test exercises the service aggregation logic |
| REQ-ANALYTICS-008 `getDashboardStats` field mapping/math (RULE-ANALYTICS-004) | — | — | **UNTESTED** |
| REQ-ANALYTICS-009 `getHotelSummary` field mapping/math incl. `top_workers` slice (RULE-ANALYTICS-004/005) | — | — | **UNTESTED** |
| REQ-ANALYTICS-010 envelope shape / no-audit-write (RULE-ANALYTICS-001) | — | — | **UNTESTED** as an explicit assertion (implied by controller code only) |

`[TARGET STATE]` criteria (to be authored at M5; recorded as expectations, not executable):
REQ-ANALYTICS-012 active-workers/day derivation; REQ-ANALYTICS-013 rooms-completed-per-worker
(BLOCKED pending OQ-ANALYTICS-03); REQ-ANALYTICS-014 rating/warning counts (blocked on
OQ-ANALYTICS-08); REQ-ANALYTICS-015 sick/vacation counts (blocked on Calendar module delivery,
OQ-ANALYTICS-07). PIVOT §10 "Success criteria per phase" requires all module tests green, envelope
conformance, and RBAC/scope tests to pass.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN). These are NOT resolved here.

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-ANALYTICS-01 | **security defect — CRITICAL** | `GET /analytics/leaderboard`(`/by-hotel/:hotel_id`) has NO `requireRole` and NO `checkHotelAccess`/tenant-boundary check (`analytics/routes.ts:9-14`) — any authenticated user of any role, including a self-signup-obtainable WORKER, can read any OTHER hotel's worker names + performance ratings by passing an arbitrary `hotel_id`, unlike this module's own `/stats`/`/hotel-summary` (both `requireRole(['admin','manager'])`, `:15-24`) and unlike the sibling `GET /quality/leaderboard/by-hotel/:hotel_id`, which gates the byte-identical `WorkerOverallRating` query with BOTH `requirePermission('quality:read')` AND `checkHotelAccess()` (`quality/routes.ts:18`) — i.e. the SAME underlying data is protected in one module and unprotected in the other. Classified **Critical** by independent security review (Confidence High). Given the Germany-only, GDPR-governed operating context (CONFIRMED §33), this is also a plausible personal-data confidentiality / purpose-limitation concern requiring DPO/legal determination, not merely an access-control question. Residual risk is LIVE, in already-deployed code, and UNASSIGNED — no one is accountable for accepting or remediating it. This finding is **BLOCKING for G2 freeze**: per Constitution §12 a Critical finding blocks merge/freeze until it is either fixed in code (out of scope for this specification — this document only represents and dispositions the finding, it does not implement the fix) or formally accepted via an authorized, time-bounded Risk Assessment. This item MUST NOT be treated as a routine open item pending convenience. | `analytics/routes.ts:9-14` vs `:15-24`; `quality/routes.ts:18` | human — **blocking, unassigned, Critical** | **OPEN — BLOCKING (Critical); requires code fix or human-authorized Risk Assessment per Constitution §12 before G2 freeze** |
| OQ-ANALYTICS-02 | risk | `mobile/worker-app/src/app/(app)/index.tsx:36` (`DashboardScreen`) calls `api.analytics.stats()` (`GET /analytics/stats`) unconditionally for every logged-in user, but that route requires `role in [admin,manager]` (`analytics/routes.ts:15-19`); a WORKER-role user's stats call always resolves as a rejected promise (403), silently swallowed by `Promise.allSettled` (`index.tsx:34-42`), so the worker dashboard's stat cards permanently render empty for every worker. ADDITIONALLY (evidence found during authoring, not requested but material): even if the RBAC mismatch were fixed, the mobile client's own `DashboardStats` type (`mobile/worker-app/src/types/api.ts:110-116`: `total_shifts`/`completed_shifts`/`upcoming_shifts`/`average_rating`/`pending_applications`) has NO field-name overlap with the backend's actual `DashboardStats` shape (`analytics/types.ts:10-42`: `work_requests`/`assignments`/`attendance`/`quality`/`ratings`) — a second, independent contract mismatch on the same call. Both are current-state observations, not target-state requirement gaps. | `mobile/worker-app/src/app/(app)/index.tsx:34-42`; `analytics/routes.ts:15-19`; `mobile/worker-app/src/types/api.ts:110-116`; `analytics/types.ts:10-42` | human | **OPEN** |
| OQ-ANALYTICS-03 | decision | Target metric "rooms completed per worker" (PIVOT §14 Appendix, line 490) is undefined/contradictory against the confirmed no-room-level-task-layer decision (CONFIRMED §33, line 387: "Task" and "Work Request" do NOT need separating; full-day employment model). The metric itself is sourced to PIVOT §4.9 (line 131, "Manager logs rooms completed per worker"); this spec INFERS (not cites) that such data would land on the target `ReceptionData` model given §4.9's description, but §9.3 (line 397) describes `ReceptionData` only as "Manager-entered checkout / long-stay data" — no rooms-completed field is listed there, and `ReceptionData` is itself unbuilt target state — so this spec cannot decide the metric's definition. | CONFIRMED §33 (line 387) vs PIVOT §14 Appendix (line 490), §4.9 (line 131); §9.3 (line 397, does not itself mention rooms-completed) | human/product | **OPEN — blocking, headline** |
| OQ-ANALYTICS-04 | risk | (a) Current-state analytics queries against `WorkRequest`/`WorkerAssignment` status enums will need re-validation once those owning modules pivot (`WorkRequest`→broadcast `JobRequest` per PIVOT §9.1 line 377; `WorkerAssignment` creation path changes per PIVOT §9.1 line 378), even if table names persist. (b) PIVOT §9.1 (line 377) states `WorkRequest` IS repurposed as `JobRequest`, while PIVOT §9.3 (line 394) lists `JobRequest` as a NEWLY ADDED model — an internal inconsistency in the source document this spec cannot resolve. | PIVOT §9.1 (lines 377-378), §9.3 (line 394); `analytics/service.ts:75,76,81,82,189,197` | human/architecture | **OPEN** |
| OQ-ANALYTICS-05 | risk | PIVOT §4.11 (line 137) cross-references "Section 7" for basic-analytics scope, but PIVOT Section 7 "Component Design" (§7.1-7.7, lines 261-298) has no analytics subsection — a dangling cross-reference. The only concrete scope definition is PIVOT §14 Appendix (line 490), used as authoritative throughout this spec. Recorded as a target-state documentation-consistency observation. | PIVOT §4.11 (line 137); §7 (lines 261-298); §14 Appendix (line 490) | human/documentation | **OPEN — non-blocking** |
| OQ-ANALYTICS-06 / SYNC-001 | decision | Owner is `unassigned` — blocks accountable ownership and SLO-setting. `SYNC-001` (canonical token: `TERMINOLOGY.md:51`) is a single, shared, PLATFORM-LEVEL synchronization item tracked once (intended to be tracked once in `.claude/knowledge/SYNC_STATE.yaml`) — this row REFERENCES that shared token for `backend-analytics`'s own ownership gap; it does NOT independently define or re-scope `SYNC-001` itself. The identically-worded owner rows in `quality/MODULE_SPEC.md:520` and `attendance/MODULE_SPEC.md:461` similarly reference — not separately redefine — the same shared token for their own modules; consistency review noted that three sibling REVIEW-status specs currently restate the token with duplicated literal text rather than a single canonical cross-reference. Reconciling that duplication into one canonical tracking entry is routed to post-flight/consistency synchronization — no new namespaced ID is invented here, and none is proposed. | `MODULE_REGISTRY.yaml:161-171`; `TERMINOLOGY.md:51` | human | **OPEN** |
| OQ-ANALYTICS-07 | risk | "Sick/vacation counts per hotel" depends entirely on the target `CalendarEntry` model (PIVOT §9.3, line 393, unbuilt); zero current-state capability. Blocked on Calendar module delivery at milestone M2 (PIVOT §12, line 453), which is a prerequisite for M5 analytics delivery (line 456). | PIVOT §9.3 (line 393); §12 (lines 453,456) | human/architecture | **OPEN — blocked on M2** |
| OQ-ANALYTICS-08 | risk | "Rating/warning counts" — current state has raw `average_score`/`total_ratings` via `WorkerOverallRating`, but no warning-tier count exists. PIVOT §4.6/§7.5 (quality module target) defines warning thresholds as notification logic, not a stored/countable entity; analytics has no warning state to read yet. | PIVOT §4.6, §7.5; `analytics/service.ts` (no warning read) | human/architecture | **OPEN — gap** |
| OQ-ANALYTICS-09 | risk | "Active workers/day" is only PARTIALLY analogous to current `hotel-summary.active_assignments`/`today_attendance` fields — those count ASSIGNMENT/ATTENDANCE ROWS, not DISTINCT active workers. Exact derivation for the target metric is undecided. | `analytics/service.ts:197-207,239-246`; PIVOT §14 Appendix (line 490) | human/architecture | **OPEN** |
| OQ-ANALYTICS-10 | decision | No performance budget/SLO for leaderboard/stats/hotel-summary latency; the leaderboard is an unpaginated `take 50`; `getDashboardStats`/`getHotelSummary` fan out to 8-11 parallel, non-transactional queries per request. Performance review additionally verified that when `hotelId` is omitted, ALL 11 `getDashboardStats` calls run with an empty `where` clause — unfiltered, unwindowed aggregation over the platform's ENTIRE history, with no caching and no rate limit (see "Performance budgets/workload" below) — a workload-growth risk distinct from the missing-index/over-fetch observations, with no budget defined to bound it. | Code/authorities define none; `analytics/service.ts:60,74-106` (empty `scope` when `hotelId` undefined) | human/unassigned | **OPEN** |
| OQ-ANALYTICS-11 | risk | `backend-analytics` owns no state; 100% of its contract is unversioned, direct cross-module Prisma reads across six domains owned by five other modules, with no ADR governing this cross-module read-access boundary (Constitution §7, "explicit interfaces; consumers do not reach into private internals"). Architecture review classified this **Medium, non-blocking for this artifact**: the pattern is repository-wide (10+ other `reads-state` edges exist across the codebase) and was not elevated to a blocking finding in the structurally identical, already-completed review of `quality/MODULE_SPEC.md`. Required outcome is a **platform-wide** Decision Record — NOT scoped to this spec, NOT authored here — owned by the Lead Architect. This item does not block this module's own G2 freeze; it is recorded so the platform-wide gap is tracked. | "Ownership and Boundaries" (owns no state, six `reads-state` edges to five owning modules); "Dependencies" (same six edges); no ADR-003/ADR-004 provision addresses cross-module read access specifically | human/architecture (Lead Architect, platform-wide) | **OPEN — non-blocking for this artifact; platform-wide ADR required** |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-ANALYTICS-01 | assumption | PIVOT §14 Appendix's "derived from existing data, no new pipeline" (line 490) is read as meaning the four basic-analytics metrics remain Prisma reads over existing (or target-state, already-planned) tables rather than requiring a new ETL/aggregation/warehouse layer. This is an inference from wording, not an explicit architecture decision. | PIVOT §14 Appendix (line 490) | Assumption for target-state, not confirmed |
| ASM-ANALYTICS-02 | assumption | The leaderboard's shared-source-of-truth comment (`analytics/service.ts:20-25`) is treated as documented current-state INTENT, not as a contract guarantee — the two leaderboard implementations (`backend-analytics`, `backend-quality`) are separately maintained code paths that happen to query the same table the same way; a future change to one without the other would silently break the stated invariant. | `analytics/service.ts:20-25`; `quality/service.ts:203-224` | Assumption for current-state |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-analytics` from `UNKNOWN` →
  `SPEC-ANALYTICS-001@0.1.1 (REVIEW)` (`MODULE_REGISTRY.yaml:161-171`, field at line 170). Do NOT
  alter `owner` (remains `unassigned`, OQ-ANALYTICS-06 / SYNC-001).
- **DEPENDENCY_GRAPH.yaml:** **REQUIRED current-state delta (dependency review, FIND-DEP-001 —
  adjudicated, not merely candidate):** the `HotelWorker` relation-filter read inside
  `getLeaderboard` (`analytics/service.ts:29-33`, `worker.hotel_workers.some({hotel_id, status:ACTIVE})`)
  IS a genuine missing edge — dependency review confirmed it is the same class of coupling as three
  existing `*-reads-hotel-worker` edges already present in the graph. **ADD**
  `edge-analytics-reads-hotel-worker` (source `backend-analytics`, target `state-hotel-worker`, kind
  `reads-state`, compatibility `not-applicable`, status `observed`, evidence
  `analytics/service.ts:29-33`) **AND** add `backend-analytics` to `state-hotel-worker.readers`, at
  the next dependency-synchronization pass. Housekeeping note (informational only, FIND-DEP-003 —
  confirmed immaterial by empty diff): `DEPENDENCY_GRAPH.yaml` `observed_revision` is currently
  stamped `5b16be4` (line 3), which predates this spec's cited revision `ef25dae6`; a restamp is a
  synchronization-owner decision, not applied here, and dependency review confirmed the stale stamp
  produces no actual discrepancy for this module's edges. All six pre-existing `edge-analytics-reads-*`
  edges and `edge-mobile-worker-analytics` were verified against `ef25dae6` during authoring and
  accurately reflect current reality — no correction needed to those seven edges. Note
  (FIND-DEP-002, informational, not this spec's problem): dependency review separately observed that
  `backend-quality` has the identical undiscovered `HotelWorker` relation-filter gap in its own
  leaderboard query — out of scope for `SPEC-ANALYTICS-001`. Note (FIND-DEP-004): the
  `edge-quality-reads-attendance` precedent cited above (the pattern this new edge mirrors) is
  itself still unapplied to `DEPENDENCY_GRAPH.yaml` as of this writing — i.e. it too is pending the
  same synchronization pass, not yet a graph edge.
- **TERMINOLOGY.md:** no new canonical terms are promoted by this spec. "Leaderboard entry",
  "Dashboard stats", "Hotel summary", and "Basic analytics" remain local/target-state terms
  (per this document's Actors and Terminology section) pending a promotion decision by
  terminology/consistency review.
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith) and ADR-004 (Prisma ORM) as existing
  anchors (both Proposed). No new Decision Record is proposed by this spec; OQ-ANALYTICS-03's
  room-level-task-layer conflict is a product-scope question, not an architecture-decision
  candidate, and is routed to human/product authority directly.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec issuance
  if/when this candidate advances.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-07 | Initial reverse-specification authored from repository evidence and cross-checked against CONFIRMED_REQUIREMENTS_REGISTER.md/PIVOT_DESIGN_DOCUMENT.md. Current-state reverse spec: REQ-ANALYTICS-001..010, RULE-ANALYTICS-001..005 at `ef25dae6`. Target layer from confirmed authorities: REQ-ANALYTICS-011..016, RULE-ANALYTICS-006 (CONFIRMED §21/§34; PIVOT §3/§4.11/§9-§10/§12/§14 Appendix). Migration-gap enumeration MIG-GAP-ANALYTICS-01..04. Recorded open decisions/risks OQ-ANALYTICS-01 (leaderboard RBAC/hotel-scope asymmetry), OQ-ANALYTICS-02 (mobile-worker `/stats` RBAC 403 + independent type-shape mismatch), OQ-ANALYTICS-03 (rooms-completed-per-worker contradicts no-room-layer decision, blocking), OQ-ANALYTICS-04 (WorkRequest/JobRequest re-validation risk + §9.1/§9.3 source-document inconsistency), OQ-ANALYTICS-05 (PIVOT §4.11 dangling "Section 7" cross-reference), OQ-ANALYTICS-06 (owner unassigned / SYNC-001), OQ-ANALYTICS-07 (sick/vacation blocked on Calendar/M2), OQ-ANALYTICS-08 (rating/warning counts gap), OQ-ANALYTICS-09 (active-workers/day derivation undecided), OQ-ANALYTICS-10 (no SLO / unpaginated + non-transactional fan-out). Flagged UNTESTED criteria: leaderboard role/hotel-scope absence, leaderboard aggregation math, dashboard-stats field mapping, hotel-summary field mapping, envelope/no-audit-write assertion. | None — REVIEW, not approved. | None — status REVIEW, G2 freeze reserved to human. |
| 0.1.1 | 2026-07-08 | Applied merged dispositions from five independent G4 reviews (architecture, dependency, consistency, performance — all `PASS_WITH_ACTIONS`; security — `FAIL`, 1 Critical + 1 Medium). No REQ/RULE/MIG-GAP ids renumbered; one new open item added (OQ-ANALYTICS-11). **FIND-01 (security, Critical):** rewrote OQ-ANALYTICS-01 and the "Trust boundaries/authorization" subsection to state the finding is Critical (not a routine open item), cites the `quality/routes.ts:18` comparison showing quality gates the identical `WorkerOverallRating` data while analytics does not, adds the GDPR/personal-data angle (CONFIRMED §33 Germany-only context), and states this is BLOCKING for G2 freeze pending a code fix (out of scope for this specification) or a human-authorized Risk Assessment per Constitution §12. **FIND-02 (security, Medium):** reframed "Observability/audit" to state the absence of audit-log writes acts as a severity multiplier for OQ-ANALYTICS-01 by removing the only mitigating factor (detectability). **FIND-ARCH-001 (architecture, Medium, non-blocking):** added `OQ-ANALYTICS-11` recording the no-owned-state / 100%-cross-module-reads / no-governing-ADR finding verbatim, with required outcome a platform-wide Decision Record owned by the Lead Architect — not resolved here. **FIND-DEP-001 (dependency, Medium):** rewrote the "Proposed Knowledge Deltas" `DEPENDENCY_GRAPH.yaml` bullet from a deferred candidate to a definitive, dependency-review-adjudicated required addition (`edge-analytics-reads-hotel-worker` + `state-hotel-worker.readers`); updated the corresponding "Ownership and Boundaries" `state-hotel-worker` bullet to match. **FIND-DEP-002/003/004 (dependency, informational):** noted the quality-module's identical undiscovered gap is out of scope here; confirmed the stale `observed_revision` stamp produces no discrepancy for this module; noted the `edge-quality-reads-attendance` precedent citation is itself still pending application to the graph. **FIND-001 (consistency, Medium):** added a hedge-disclosure paragraph to "Evidence and Traceability" noting CONFIRMED §21 line 293 itself hedges the four basic-analytics metrics as "proposed" and that this spec relies on PIVOT §14 Appendix (line 490) as the concrete resolution. **FIND-002 (consistency, Medium):** corrected the PIVOT §9.3 line 397 mis-citation in MIG-GAP-ANALYTICS-02 and OQ-ANALYTICS-03 — line 397 does not itself mention rooms-completed data; reworded the `ReceptionData` connection as this spec's own inference, citing PIVOT §4.9 (line 131) as the actual metric source. **FIND-003 (consistency, Medium):** reworded OQ-ANALYTICS-06's description to state `SYNC-001` is a single shared platform-level token this spec references (per `quality/MODULE_SPEC.md:520`, `attendance/MODULE_SPEC.md:461`), not independently defines; no new namespaced ID invented. **FIND-004 (consistency, Low):** corrected the PIVOT §7 line range (261-292 → 261-298) in both the "Evidence and Traceability" dangling-cross-reference paragraph and OQ-ANALYTICS-05. **FIND-005 (consistency, informational):** no action — corpus-wide ID-prefixing drift not attributable to this candidate. **Performance FIND-01 (Low):** broadened the index-coverage disclosure in "Performance budgets/workload" to list all six indexed fields verified by performance review (`WorkRequest.status`, `WorkerAssignment.status`, `Attendance.status`, `QualityVerification.hotel_id`/`.status`, `Rating.hotel_id`), not just `average_score`. **Performance FIND-02 (Medium):** added the unfiltered/unbounded `getDashboardStats` aggregation observation (empty `where` when `hotelId` omitted) to "Performance budgets/workload" and cross-referenced it from OQ-ANALYTICS-10. **Performance FIND-03 (Low):** quantified `getHotelSummary`'s nested `getLeaderboard()` call as a 10x over-fetch ratio in "Performance budgets/workload". **Performance FIND-04 (Low):** added the missing `Attendance.created_at`/`[hotel_id, created_at]` index observation to "Performance budgets/workload". Document Control bumped to `0.1.1`; Authors/reviewers row updated to record all five gate results, including the unresolved Security `FAIL`. Status remains `REVIEW` — NOT frozen; no owner invented; OQ-ANALYTICS-03 and all other open product/architecture decisions remain unresolved; the underlying Critical security code defect is NOT fixed by this document. | FIND-ARCH-001, FIND-DEP-001, FIND-DEP-002, FIND-DEP-003, FIND-DEP-004, FIND-001, FIND-002, FIND-003, FIND-004, FIND-005, FIND-01 (security), FIND-02 (security), FIND-01 (performance), FIND-02 (performance), FIND-03 (performance), FIND-04 (performance). | None — status REVIEW, not approved; Security gate remains FAIL/blocking pending code fix or authorized Risk Assessment; G2 freeze reserved to human. |
