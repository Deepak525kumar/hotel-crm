-- HR implementation PR 5 (IF-HR-ContractExpiryReminder, ADR-040/041/045).
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement that references the new value -- this
-- migration does nothing else and is intentionally not reversible (matches
-- every prior additive NotificationType migration in this series).
ALTER TYPE "NotificationType" ADD VALUE 'HR_CONTRACT_EXPIRY_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'HR_PAYSLIP_REQUEST_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'HR_CONTRACT_LAPSED';
