# Milestone: MVP Completion Decisions — Execution Plan

| Field | Value |
|---|---|
| Date | 2026-07-27 |
| Status | Planned — not yet started |
| Decided by | Product Owner (2026-07-27, this session) |
| Governed by | [`GOVERNANCE_DECISIONS_REQUIRED.md`](GOVERNANCE_DECISIONS_REQUIRED.md) `GD-04`, `GD-05`, `GD-06` |
| Tracked in | [`../05-execution/EXECUTION_DASHBOARD.md`](../05-execution/EXECUTION_DASHBOARD.md) |

## Why this milestone

Per the Implementation Planner's completion-state assessment (2026-07-27, immediately following
the Authorization Foundation milestone): nothing in the codebase is currently code-blocked on an
open decision. `GD-04`, `GD-05`, and `GD-06` are the last three decisions the Release Readiness
Audit's own "Decisions blocking MVP" framing named (`GD-01`/`02`/`03` are done). All three are now
decided (below) and ready to build.

## Decisions made this session

| ID | Decision | Rationale |
|---|---|---|
| `GD-04` | **Split.** Ship the single-writer + delete-behavior correctness fix now. Defer recency-weighting/warning-tiers/photo-policy as a separate, later product decision. | The dual-writer divergence is a live correctness bug independent of the tiering question; tiers/warnings/photo-policy are new business rules the CRR doesn't fully specify and must not be assumed (Constitution §6). |
| `GD-05` | **Option (a).** Boolean `Hotel.accepting_jobs`, enforced at work-request creation. | Matches the confirmed CRR text (`REQ-CRM-008` is a simple toggle); lowest-risk, fully reversible; scheduled pause windows are unrequested scope. |
| `GD-06` | **Option (a), scoped.** A worker-scoped analytics endpoint (own stats only). Warning-count and sick/vacation-count metrics are deferred until `GD-04`'s tiers and `GD-18`'s Calendar respectively land — this decision covers only currently-derivable metrics (own completed jobs/rooms, own rating, own attendance-to-date). | Resolves the silent 403 the mobile-worker dashboard already produces; avoids defining metrics against data that doesn't exist yet. |

---

## PR-1 — GD-04: Quality rating single-writer + delete-behavior fix

**Problem** (verified against current code): `WorkerOverallRating.average_score` and related
aggregate fields are written from two places that can diverge:
- A Postgres trigger (`prisma/migrations/20260613120000_v2_marketplace_init/migration.sql:583-631`,
  `trg_rating_refresh_overall()` / `refresh_worker_overall_rating()`) fires `AFTER INSERT OR UPDATE
  OR DELETE ON "Rating"`, recomputing only `average_score`, `total_ratings`, `last_worked_at` — it
  never touches `total_assignments`, `completion_rate`, `on_time_rate`.
- An app-level upsert inside `createRating`'s transaction
  (`backend/src/modules/quality/service.ts`, ~lines 190-220) recomputes **all** aggregate fields,
  including the three the trigger ignores.
