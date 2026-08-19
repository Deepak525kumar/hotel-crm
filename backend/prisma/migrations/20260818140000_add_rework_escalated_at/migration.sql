-- ADR-069 / CRR §14: idempotence marker for the 20-minute rework escalation.
-- The scheduler re-runs on every tick, so without this an open rework would
-- re-notify the manager and checker on every pass. Also the claim target: the
-- job updates it inside the same transaction as the notifications, so two
-- worker processes cannot both escalate the same row.
ALTER TABLE "QualityVerification" ADD COLUMN "rework_escalated_at" TIMESTAMP(3);

-- Supports the job's predicate (rework_required AND not completed AND not
-- escalated) without scanning the whole verification table each tick.
CREATE INDEX "QualityVerification_rework_pending_idx"
  ON "QualityVerification"("rework_required", "rework_completed_at", "rework_escalated_at");
