-- Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): notify the raising
-- manager when an unfilled broadcast JobRequest closes (6h auto-close or
-- manual close). Postgres requires ALTER TYPE ... ADD VALUE to run in its
-- own transaction, separate from any statement that references the new
-- value -- this migration does nothing else and is intentionally not
-- reversible (matches the 20260726000000_add_regional_manager_role /
-- 20260727050000_add_calendar_notification_type /
-- 20260729050000_add_job_request_broadcast_notification_type precedent).
ALTER TYPE "NotificationType" ADD VALUE 'JOB_REQUEST_CLOSED';
