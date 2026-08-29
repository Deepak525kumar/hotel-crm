-- Reverses the schema. Restoring the unique constraint FAILS if any shift has
-- more than one check, which is the normal state after this migration has been
-- in use -- and that is the honest behaviour: there is no non-arbitrary way to
-- choose which room's check to keep, so the rollback stops rather than
-- silently discarding inspections.
--
-- The migration harness exercises this on an empty database, where the
-- constraint can always be restored. On a used database, drain or archive the
-- extra checks first.

DROP INDEX IF EXISTS "QualityVerification_room_number_idx";
DROP INDEX IF EXISTS "QualityVerification_assignment_id_idx";
ALTER TABLE "QualityVerification" DROP COLUMN IF EXISTS "room_number";
CREATE UNIQUE INDEX "QualityVerification_assignment_id_key"
  ON "QualityVerification"("assignment_id");
