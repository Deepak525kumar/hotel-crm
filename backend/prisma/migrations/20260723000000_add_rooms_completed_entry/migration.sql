-- ADR-028 (2026-07-22, OQ-ANALYTICS-03): "rooms completed per worker" is retained
-- as a basic-analytics metric (REQ-ANALYTICS-013) but redefined without a room-level
-- task layer, per CONFIRMED_REQUIREMENTS_REGISTER.md §33 ("Task"/"Work Request" do
-- NOT need separating; full-day employment model). This is a manager-entered daily
-- count captured 1-to-1 against the worker's full-day WorkerAssignment — NOT a
-- per-task/per-room record, and NOT added to ReceptionData (out of scope for that
-- model per its own definition, PIVOT §9.3). Additive only: new table, no existing
-- column/constraint touched.

-- CreateTable
CREATE TABLE "RoomsCompletedEntry" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "entered_by_id" TEXT NOT NULL,
    "rooms_completed" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomsCompletedEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomsCompletedEntry_assignment_id_key" ON "RoomsCompletedEntry"("assignment_id");

-- CreateIndex
CREATE INDEX "RoomsCompletedEntry_hotel_id_idx" ON "RoomsCompletedEntry"("hotel_id");

-- CreateIndex
CREATE INDEX "RoomsCompletedEntry_worker_id_idx" ON "RoomsCompletedEntry"("worker_id");

-- CreateIndex
CREATE INDEX "RoomsCompletedEntry_entered_by_id_idx" ON "RoomsCompletedEntry"("entered_by_id");

-- CreateIndex
CREATE INDEX "RoomsCompletedEntry_created_at_idx" ON "RoomsCompletedEntry"("created_at");

-- AddForeignKey
ALTER TABLE "RoomsCompletedEntry" ADD CONSTRAINT "RoomsCompletedEntry_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "WorkerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomsCompletedEntry" ADD CONSTRAINT "RoomsCompletedEntry_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomsCompletedEntry" ADD CONSTRAINT "RoomsCompletedEntry_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomsCompletedEntry" ADD CONSTRAINT "RoomsCompletedEntry_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint (not expressible via `prisma migrate diff`, added by hand — mirrors
-- the Rating_score_range / WorkRequest slot-fill CHECK precedent in
-- 20260613120000_v2_marketplace_init/migration.sql:560-576)
ALTER TABLE "RoomsCompletedEntry"
  ADD CONSTRAINT "RoomsCompletedEntry_rooms_completed_nonneg"
  CHECK ("rooms_completed" >= 0);
