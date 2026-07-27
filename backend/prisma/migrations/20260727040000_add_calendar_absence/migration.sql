-- SPEC-CALENDAR-001 REQ-CAL-T08 (narrow ADR-021 slice): Calendar-owned
-- state-calendar-absence. Additive, reversible.
CREATE TYPE "CalendarAbsenceKind" AS ENUM ('SICK', 'VACATION');

CREATE TABLE "CalendarAbsence" (
  "id" TEXT NOT NULL,
  "worker_id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "kind" "CalendarAbsenceKind" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CalendarAbsence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarAbsence_worker_id_day_key" ON "CalendarAbsence"("worker_id", "day");
CREATE INDEX "CalendarAbsence_worker_id_idx" ON "CalendarAbsence"("worker_id");
CREATE INDEX "CalendarAbsence_day_idx" ON "CalendarAbsence"("day");

ALTER TABLE "CalendarAbsence" ADD CONSTRAINT "CalendarAbsence_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
