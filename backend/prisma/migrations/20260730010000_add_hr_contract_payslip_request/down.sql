-- Rollback: SPEC-HR-001 Contract/PayslipRequest migration
-- Drops both tables and both enums added by migration.sql.
-- Safe to run pre-launch (no production data).

DROP TABLE IF EXISTS "PayslipRequest";
DROP TABLE IF EXISTS "Contract";
DROP TYPE IF EXISTS "PayslipRequestStatus";
DROP TYPE IF EXISTS "ContractStatus";
