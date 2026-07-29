-- Epic 9 PR 9.6 (TREQ-007/TRULE-006, MIG-GAP-08): daily-exclusivity partial
-- unique index.
--
-- Re-keys the existing active-slot partial unique index from
-- (work_request_id, worker_id) -- a per-JobRequest constraint that cannot see
-- a competing calendar-placed assignment (work_request_id null, PR 9.5) or a
-- future broadcast-accept assignment (job_request_id only, PR 9.9) -- to
-- (worker_id, day), a per-CALENDAR-DAY constraint that spans every creation
-- path uniformly. `day` is a new denormalized column added to
-- WorkerAssignment for exactly this purpose (confirmed absent from
-- schema.prisma before this migration).
--
-- Repository-reality correction (see IMPLEMENTATION_EXECUTION_PLAN.md's PR
-- 9.6 section, 2026-07-29 architecture review): the backfill for this new
-- column is two-sourced by creation path, NOT single-sourced from
-- JobRequest.shift_date as the plan originally assumed --
--   * work_request_id IS NOT NULL (legacy/broadcast-lineage rows): day comes
--     from the related JobRequest.shift_date.
--   * work_request_id IS NULL and a CalendarEntry exists via the 1:1
--     assignment_id relation (calendar-placed rows, PR 9.5's
--     placeOnCalendar()): day comes from the related CalendarEntry.day.
-- No row should match neither condition pre-launch (job_request_id-only rows
-- do not exist yet -- PR 9.9 hasn't shipped), but the defensive check below
-- reports any anomaly rather than silently leaving a row's day null, which
-- would otherwise fail the final SET NOT NULL step loudly (and correctly).
--
-- Additive-then-backfill-then-constrain, this repo's established convention
-- for a column-shape change touching existing rows (mirrors
-- 20260722180000_rescale_rating_score_to_0_100's "relax constraint, backfill,
-- re-tighten" ordering and 20260729020000_add_calendar_entry's
-- nullable-relax precedent): add `day` nullable, backfill every existing
-- row, then set NOT NULL once every row is populated.
--
-- Take a DB snapshot immediately before applying this migration in any
-- environment holding real WorkerAssignment data -- this is the one PR in
-- Epic 9 with genuine backfill risk (per the plan's own Rollback note),
-- same discipline as Epic 5 PR 5.3's backfill guidance. This repository is
-- pre-launch with no production WorkerAssignment data at migration-authoring
-- time, so the two-sourced backfill below is exercised defensively, not
-- against a known non-trivial dataset -- do not skip the snapshot step in any
-- environment where that is no longer true.

-- 1. Add the new column nullable first (no default -- every row must resolve
--    through the backfill below, not through a fabricated value).
ALTER TABLE "WorkerAssignment" ADD COLUMN "day" DATE;

-- 2a. Backfill source 1: legacy/broadcast-lineage rows (work_request_id set)
--     take their day from the originating JobRequest's shift_date.
UPDATE "WorkerAssignment" wa
SET "day" = jr."shift_date"
FROM "WorkRequest" jr
WHERE wa."work_request_id" IS NOT NULL
  AND wa."work_request_id" = jr."id"
  AND wa."day" IS NULL;

-- 2b. Backfill source 2: calendar-placed rows (work_request_id null,
--     PR 9.5's placeOnCalendar()) take their day from the sibling
--     CalendarEntry created in the same transaction (1:1 via
--     CalendarEntry.assignment_id).
UPDATE "WorkerAssignment" wa
SET "day" = ce."day"
FROM "CalendarEntry" ce
WHERE wa."work_request_id" IS NULL
  AND wa."id" = ce."assignment_id"
  AND wa."day" IS NULL;

-- 2c. Defensive anomaly check: any row matching neither backfill source
--     (e.g. a hypothetical job_request_id-only row -- PR 9.9 hasn't shipped,
--     so none should exist yet) is reported loudly rather than silently
--     left null, which would otherwise surface only as an opaque NOT NULL
--     violation on the ALTER below.
DO $$
DECLARE
  anomaly_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO anomaly_count FROM "WorkerAssignment" WHERE "day" IS NULL;
  IF anomaly_count > 0 THEN
    RAISE EXCEPTION 'PR 9.6 backfill: % WorkerAssignment row(s) matched neither backfill source (no work_request_id-linked JobRequest.shift_date and no sibling CalendarEntry) -- manual investigation required before this migration can proceed to NOT NULL.', anomaly_count;
  END IF;
END $$;

-- 3. Tighten to NOT NULL now that every existing row is populated. Every
--    creation path going forward (placeOnCalendar(), this same PR's
--    service.ts follow-up write; any future PR 9.9 broadcast-accept path)
--    must also populate `day` directly at creation time -- this migration's
--    backfill only covers rows that exist before it runs.
ALTER TABLE "WorkerAssignment" ALTER COLUMN "day" SET NOT NULL;

-- 4. Re-key the active-slot partial unique index: drop the old
--    (work_request_id, worker_id) index (migration.sql:580-582 of
--    20260613120000_v2_marketplace_init) and replace it with
--    (worker_id, day) over the same active-status set (CONFIRMED,
--    IN_PROGRESS), spanning every creation path uniformly.
DROP INDEX "WorkerAssignment_active_slot_unique";

CREATE UNIQUE INDEX "WorkerAssignment_active_slot_unique"
  ON "WorkerAssignment"("worker_id", "day")
  WHERE "status" IN ('CONFIRMED', 'IN_PROGRESS');

-- 5. Plain (non-partial, non-unique) index on `day` alone -- supports
--    non-active-status queries (e.g. future PR 9.7 eligibility/reporting
--    reads spanning all statuses) without relying on the partial unique
--    index above, mirroring CalendarEntry.day's own standalone index
--    (CalendarEntry_day_idx, 20260729020000_add_calendar_entry).
CREATE INDEX "WorkerAssignment_day_idx" ON "WorkerAssignment"("day");
