-- Down migration for 20260818140000_add_rework_escalated_at
--
-- Dropping the column takes the index with it, but the index is dropped
-- explicitly first so the intent is visible in the diff rather than implied.
--
-- Consequence worth knowing before rolling back: rework_escalated_at is the
-- 20-minute escalation job's idempotence marker. Without it the job has no
-- way to tell an already-escalated row from a fresh one, so any rework still
-- open would be re-escalated on the next tick.
BEGIN;

  DROP INDEX "QualityVerification_rework_pending_idx";

  ALTER TABLE "QualityVerification" DROP COLUMN "rework_escalated_at";

COMMIT;
