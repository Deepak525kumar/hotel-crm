-- Add shift_reminder_sent_at to WorkerAssignment.
-- Records the timestamp when a shift-start reminder was dispatched so that
-- the sweep job (sweepShiftReminders) can use it as a "already notified"
-- gate and avoid sending duplicate reminders.
-- Nullable: NULL means no reminder has been sent yet.
-- Additive, backwards-compatible, zero data loss.
ALTER TABLE "WorkerAssignment" ADD COLUMN "shift_reminder_sent_at" TIMESTAMP(3);
