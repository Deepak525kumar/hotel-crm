-- Down migration for 20260827214224_add_job_request_target_role

DROP INDEX IF EXISTS "WorkRequest_target_role_idx";
ALTER TABLE "WorkRequest" DROP COLUMN IF EXISTS "target_role";
