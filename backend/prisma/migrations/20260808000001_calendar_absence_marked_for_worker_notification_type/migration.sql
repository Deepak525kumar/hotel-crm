-- Calendar absence drag/reason feature (2026-08-08).
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement that references the new value -- kept in its
-- own migration, matching every prior additive NotificationType migration
-- in this series (e.g. 20260730030000_add_hr_expiry_lapse_notification_types).
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_ABSENCE_MARKED_FOR_WORKER';
