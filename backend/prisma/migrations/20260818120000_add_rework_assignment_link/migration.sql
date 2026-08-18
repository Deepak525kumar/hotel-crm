-- ADR-069: rework is a NEW WorkerAssignment linked to the assignment that
-- failed inspection, rather than a mutation of the original.

-- 1. Link columns. Both nullable: an ordinary assignment has neither, and
--    `rework_of_assignment_id IS NULL` is the predicate used everywhere else
--    in this migration and in refreshWorkerOverallRating.
ALTER TABLE "WorkerAssignment"
  ADD COLUMN "rework_of_assignment_id" TEXT,
  ADD COLUMN "rework_verification_id" TEXT;

-- SET NULL rather than CASCADE on both: losing the original assignment or the
-- inspection must not silently delete the corrective work that was actually
-- performed, and the rework row carries its own attendance/history.
ALTER TABLE "WorkerAssignment"
  ADD CONSTRAINT "WorkerAssignment_rework_of_assignment_id_fkey"
  FOREIGN KEY ("rework_of_assignment_id") REFERENCES "WorkerAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkerAssignment"
  ADD CONSTRAINT "WorkerAssignment_rework_verification_id_fkey"
  FOREIGN KEY ("rework_verification_id") REFERENCES "QualityVerification"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkerAssignment_rework_of_assignment_id_idx"
  ON "WorkerAssignment"("rework_of_assignment_id");

-- 2. Day-exclusivity index now excludes rework rows.
--
--    WorkerAssignment_active_slot_unique exists to stop a worker being
--    double-BOOKED into two scheduled shifts on the same day
--    (20260729030000_add_worker_assignment_day_exclusivity). A rework task is
--    not a scheduled shift -- it is corrective work on a shift the worker has
--    already completed, and CRR §14 expects it to be actionable within 20
--    minutes, i.e. the same day.
--
--    Without this exclusion the constraint would reject the rework insert for
--    any worker who already holds an active assignment that day, making rework
--    impossible precisely for the busiest workers. The double-booking
--    guarantee is unchanged for real shifts: the predicate still covers every
--    row with rework_of_assignment_id IS NULL.
DROP INDEX "WorkerAssignment_active_slot_unique";

CREATE UNIQUE INDEX "WorkerAssignment_active_slot_unique"
  ON "WorkerAssignment"("worker_id", "day")
  WHERE "status" IN ('CONFIRMED', 'IN_PROGRESS')
    AND "rework_of_assignment_id" IS NULL;
