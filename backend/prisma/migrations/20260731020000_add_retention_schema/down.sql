-- Rollback: SPEC-RETENTION-001 retention-schema migration (PR 1 of 5).
-- Drops the tables and enum added by migration.sql.
-- Safe to run pre-launch (no production data).

DROP TABLE IF EXISTS "RetentionLog";
DROP TABLE IF EXISTS "RetentionAuditEntry";
DROP TABLE IF EXISTS "RetentionCategory";
DROP TYPE IF EXISTS "RetentionTier";
