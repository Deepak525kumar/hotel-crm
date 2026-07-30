-- HR implementation PR 4 (SPEC-HR-001 EVT-HR-PayslipRequested/Fulfilled).
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement that references the new value -- this
-- migration does nothing else and is intentionally not reversible (matches
-- the 20260726000000_add_regional_manager_role /
-- 20260727050000_add_calendar_notification_type /
-- 20260729050000_add_job_request_broadcast_notification_type /
-- 20260730000000_add_job_request_closed_notification_type precedent).
ALTER TYPE "NotificationType" ADD VALUE 'HR_PAYSLIP_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'HR_PAYSLIP_FULFILLED';
ALTER TYPE "OutboxSourceModule" ADD VALUE 'HR';
