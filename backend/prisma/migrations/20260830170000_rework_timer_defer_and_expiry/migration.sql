-- Owner decision (2026-08-30): the 20-minute rework clock must only run while
-- the worker can actually act on it.
--
-- A checker often inspects after the worker has gone home. Starting the clock
-- at assignment then guaranteed an escalation nobody could have prevented --
-- the worker was not on site. Such a round is now DEFERRED: it waits until the
-- worker next checks in at that hotel, which is when the clock begins.

-- NULL = deferred, waiting for the worker to be on site.
ALTER TABLE "ReworkRound" ADD COLUMN "timer_started_at" TIMESTAMP(3);
-- Closed without being fixed. Deliberately separate from completed_at: the
-- room was never done, and the record has to keep saying so.
ALTER TABLE "ReworkRound" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "ReworkRound" ADD COLUMN "cancellation_reason" TEXT;

-- Existing rounds ran under the old rule, where assignment WAS the start. Give
-- them assigned_at so their clock is unchanged rather than silently restarting
-- (a NULL here would re-defer live rounds and stop them escalating at all).
UPDATE "ReworkRound" SET "timer_started_at" = "assigned_at";

CREATE INDEX "ReworkRound_completed_at_escalated_at_timer_started_at_idx"
  ON "ReworkRound"("completed_at", "escalated_at", "timer_started_at");
CREATE INDEX "ReworkRound_completed_at_cancelled_at_assigned_at_idx"
  ON "ReworkRound"("completed_at", "cancelled_at", "assigned_at");
DROP INDEX IF EXISTS "ReworkRound_completed_at_escalated_at_assigned_at_idx";
