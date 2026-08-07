-- Calendar absence drag/reason feature (2026-08-08).
--
-- Adds CalendarAbsence.reason: nullable text, enforced MANDATORY only for
-- VACATION at the Zod schema layer (backend/src/modules/calendar/types.ts),
-- left optional for SICK. A SICK reason is deliberately NOT made mandatory
-- here or at the DB level: forcing detail on a sick day risks capturing
-- health data (GDPR special-category), which is exactly what this model's
-- existing "no health data" design (CRR §27 §353, see the model's own
-- comment in schema.prisma) was built to avoid.
--
-- Adds CalendarAbsence.marked_by_id: who performed the mark/move action
-- (worker self-service, or a manager acting on the worker's behalf --
-- both now supported). Distinct from worker_id, whose absence it is.
-- Nullable/SET NULL, mirroring WorkerAssignment.assigned_by_id and
-- CalendarEntry.placed_by_id's identical shape -- an actor account being
-- later deleted must not cascade-delete the absence record itself.
--
-- Additive-nullable-column pattern (matches the repo's existing migrations,
-- e.g. 20260807000000_employment_primary_hotel): no backfill needed since
-- both columns start NULL for every existing row.

ALTER TABLE "CalendarAbsence" ADD COLUMN "reason" TEXT;
ALTER TABLE "CalendarAbsence" ADD COLUMN "marked_by_id" TEXT;

ALTER TABLE "CalendarAbsence"
  ADD CONSTRAINT "CalendarAbsence_marked_by_id_fkey"
  FOREIGN KEY ("marked_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CalendarAbsence_marked_by_id_idx" ON "CalendarAbsence"("marked_by_id");
