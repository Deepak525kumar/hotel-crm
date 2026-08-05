-- Down migration for 20260805030000_add_worker_assignment_skill_slot
BEGIN;
  DROP INDEX IF EXISTS "WorkerAssignment_skill_slot_id_idx";
  ALTER TABLE "WorkerAssignment" DROP CONSTRAINT IF EXISTS "WorkerAssignment_skill_slot_id_fkey";
  ALTER TABLE "WorkerAssignment" DROP COLUMN "skill_slot_id";
COMMIT;
