-- Down migration for 20260818120000_add_rework_assignment_link
--
-- Restores the day-exclusivity index to its pre-ADR-069 predicate BEFORE
-- dropping the column that predicate no longer references. Order matters: the
-- index depends on rework_of_assignment_id, so dropping the column first would
-- fail (or silently take the index with it).
--
-- Rework assignment rows themselves are NOT deleted -- they are real work a
-- worker performed. After this runs they become ordinary assignments with no
-- link back to the inspection that caused them. Note that this can leave two
-- active assignments for one worker/day, which the restored unique index would
-- reject on any subsequent write: verify no such pair exists before rolling
-- back, or the next insert for that worker/day will fail.
BEGIN;

  DROP INDEX "WorkerAssignment_active_slot_unique";

  CREATE UNIQUE INDEX "WorkerAssignment_active_slot_unique"
    ON "WorkerAssignment"("worker_id", "day")
    WHERE "status" IN ('CONFIRMED', 'IN_PROGRESS');

  DROP INDEX "WorkerAssignment_rework_of_assignment_id_idx";

  ALTER TABLE "WorkerAssignment"
    DROP CONSTRAINT "WorkerAssignment_rework_verification_id_fkey",
    DROP CONSTRAINT "WorkerAssignment_rework_of_assignment_id_fkey";

  ALTER TABLE "WorkerAssignment"
    DROP COLUMN "rework_verification_id",
    DROP COLUMN "rework_of_assignment_id";

COMMIT;
