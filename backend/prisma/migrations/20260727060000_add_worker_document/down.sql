-- Rollback: SPEC-DOCUMENTS-001 WorkerDocument migration
-- Drops the table and enum added by migration.sql.
-- Safe to run pre-launch (no production data).

DROP TABLE IF EXISTS "WorkerDocument";
DROP TYPE IF EXISTS "DocumentCategory";
