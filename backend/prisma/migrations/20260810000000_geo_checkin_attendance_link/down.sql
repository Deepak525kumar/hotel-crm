-- Down migration for 20260810000000_geo_checkin_attendance_link
--
-- Purely additive forward migration (nullable column, no data backfill) --
-- reverting is always safe, no data-loss precondition to verify.
BEGIN;

  ALTER TABLE "WorkerGeoCheckin" DROP CONSTRAINT "WorkerGeoCheckin_attendance_id_fkey";
  DROP INDEX "WorkerGeoCheckin_attendance_id_idx";
  ALTER TABLE "WorkerGeoCheckin" DROP COLUMN "attendance_id";

COMMIT;
