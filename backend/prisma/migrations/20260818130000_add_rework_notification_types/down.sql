-- Down migration for 20260818130000_add_rework_notification_types
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without the new values, which is only safe if no row
-- uses them. Verify no Notification.type IN ('REWORK_COMPLETED',
-- 'REWORK_OVERDUE') rows exist before running this.
--
-- The value list below is INSERTION order, not declaration order: Postgres's
-- plain `ALTER TYPE ... ADD VALUE` always appends to the end of the current
-- list, so every value added by a later migration sits after the ones added
-- before it, regardless of how schema.prisma groups them. This list must
-- mirror that exactly or the harness's rollback+recovery diff fails. It is
-- the list from 20260808100001's own down.sql, plus every NotificationType
-- value added since, in migration order:
--   REPEATED_FAILED_LOGINS      (20260808100001)
--   SYSTEM                      (20260811122839)
--   ONBOARDING_*                (20260813020000)
--   ACCOUNT_* / HOTEL_*         (20260814000000)
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
    'CALENDAR_ABSENCE_MARKED_FOR_WORKER',
    'REPEATED_FAILED_LOGINS',
    'SYSTEM',
    'ONBOARDING_SUBMITTED', 'ONBOARDING_APPROVED', 'ONBOARDING_REJECTED',
    'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED',
    'HOTEL_DEACTIVATED', 'HOTEL_ACTIVATED'
  );
  ALTER TABLE "Notification"
    ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::text::"NotificationType");
  DROP TYPE "NotificationType_old";

COMMIT;
