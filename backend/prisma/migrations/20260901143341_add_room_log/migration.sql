-- RoomLog: the worker's own room-by-room record of what they cleaned on a
-- shift (owner decision, 2026-09-01).
--
-- Fills the gap where a worker had no way to record WHICH rooms they did:
-- RoomsCompletedEntry is a manager-entered count, and
-- QualityVerification.room_number is free text typed by a checker during an
-- inspection. The checker's room picker is derived from these rows.
--
-- Additive only: no existing table is altered, no data is moved, and every
-- pre-existing QualityVerification simply has no RoomLog attached.

CREATE TABLE "RoomLog" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "room_number" TEXT NOT NULL,
    "room_key" TEXT NOT NULL,
    "verification_id" TEXT,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomLog_pkey" PRIMARY KEY ("id")
);

-- The hard block: one log per room per hotel per calendar day, across ALL
-- workers. The second worker to claim room 412 is refused at the database,
-- not merely in the service layer -- two concurrent claims must not both
-- succeed.
CREATE UNIQUE INDEX "RoomLog_hotel_id_day_room_key_key" ON "RoomLog"("hotel_id", "day", "room_key");

-- One inspection covers at most one logged room.
CREATE UNIQUE INDEX "RoomLog_verification_id_key" ON "RoomLog"("verification_id");

CREATE INDEX "RoomLog_assignment_id_idx" ON "RoomLog"("assignment_id");
-- The worker's own room tab: "my rooms, this day".
CREATE INDEX "RoomLog_worker_id_day_idx" ON "RoomLog"("worker_id", "day");
-- The checker's room picker and the manager's live view: "this hotel, today".
CREATE INDEX "RoomLog_hotel_id_day_idx" ON "RoomLog"("hotel_id", "day");

ALTER TABLE "RoomLog" ADD CONSTRAINT "RoomLog_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "WorkerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomLog" ADD CONSTRAINT "RoomLog_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomLog" ADD CONSTRAINT "RoomLog_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: deleting an inspection must not delete the worker's
-- record that they cleaned the room -- it returns the room to "awaiting
-- check", which is exactly what happened.
ALTER TABLE "RoomLog" ADD CONSTRAINT "RoomLog_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "QualityVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
