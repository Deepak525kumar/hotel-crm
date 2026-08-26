-- Adds USER_EMAIL_CHANGED to NotificationType, for the admin/regional-manager
-- email-change flow (backend/src/modules/users/service.ts updateUserEmail()).
-- The change is notified to the affected user, their direct manager, and the
-- regional managers whose scope they sit in.
--
-- IF NOT EXISTS: down.sql cannot remove an enum label without a full type
-- rebuild, so the migration harness's rollback-then-reapply cycle would
-- otherwise fail with 42710 "enum label already exists" -- the same lesson
-- recorded in 20260822090000_add_account_created_notification_type.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'USER_EMAIL_CHANGED';
