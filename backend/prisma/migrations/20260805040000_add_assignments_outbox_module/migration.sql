-- Job-dispatch lifecycle feature (2026-08-05): assignment lifecycle
-- notifications (cancel, move, reassign). ASSIGNMENT_CONFIRMED/
-- ASSIGNMENT_CANCELLED already existed in NotificationType but were never
-- enqueued anywhere; this is their module tag, distinct from WORK_REQUESTS
-- (which the JobRequest-lifecycle notifications file under).
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement that references the new value -- this
-- migration does nothing else and is intentionally not reversible (matches
-- 20260727050000_add_calendar_notification_type's precedent).
ALTER TYPE "OutboxSourceModule" ADD VALUE 'ASSIGNMENTS';
