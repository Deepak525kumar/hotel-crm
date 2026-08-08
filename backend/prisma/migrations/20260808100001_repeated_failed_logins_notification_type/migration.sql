-- SPEC-AUTH-001 TREQ-AUTH-007 (2026-08-08).
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement referencing the new value -- kept in its own
-- migration, matching every prior additive NotificationType migration.
ALTER TYPE "NotificationType" ADD VALUE 'REPEATED_FAILED_LOGINS';
