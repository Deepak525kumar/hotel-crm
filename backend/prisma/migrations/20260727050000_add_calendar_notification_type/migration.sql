-- RULE-CAL-06: manager notification on a sick/vacation mark.
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement that references the new value -- this
-- migration does nothing else and is intentionally not reversible (matches
-- the 20260726000000_add_regional_manager_role precedent).
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_ABSENCE_MARKED';
ALTER TYPE "OutboxSourceModule" ADD VALUE 'CALENDAR';
