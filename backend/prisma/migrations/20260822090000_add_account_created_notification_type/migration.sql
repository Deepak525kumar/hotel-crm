-- Adds ACCOUNT_CREATED to NotificationType, for the welcome-email-on-account-
-- creation feature (backend/src/modules/users/service.ts createUser()).
--
-- IF NOT EXISTS: without it, the migration harness's rollback-then-reapply
-- cycle fails with 42710 "enum label already exists" -- down.sql cannot
-- remove an enum label without a full type rebuild, so re-applying this
-- migration after a rollback hits a label that's still there. Learned the
-- hard way in 20260820090000_add_quality_warnings_and_contract_expiry_reminders.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_CREATED';

-- Adds USERS to OutboxSourceModule, tagging createUser()'s welcome-email
-- notification as its own producer module (matches the existing convention:
-- ASSIGNMENTS and EMPLOYEE_MANAGEMENT are likewise each their own module's
-- tag, not folded into a nearby one). Same IF NOT EXISTS reasoning as above.
ALTER TYPE "OutboxSourceModule" ADD VALUE IF NOT EXISTS 'USERS';
