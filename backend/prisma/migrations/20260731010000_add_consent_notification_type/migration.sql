-- Consent implementation (SPEC-CONSENT-001 REQ-CONSENT-003/RULE-CONSENT-03,
-- ADR-015/ADR-037). Postgres requires ALTER TYPE ... ADD VALUE to run in its
-- own transaction, separate from any statement that references the new
-- value -- this migration does nothing else and is intentionally not
-- reversible (matches every prior additive NotificationType migration in
-- this series).
ALTER TYPE "NotificationType" ADD VALUE 'CONSENT_DECLINED';
ALTER TYPE "OutboxSourceModule" ADD VALUE 'CONSENT';
