-- Many checks per shift, each naming a room (owner decision, 2026-08-29:
-- "he should be able to mark ... at least 100 per shift so that he can upload
-- it for multiple rooms. add an option for room no while checking").
--
-- A checker inspects a shift room by room, so QualityVerification stops being
-- 1-to-1 with WorkerAssignment. The room number is REQUIRED: with many checks
-- on one shift, a check nobody can locate is not evidence of anything, and it
-- is the primary thing people will search on.

-- 1. Add the column nullable so existing rows survive the ALTER.
ALTER TABLE "QualityVerification" ADD COLUMN IF NOT EXISTS "room_number" TEXT;

-- 2. Backfill. These checks predate the field, so there is no honest room to
--    infer -- 'UNKNOWN' says exactly that, and says it in the UI too, rather
--    than inventing a plausible number that someone would later act on.
UPDATE "QualityVerification" SET "room_number" = 'UNKNOWN' WHERE "room_number" IS NULL;

-- 3. Now it can be required.
ALTER TABLE "QualityVerification" ALTER COLUMN "room_number" SET NOT NULL;

-- 4. Drop the 1-to-1 constraint. Prisma's @unique may have produced either a
--    unique INDEX or a table CONSTRAINT depending on when it was created, so
--    both forms are handled -- dropping the wrong one aborts the migration and
--    leaves the model unable to accept a second check.
ALTER TABLE "QualityVerification"
  DROP CONSTRAINT IF EXISTS "QualityVerification_assignment_id_key";
DROP INDEX IF EXISTS "QualityVerification_assignment_id_key";

-- 5. The lookups that constraint used to serve for free. Both the worker's
--    shift screen and the checker's history read every check for one
--    assignment; without this that becomes a sequential scan the moment a
--    hotel has a few hundred inspections.
CREATE INDEX IF NOT EXISTS "QualityVerification_assignment_id_idx"
  ON "QualityVerification"("assignment_id");

-- 6. Free-text search matches room alongside worker, hotel and notes.
CREATE INDEX IF NOT EXISTS "QualityVerification_room_number_idx"
  ON "QualityVerification"("room_number");
