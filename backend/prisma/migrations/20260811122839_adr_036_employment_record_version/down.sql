BEGIN;

ALTER TABLE "WorkerDocument" DROP CONSTRAINT IF EXISTS "WorkerDocument_uploaded_by_id_fkey";
ALTER TABLE "WorkerDocument" ADD CONSTRAINT "WorkerDocument_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentTemplateField" DROP COLUMN IF EXISTS "signer_role";
ALTER TABLE "EmploymentRecord" DROP COLUMN IF EXISTS "version";

CREATE INDEX IF NOT EXISTS "CalendarAbsence_marked_by_id_idx" ON "CalendarAbsence"("marked_by_id");
CREATE INDEX IF NOT EXISTS "WorkerAssignment_skill_slot_id_idx" ON "WorkerAssignment"("skill_slot_id");

-- Recreate dropped backup tables so earlier migrations can roll back without errors
CREATE TABLE IF NOT EXISTS "_User_permissions_backup_20260727" (
    "user_id" TEXT,
    "role" TEXT,
    "permissions" TEXT[],
    "snapshotted_at" TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS "_WorkApplication_backup_20260729" (
    "id" TEXT,
    "work_request_id" TEXT,
    "worker_id" TEXT,
    "reviewed_by_id" TEXT,
    "status" TEXT,
    "cover_note" TEXT,
    "worker_rating_snapshot" DOUBLE PRECISION,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "applied_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "worker_assignment_id" TEXT,
    "snapshotted_at" TIMESTAMP(3)
);

-- NotificationType Rollback
DELETE FROM "Notification" WHERE "type" = 'SYSTEM';
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'WORK_REQUEST_PUBLISHED', 'WORK_REQUEST_CANCELLED', 'WORK_REQUEST_EXPIRING_SOON',
  'APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_REJECTED', 'APPLICATION_WITHDRAWN',
  'ASSIGNMENT_CONFIRMED', 'ASSIGNMENT_CANCELLED', 'SHIFT_REMINDER',
  'CHECK_IN_REMINDER',
  'ATTENDANCE_VERIFIED', 'WORKER_NO_SHOW',
  'QUALITY_VERIFICATION_SUBMITTED', 'RATING_RECEIVED', 'REWORK_REQUIRED',
  'CALENDAR_ABSENCE_MARKED',
  'JOB_REQUEST_BROADCAST', 'JOB_REQUEST_CLOSED',
  'HR_PAYSLIP_REQUESTED', 'HR_PAYSLIP_FULFILLED',
  'HR_CONTRACT_EXPIRY_REMINDER', 'HR_PAYSLIP_REQUEST_ESCALATED', 'HR_CONTRACT_LAPSED',
  'CONSENT_DECLINED',
  'CALENDAR_ABSENCE_MARKED_FOR_WORKER',
  'REPEATED_FAILED_LOGINS'
);
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";

-- OutboxSourceModule Rollback
DELETE FROM "OutboxEvent" WHERE "source_module" IN ('DOCUMENTS', 'AUTH');
ALTER TYPE "OutboxSourceModule" RENAME TO "OutboxSourceModule_old";
CREATE TYPE "OutboxSourceModule" AS ENUM (
  'WORK_REQUESTS', 'WORK_APPLICATIONS', 'ATTENDANCE', 'QUALITY', 'CALENDAR',
  'HR', 'CONSENT', 'ASSIGNMENTS'
);
ALTER TABLE "OutboxEvent" ALTER COLUMN "source_module" TYPE "OutboxSourceModule" USING ("source_module"::text::"OutboxSourceModule");
DROP TYPE "OutboxSourceModule_old";

COMMIT;
