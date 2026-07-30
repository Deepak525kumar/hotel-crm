-- Down migration for 20260731010000_add_consent_notification_type
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating each type without the new value, which is only safe if no row
-- uses it. Verify no Notification.type = 'CONSENT_DECLINED' and no
-- OutboxEvent.source_module = 'CONSENT' rows exist before running this.
BEGIN;

  ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
  CREATE TYPE "NotificationType" AS ENUM (
    'WORK_REQUEST_PUBLISHED', 'WORK_REQUEST_CANCELLED', 'WORK_REQUEST_EXPIRING_SOON',
    'APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_REJECTED', 'APPLICATION_WITHDRAWN',
    'ASSIGNMENT_CONFIRMED', 'ASSIGNMENT_CANCELLED', 'SHIFT_REMINDER', 'CHECK_IN_REMINDER',
    'ATTENDANCE_VERIFIED', 'WORKER_NO_SHOW',
    'QUALITY_VERIFICATION_SUBMITTED', 'RATING_RECEIVED', 'REWORK_REQUIRED',
    'CALENDAR_ABSENCE_MARKED', 'JOB_REQUEST_BROADCAST', 'JOB_REQUEST_CLOSED',
    'HR_PAYSLIP_REQUESTED', 'HR_PAYSLIP_FULFILLED',
    'HR_CONTRACT_EXPIRY_REMINDER', 'HR_PAYSLIP_REQUEST_ESCALATED', 'HR_CONTRACT_LAPSED'
  );
  ALTER TABLE "Notification"
    ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
  DROP TYPE "NotificationType_old";

  ALTER TYPE "OutboxSourceModule" RENAME TO "OutboxSourceModule_old";
  CREATE TYPE "OutboxSourceModule" AS ENUM (
    'WORK_REQUESTS', 'WORK_APPLICATIONS', 'ATTENDANCE', 'QUALITY', 'CALENDAR', 'DOCUMENTS', 'HR'
  );
  ALTER TABLE "OutboxEvent"
    ALTER COLUMN "source_module" TYPE "OutboxSourceModule" USING ("source_module"::text::"OutboxSourceModule");
  DROP TYPE "OutboxSourceModule_old";

COMMIT;
