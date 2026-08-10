-- OD-GEO-010 (SPEC-GEO-001 amendment, 2026-08-10): link WorkerGeoCheckin to
-- the Attendance shift it verified, when the check originated from
-- Attendance's own checkIn()/checkOut() flow. Nullable: the worker-facing
-- standalone "Verify Location" endpoint (GeoController.checkIn) has no
-- attendance record to attach to. Replaces the frontend's prior
-- worker_id+hotel_id+time-window heuristic with an exact FK.
--
-- onDelete: SetNull, not Cascade -- the geo audit trail (GDPR Tier 1,
-- 6-month retention sweep) must outlive the Attendance row's own lifecycle.

-- AlterTable
ALTER TABLE "WorkerGeoCheckin" ADD COLUMN "attendance_id" TEXT;

-- CreateIndex
CREATE INDEX "WorkerGeoCheckin_attendance_id_idx" ON "WorkerGeoCheckin"("attendance_id");

-- AddForeignKey
ALTER TABLE "WorkerGeoCheckin" ADD CONSTRAINT "WorkerGeoCheckin_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
