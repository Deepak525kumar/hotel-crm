-- Paired rollback (repo convention: every migration ships a down.sql).
--
-- Columns drop cleanly. The enum does not: PostgreSQL has no
-- `ALTER TYPE ... DROP VALUE`, so removing the three added labels means
-- rebuilding the type -- the same approach as
-- 20260818130000_add_rework_notification_types.
--
-- The value list below is NOT retyped from memory. It was generated from the
-- live type, which is the only source that carries the real insertion order:
--
--   SELECT string_agg(quote_literal(e.enumlabel::text), ', '
--                     ORDER BY e.enumsortorder)
--     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--    WHERE t.typname = 'NotificationType';
--
-- Order matters more than it looks. A mis-ordered rebuild does not error --
-- it silently relabels existing Notification rows, corrupting the whole
-- notification history. If this list is ever edited by hand, regenerate it
-- with the query above instead.
--
-- Columns are dropped BEFORE the enum rebuild so that no dropped column can
-- still depend on the old type.

ALTER TABLE "WorkerOverallRating" DROP COLUMN IF EXISTS "warning_50_sent_at";
ALTER TABLE "WorkerOverallRating" DROP COLUMN IF EXISTS "warning_70_sent_at";

ALTER TABLE "Contract" DROP COLUMN IF EXISTS "contract_pdf_s3_key";
ALTER TABLE "Contract" DROP COLUMN IF EXISTS "last_worker_expiry_reminder_at";
ALTER TABLE "Contract" DROP COLUMN IF EXISTS "worker_expiry_reminder_count";

BEGIN;
  ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";

  CREATE TYPE "NotificationType" AS ENUM (
    'WORK_REQUEST_PUBLISHED', 'WORK_REQUEST_CANCELLED', 'WORK_REQUEST_EXPIRING_SOON',
    'APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_REJECTED',
    'APPLICATION_WITHDRAWN', 'ASSIGNMENT_CONFIRMED', 'ASSIGNMENT_CANCELLED',
    'SHIFT_REMINDER', 'CHECK_IN_REMINDER', 'ATTENDANCE_VERIFIED', 'WORKER_NO_SHOW',
    'QUALITY_VERIFICATION_SUBMITTED', 'RATING_RECEIVED', 'REWORK_REQUIRED',
    'CALENDAR_ABSENCE_MARKED', 'JOB_REQUEST_BROADCAST', 'JOB_REQUEST_CLOSED',
    'HR_PAYSLIP_REQUESTED', 'HR_PAYSLIP_FULFILLED', 'HR_CONTRACT_EXPIRY_REMINDER',
    'HR_PAYSLIP_REQUEST_ESCALATED', 'HR_CONTRACT_LAPSED', 'CONSENT_DECLINED',
    'CALENDAR_ABSENCE_MARKED_FOR_WORKER', 'REPEATED_FAILED_LOGINS', 'SYSTEM',
    'ONBOARDING_SUBMITTED', 'ONBOARDING_APPROVED', 'ONBOARDING_REJECTED',
    'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED', 'HOTEL_DEACTIVATED',
    'HOTEL_ACTIVATED', 'REWORK_COMPLETED', 'REWORK_OVERDUE'
  );

  -- Any row still carrying one of the three removed labels would fail this
  -- cast. That is deliberate: a loud failure beats silently rewriting a
  -- worker's notification history to a different type.
  ALTER TABLE "Notification"
    ALTER COLUMN "type" TYPE "NotificationType"
    USING ("type"::text::"NotificationType");

  DROP TYPE "NotificationType_old";
COMMIT;
