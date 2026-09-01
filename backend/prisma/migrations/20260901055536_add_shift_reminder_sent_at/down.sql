-- Paired rollback (repo convention). Removes the shift_reminder_sent_at
-- column added by the forward migration.
-- Safe to run against any state: IF EXISTS makes it idempotent and
-- tolerates a partial forward or an already-rolled-back schema.
ALTER TABLE "WorkerAssignment" DROP COLUMN IF EXISTS "shift_reminder_sent_at";
