-- Job-dispatch lifecycle audit fix (2026-08-05): WorkerAssignment.skill_slot_id.
--
-- Records exactly which JobRequestSkillSlot a broadcast-accept assignment
-- claimed (acceptBroadcast()). A multi-skill broadcast (e.g. "2 Cleaners + 1
-- Waiter") has several JobRequestSkillSlot rows on the same job_request_id;
-- without this column, cancelling such an assignment cannot determine which
-- slot's confirmed_count to decrement when the worker holds more than one
-- of the requested skills.
--
-- Purely additive: nullable, no backfill. Historical rows never recorded
-- which slot they claimed, and that information cannot be reconstructed
-- after the fact (a worker holding 2+ matching skills on the same broadcast
-- is genuinely ambiguous in retrospect) -- they stay NULL permanently.
-- acceptBroadcast() populates this going forward; every other creation path
-- (placeOnCalendar, calendar move) has no skill slot to reference and also
-- leaves it NULL.

ALTER TABLE "WorkerAssignment" ADD COLUMN "skill_slot_id" TEXT;

ALTER TABLE "WorkerAssignment"
  ADD CONSTRAINT "WorkerAssignment_skill_slot_id_fkey"
  FOREIGN KEY ("skill_slot_id") REFERENCES "JobRequestSkillSlot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkerAssignment_skill_slot_id_idx" ON "WorkerAssignment"("skill_slot_id");
