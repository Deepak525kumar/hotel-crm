-- Down migration for 20260727030000_add_hotel_accepting_jobs
BEGIN;
  ALTER TABLE "Hotel" DROP COLUMN "accepting_jobs";
COMMIT;
