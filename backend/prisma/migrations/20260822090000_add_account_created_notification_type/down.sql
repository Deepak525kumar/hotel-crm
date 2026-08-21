-- Paired rollback (repo convention). Rebuilds the enum without
-- ACCOUNT_CREATED -- PostgreSQL has no ALTER TYPE ... DROP VALUE.
--
-- Value list generated from the live type (pg_enum ordered by
-- enumsortorder), NOT retyped by hand -- a mis-ordered rebuild doesn't
-- error, it silently relabels every existing Notification row. Regenerate
-- with:
--   SELECT string_agg(quote_literal(e.enumlabel::text), ', '
--                     ORDER BY e.enumsortorder)
--     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--    WHERE t.typname = 'NotificationType';
-- if this ever needs hand-editing.

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
    'HOTEL_ACTIVATED', 'REWORK_COMPLETED', 'REWORK_OVERDUE',
    'QUALITY_RATING_WARNING_70', 'QUALITY_RATING_WARNING_50',
    'HR_CONTRACT_EXPIRY_WORKER_REMINDER'
  );

  -- Loud failure beats silent corruption: any row still carrying
  -- ACCOUNT_CREATED fails this cast rather than being rewritten to something
  -- else.
  ALTER TABLE "Notification"
    ALTER COLUMN "type" TYPE "NotificationType"
    USING ("type"::text::"NotificationType");

  DROP TYPE "NotificationType_old";
COMMIT;

-- Same rebuild for OutboxSourceModule (column: OutboxEvent.source_module),
-- same reasoning, same regeneration query with typname = 'OutboxSourceModule'.
BEGIN;
  ALTER TYPE "OutboxSourceModule" RENAME TO "OutboxSourceModule_old";

  CREATE TYPE "OutboxSourceModule" AS ENUM (
    'WORK_REQUESTS', 'WORK_APPLICATIONS', 'ATTENDANCE', 'QUALITY', 'CALENDAR',
    'HR', 'CONSENT', 'ASSIGNMENTS', 'DOCUMENTS', 'AUTH', 'EMPLOYEE_MANAGEMENT',
    'CRM'
  );

  ALTER TABLE "OutboxEvent"
    ALTER COLUMN "source_module" TYPE "OutboxSourceModule"
    USING ("source_module"::text::"OutboxSourceModule");

  DROP TYPE "OutboxSourceModule_old";
COMMIT;
