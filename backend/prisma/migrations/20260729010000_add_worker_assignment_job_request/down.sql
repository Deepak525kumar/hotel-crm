-- Down migration for 20260729010000_add_worker_assignment_job_request
--
-- Trivial and safe: job_request_id is nullable and has no writer as of this
-- PR (see migration.sql), so no row can ever hold a non-null value at
-- down-migration time in this PR's lifetime -- dropping the column loses no
-- data.
BEGIN;
  ALTER TABLE "WorkerAssignment" DROP CONSTRAINT "WorkerAssignment_job_request_id_fkey";
  DROP INDEX "WorkerAssignment_job_request_id_idx";
  ALTER TABLE "WorkerAssignment" DROP COLUMN "job_request_id";
COMMIT;
