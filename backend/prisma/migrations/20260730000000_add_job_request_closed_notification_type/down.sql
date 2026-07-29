-- Down migration for 20260730000000_add_job_request_closed_notification_type
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without the new value, which is only safe if no row
-- uses it. Verify no Notification.type = 'JOB_REQUEST_CLOSED' rows exist
-- before running this.
BEGIN;

  ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
  CREATE TYPE "NotificationType" AS ENUM (
    'WORK_REQUEST_PUBLISHED', 'WORK_REQUEST_CANCELLED', 'WORK_REQUEST_EXPIRING_SOON',
    'APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_REJECTED', 'APPLICATION_WITHDRAWN',
    'ASSIGNMENT_CONFIRMED', 'ASSIGNMENT_CANCELLED', 'SHIFT_REMINDER', 'CHECK_IN_REMINDER',
    'ATTENDANCE_VERIFIED', 'WORKER_NO_SHOW',
    'QUALITY_VERIFICATION_SUBMITTED', 'RATING_RECEIVED', 'REWORK_REQUIRED',
    'CALENDAR_ABSENCE_MARKED', 'JOB_REQUEST_BROADCAST'
  );
  ALTER TABLE "Notification"
    ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
  DROP TYPE "NotificationType_old";

COMMIT;
