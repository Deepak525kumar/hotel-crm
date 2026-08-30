-- Restores the index the forward migration replaced, so the rolled-back code
-- finds the scan it expects rather than falling back to a sequential scan.
CREATE INDEX IF NOT EXISTS "ReworkRound_completed_at_escalated_at_assigned_at_idx"
  ON "ReworkRound"("completed_at", "escalated_at", "assigned_at");
DROP INDEX IF EXISTS "ReworkRound_completed_at_cancelled_at_assigned_at_idx";
DROP INDEX IF EXISTS "ReworkRound_completed_at_escalated_at_timer_started_at_idx";

-- Deferred rounds become indistinguishable from running ones once the column
-- is gone: the old code measures from assigned_at, which is the behaviour that
-- existed before this migration. Cancellations lose their reason and read as
-- simply still-open, which is also the pre-migration shape.
ALTER TABLE "ReworkRound" DROP COLUMN IF EXISTS "cancellation_reason";
ALTER TABLE "ReworkRound" DROP COLUMN IF EXISTS "cancelled_at";
ALTER TABLE "ReworkRound" DROP COLUMN IF EXISTS "timer_started_at";
