-- Epic 9 PR 9.5 (TREQ-001/TRULE-001, MIG-GAP-03): adds the CalendarEntry
-- table (manager calendar direct-assignment, no accept step) and relaxes
-- WorkerAssignment.work_request_id from mandatory to nullable in the same
-- migration.
--
-- Repository-reality correction (see IMPLEMENTATION_EXECUTION_PLAN.md's PR
-- 9.5 section, 2026-07-29 architecture review): a calendar-placed assignment
-- (placeOnCalendar(), assignments/service.ts) has no backing JobRequest at
-- all -- job_request_id (added nullable by PR 9.3, migration
-- 20260729010000) is the correct FK to leave populated for a future
-- broadcast-accept row (PR 9.9); work_request_id has no legitimate value to
-- write for a calendar placement. This mirrors PR 9.3's own
-- migration-sequencing reasoning ("avoid a transient assignment-creation-
-- invariant state"), extended here to work_request_id's parallel
-- disposition, which no prior PR in this plan addressed. No ADR change --
-- ADR-056 already ratifies "no intermediating application or acceptance
-- record required" for calendar placement; this is a plan/spec-clarity
-- correction, not a new architecture decision.
--
-- Relaxing work_request_id is additive, reversible, and zero-data-loss:
-- every existing row keeps its current non-null value: only the NOT NULL
-- constraint on the column is dropped. No backfill, no default, no other
-- column touched. The existing FK constraint (WorkerAssignment_work_request_
-- id_fkey, ON DELETE CASCADE, from 20260613120000_v2_marketplace_init) and
-- index (WorkerAssignment_work_request_id_idx) are unaffected -- Postgres
-- allows a nullable FK column with a CASCADE delete rule; a NULL value on
-- the referencing column is simply exempt from the FK check, standard SQL
-- semantics.
ALTER TABLE "WorkerAssignment" ALTER COLUMN "work_request_id" DROP NOT NULL;

-- CreateTable: CalendarEntry (schema.prisma model comment has the full
-- design rationale -- owned by backend-assignments per ADR-021, explicitly
-- NOT overlapping Calendar's own CalendarAbsence/state-calendar-absence
-- model). 1:1 with WorkerAssignment via assignment_id, created in the same
-- transaction by placeOnCalendar().
CREATE TABLE "CalendarEntry" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "placed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarEntry_assignment_id_key" ON "CalendarEntry"("assignment_id");

-- TRULE-001/TRULE-006 groundwork: one CalendarEntry per worker per day. This
-- guards only this PR's own creation path (placeOnCalendar()) against a
-- duplicate calendar placement -- it does NOT yet enforce daily exclusivity
-- against a competing broadcast-accept WorkerAssignment created via a
-- different path; that full DB-level enforcement (re-keyed partial unique
-- index spanning both creation paths) is PR 9.6's scope.
CREATE UNIQUE INDEX "CalendarEntry_worker_id_day_key" ON "CalendarEntry"("worker_id", "day");

CREATE INDEX "CalendarEntry_worker_id_idx" ON "CalendarEntry"("worker_id");
CREATE INDEX "CalendarEntry_hotel_id_idx" ON "CalendarEntry"("hotel_id");
CREATE INDEX "CalendarEntry_day_idx" ON "CalendarEntry"("day");

ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "WorkerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_placed_by_id_fkey"
  FOREIGN KEY ("placed_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
