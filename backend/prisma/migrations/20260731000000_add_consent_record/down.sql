-- Rollback: SPEC-CONSENT-001 ConsentRecord migration
-- Drops the table and enum added by migration.sql.
-- Safe to run pre-launch (no production data).

DROP TABLE IF EXISTS "ConsentRecord";
DROP TYPE IF EXISTS "ConsentDecision";
