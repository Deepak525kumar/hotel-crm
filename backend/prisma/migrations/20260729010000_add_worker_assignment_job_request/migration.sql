-- Epic 9 PR 9.3 (TREQ-012): adds WorkerAssignment.job_request_id, a nullable
-- FK back onto WorkRequest (forward-named ahead of PR 9.4's WorkRequest ->
-- JobRequest rename -- the table stays named "WorkRequest" in this
-- migration; only the new column is named job_request_id).
--
-- This is the second of two sequential migrations replacing what the
-- original plan specified as one paired migration shared with PR 9.2
-- (`20260729000000_drop_work_application`, already merged and NOT rewritten
-- here). That migration dropped the old application_id FK; this migration
-- adds the new job_request_id FK. Purely additive: nullable, no default, no
-- backfill -- no WorkerAssignment row can populate this column yet, since no
-- creation path writes to it until PR 9.9 (broadcast-accept). PR 9.5
-- (calendar) is the other future writer.
--
-- onDelete: SetNull (not Cascade) -- matches this schema's convention for
-- optional FKs where the referencing row should outlive the referenced row
-- (see Hotel.hotel_group_id, User.hotel_group_id, AuditLog.actor_id): an
-- assignment record must survive even if the job request it originated from
-- is later deleted.
ALTER TABLE "WorkerAssignment" ADD COLUMN "job_request_id" TEXT;

CREATE INDEX "WorkerAssignment_job_request_id_idx" ON "WorkerAssignment"("job_request_id");

ALTER TABLE "WorkerAssignment" ADD CONSTRAINT "WorkerAssignment_job_request_id_fkey"
  FOREIGN KEY ("job_request_id") REFERENCES "WorkRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
