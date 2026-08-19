-- ADR-069 / CRR §14: the rework loop needs two notification types that did not
-- exist. REWORK_REQUIRED already covered checker -> worker; these cover the
-- return leg (worker -> checker on completion) and the 20-minute escalation
-- (-> manager AND checker, both, per CRR §14).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REWORK_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REWORK_OVERDUE';
