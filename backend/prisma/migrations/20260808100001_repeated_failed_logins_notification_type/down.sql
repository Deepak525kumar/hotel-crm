-- Down migration for 20260808100001_repeated_failed_logins_notification_type
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without the new value, which is only safe if no row
-- uses it. Verify no Notification.type = 'REPEATED_FAILED_LOGINS' rows exist
-- before running this.
BEGIN;

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
    -- Appended last, not grouped near CALENDAR_ABSENCE_MARKED: Postgres's
    -- plain `ALTER TYPE ... ADD VALUE` (no BEFORE/AFTER) always appends to
    -- the end of the enum's CURRENT value list, so this migration's own
    -- ADD VALUE (20260808000001, which runs after 20260731's CONSENT_DECLINED
    -- migration) put it here, not next to the semantically related
    -- CALENDAR_ABSENCE_MARKED. Enum member order in Postgres is insertion
    -- order, not declaration/grouping order -- this list must mirror that
    -- exactly or the harness's rollback+recovery diff fails.
    'CALENDAR_ABSENCE_MARKED_FOR_WORKER'
  );
  ALTER TABLE "Notification"
    ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
  DROP TYPE "NotificationType_old";

COMMIT;
