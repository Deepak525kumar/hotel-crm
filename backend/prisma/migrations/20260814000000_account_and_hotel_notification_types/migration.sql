-- Add the enum values introduced alongside the account- and hotel-lifecycle
-- notifications. schema.prisma declared them but no migration created them, so
-- a migrated database rejected every write that used one:
--
--   ERROR: invalid input value for enum "NotificationType": "HOTEL_DEACTIVATED"
--
-- That was not a lost notification. crm/service.ts enqueues inside the same
-- $transaction as the status update, so deactivating or reactivating a hotel
-- that had a manager, regional manager or active workers failed outright with a
-- 400 and rolled the status change back. Only a hotel with nobody attached
-- appeared to work, because the notify loop never ran.
--
-- Postgres requires ALTER TYPE ... ADD VALUE for enum growth; Prisma does not
-- infer it from a schema edit. IF NOT EXISTS keeps this re-runnable against a
-- database where the values were added by hand.
--
-- Safe inside Prisma's per-migration transaction on PG 12+: the values are only
-- added here, never used, and the restriction is on USING a new value in the
-- transaction that added it.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_DEACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_REACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HOTEL_DEACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HOTEL_ACTIVATED';

ALTER TYPE "OutboxSourceModule" ADD VALUE IF NOT EXISTS 'CRM';