- No code path deletes or updates a `Rating` row today (confirmed: zero matches for
  `.rating.delete`/`.rating.update` outside `createRating`'s own create), so the trigger's DELETE
  branch is currently latent — but a cascading FK delete (`Rating.assignment onDelete: Cascade` from
  `WorkerAssignment`) would fire the trigger alone, leaving `total_assignments`/`completion_rate`/
  `on_time_rate` stale with no app code to re-sync them.

**Fix**: make the app-level upsert the single writer; drop the trigger.

- [ ] Migration: `DROP TRIGGER "Rating_refresh_overall_rating" ON "Rating";` and
      `DROP FUNCTION refresh_worker_overall_rating(...);` / `trg_rating_refresh_overall()`. Hand-author
      `down.sql` recreating both (the original migration's `CREATE TRIGGER`/`CREATE FUNCTION`
      statements), per this repo's migration-harness convention (`scripts/migrate-harness.sh
      check-pairs`).
- [ ] `backend/src/modules/quality/service.ts`: add explicit handling for the cascading-delete case
      the trigger used to cover — either (a) add a soft-delete-aware recompute path if/when
      `WorkerAssignment` deletion is ever exercised in code (currently it isn't — confirm this
      remains true, or add the recompute call at whatever call site performs the cascade-triggering
      delete), or (b) if no such call site exists anywhere in the codebase, document that the
      aggregate is create-only-consistent by design until a delete path is added, and add a
      regression test asserting that.
- [ ] Regression test: assert `WorkerOverallRating` fields exactly match a fresh
      `aggregate()`/`count()` computation after `createRating`, covering all five fields (not just
      `average_score`/`total_ratings`, which the trigger already got right).
- [ ] Verify all four consumers still read correctly, unchanged: quality leaderboard
      (`quality/service.ts:272`), analytics leaderboard (`analytics/service.ts:27-66`, the
      "same ordering as quality leaderboard" invariant at lines 20-24), work-applications rating
      snapshot (`work-applications/service.ts:72-105`), mobile-worker ratings screen
      (`mobile/worker-app/src/app/ratings.tsx:19` via `analytics.leaderboard()`).
- **Gate:** Architecture Review (state-ownership/single-writer change) + regression test suite green.
- **Est.:** 1–2 PRs (within the 5–7 total `GD-04` estimate; tiers/warnings/photo-policy remain
  separately estimated when that sub-decision is made).

## PR-2 — GD-05: Per-hotel "pause new jobs" toggle

- [ ] Migration: add `Hotel.accepting_jobs Boolean @default(true)` (additive, reversible;
      `down.sql` drops the column).
- [ ] `backend/src/modules/crm/types.ts:11-22` (`UpdateHotelSchema`): add
      `accepting_jobs: z.boolean().optional()`.
- [ ] `backend/src/modules/crm/service.ts` `updateHotel()` (lines 85-107): add
      `accepting_jobs: data.accepting_jobs ?? hotel.accepting_jobs` to the update payload.
- [ ] `backend/src/modules/work-requests/service.ts` `create()` (lines 62-105): add
      `if (!hotel.accepting_jobs) throw new ForbiddenError(...)` immediately after the existing
      `hotel.deleted_at` check (line 67-68), before the manager-scope check.
- [ ] Route/permission gate: ride the existing
      `PATCH /hotels/:hotel_id` (`crm/routes.ts:24`, already `checkHotelAccess()` +
      `requireRoleFlagged(['admin','manager'],'admin')` + `requirePermission('hotels:write')`) — no
      new route needed for the toggle itself.
- [ ] Frontend: hotel-admin toggle UI (per `GOVERNANCE_DECISIONS_REQUIRED.md`'s own impact estimate
      — not yet built, scope TBD by whoever picks this up).
- [ ] Regression tests: work-request creation rejected when `accepting_jobs: false`; toggle
      round-trips via `PATCH /hotels/:hotel_id`; existing hotel-update tests unaffected.
- **Gate:** none named beyond standard implementation verification (small, additive, no
  cross-module ownership change).
- **Est.:** 2–3 PRs, matching the register's own estimate.

## PR-3 — GD-06: Worker-scoped analytics endpoint

- [ ] New method in `backend/src/modules/analytics/service.ts`: `getWorkerStats(workerId: string)`
      (or similar), scoped entirely to `worker_id` — reusing the same query shapes
      `getDashboardStats` (lines 71-207) already uses at hotel scope, but filtered to the caller:
  - Completed assignments: `WorkerAssignment.count({ where: { worker_id, status: 'COMPLETED' } })`
    (same pattern as `quality/service.ts:200-206`).
  - Rooms completed: `RoomsCompletedEntry` filtered by `worker_id` (denormalized on that model).
  - Own rating: `WorkerOverallRating.findUnique({ where: { worker_id } })` (same pattern as
    `work-applications/service.ts:72-75`).
  - Own attendance breakdown (present/late/absent-to-date): `Attendance` filtered by `worker_id`,
    same aggregation shape `analytics/service.ts` already builds at hotel scope.
  - Explicitly **excluded from this PR** (deferred per the GD-06 decision above): warning counts
    (needs `GD-04`'s tiers) and sick/vacation counts (needs `GD-18`'s Calendar).
- [ ] New route `GET /analytics/my-stats` in `backend/src/modules/analytics/routes.ts`, gated by
      `authMiddleware` only (any authenticated role, scoped server-side to `req.auth.userId` — not
      an admin/manager permission check, since this is inherently self-scoped) — do **not** reuse
      the existing `/stats` route's `requireRole(['admin','manager','regional_manager'])` gate, that
      route stays as-is for the cross-worker dashboard.
- [ ] Response shape: a new type (e.g. `WorkerStats`) rather than overloading `DashboardStats`,
      since the fields are a scoped subset, not a filtered version of the same shape — avoids a
      client having to distinguish "zero because no data" from "field not applicable at this scope."
- [ ] Mobile client: `mobile/worker-app/src/lib/api.ts:340-342` — add
      `analytics: { myStats: () => request<WorkerStats>('/analytics/my-stats'), ... }`.
      `mobile/worker-app/src/app/(app)/index.tsx` (`load()`, lines 27-45) — currently calls
      `api.analytics.stats()` inside `Promise.allSettled` and silently swallows the 403 (`stats`
      stays `null`, no card shown). Switch this call to `api.analytics.myStats()`. **Client-side
      decision point, not yet made:** whether the existing dashboard card design can display the
      new scoped fields as-is, or needs a small UI adjustment — flag to whoever implements this PR,
      not decided here.
- [ ] Regression tests: worker A cannot see worker B's stats (scope enforcement); response shape
      matches `WorkerStats`; existing `/analytics/stats` (admin/manager) behavior fully unchanged.
- **Gate:** none named beyond standard implementation verification (new, additive, self-scoped
  endpoint; no change to existing analytics authorization).
- **Est.:** 3–5 PRs (this PR only — matches the register's own estimate for the option-(a) scope
  actually being built here, since the warning/sick-vacation metrics are excluded).

---

## Ordering / dependencies

PR-1, PR-2, and PR-3 are fully independent of each other and can be built in any order or in
parallel — none shares a file, a migration, or a module boundary with either of the others. No
ordering constraint exists between them.

## Out of scope for this milestone (explicitly, not silently)

- `GD-04`'s tiers/warnings/photo-policy sub-decision — not decided, not planned here.
- `GD-06`'s warning-count and sick/vacation-count metrics — blocked on `GD-04`/`GD-18`, not
  decided, not planned here.
- Any frontend (web) UI work beyond what's noted per-PR above — this plan is backend-first per the
  existing repository convention of shipping the API/data layer before the web client.
- `GD-08`/`GD-09`/`GD-10`/`GD-11`/`GD-12`/`GD-13` and all other open `GD-*` rows — separate,
  independent decisions, not part of this milestone.

## Definition of done

All three PRs merged, full backend suite green, `EXECUTION_DASHBOARD.md`'s "Remaining Modules &
Work" table updated to remove the `GD-04`/`GD-05`/`GD-06` row (its correctness-fix/toggle/endpoint
scope, specifically — the deferred sub-decisions above remain as separate, still-open items).
