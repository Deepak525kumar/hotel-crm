-- Down migration for 20260729020000_add_calendar_entry
--
-- Two independent reversals, of different risk classes (documented
-- explicitly per this plan's Definition of Done rollback-documentation
-- requirement, and per IMPLEMENTATION_EXECUTION_PLAN.md's PR 9.5 rollback
-- note):
--
-- 1. CalendarEntry table: additive-only, unread until this PR itself ran --
--    a down-migration dropping it is safe and immediate, no data-loss risk
--    beyond losing the CalendarEntry rows themselves (which is expected of
--    any down-migration for a newly-added table).
--
-- 2. WorkerAssignment.work_request_id nullability: safe to reverse ONLY IF
--    no row has a null work_request_id at down-migration time. Any
--    calendar-placed assignment created via placeOnCalendar() (this PR's own
--    service.ts change) necessarily has a null work_request_id (calendar
--    placement has no backing JobRequest at all, per ADR-056) -- restoring
--    NOT NULL would either fail or silently corrupt such rows. This mirrors
--    PR 9.2's WorkApplication down-migration precedent (its own fail-closed
--    guard on application_id): the guard below RAISEs loudly rather than
--    reinstating a constraint that no longer holds, rather than fabricating
--    a value or silently leaving the column nullable in contradiction of the
--    restored schema.
--
-- Running this down.sql is a last-resort rollback path for a window where no
-- calendar placement has yet been created against the post-migration schema
-- (e.g. rolling back before FEATURE_JOBDISPATCH_PHASE2 was ever turned on),
-- not a supported "undo PR 9.5" operation once calendar placements exist in
-- production.
BEGIN;

  -- DropForeignKey / DropIndex / DropTable (CalendarEntry) -- reverse
  -- creation order.
  ALTER TABLE "CalendarEntry" DROP CONSTRAINT "CalendarEntry_placed_by_id_fkey";
  ALTER TABLE "CalendarEntry" DROP CONSTRAINT "CalendarEntry_hotel_id_fkey";
  ALTER TABLE "CalendarEntry" DROP CONSTRAINT "CalendarEntry_worker_id_fkey";
  ALTER TABLE "CalendarEntry" DROP CONSTRAINT "CalendarEntry_assignment_id_fkey";

  DROP INDEX "CalendarEntry_day_idx";
  DROP INDEX "CalendarEntry_hotel_id_idx";
  DROP INDEX "CalendarEntry_worker_id_idx";
  DROP INDEX "CalendarEntry_worker_id_day_key";
  DROP INDEX "CalendarEntry_assignment_id_key";

  DROP TABLE "CalendarEntry";

  -- Fail-closed: if this fires, at least one WorkerAssignment row was
  -- created (via placeOnCalendar(), this PR's own new creation path, or any
  -- later PR 9.9 broadcast-accept row that also leaves work_request_id
  -- null) with no work_request_id value to reinstate NOT NULL against. See
  -- header -- mirrors 20260729000000_drop_work_application/down.sql's
  -- identical fail-closed guard on application_id.
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM "WorkerAssignment" WHERE "work_request_id" IS NULL) THEN
      RAISE EXCEPTION 'down.sql cannot restore NOT NULL on WorkerAssignment.work_request_id: one or more rows (calendar-placed or broadcast-accept assignments created after this migration ran) have no work_request_id value. Manual intervention required before NOT NULL can be reinstated.';
    END IF;
  END $$;

  ALTER TABLE "WorkerAssignment" ALTER COLUMN "work_request_id" SET NOT NULL;

COMMIT;
