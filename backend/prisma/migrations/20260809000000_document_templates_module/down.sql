-- Rollback: Document Templates module (2026-08-09). Drops the tables and
-- enums added by migration.sql, in reverse dependency order (leaf tables
-- first). Safe: this is the module's first migration, no production data
-- exists for any of these tables yet.

DROP TABLE IF EXISTS "DocumentInstanceSignature";
DROP TABLE IF EXISTS "DocumentInstanceFieldValue";
DROP TABLE IF EXISTS "DocumentInstance";
DROP TABLE IF EXISTS "DocumentTemplateSignatureBlock";
DROP TABLE IF EXISTS "DocumentTemplateField";
DROP TABLE IF EXISTS "DocumentTemplateSection";
DROP TABLE IF EXISTS "DocumentTemplate";

DROP TYPE IF EXISTS "SignerRole";
DROP TYPE IF EXISTS "DocumentInstanceStatus";
DROP TYPE IF EXISTS "DocumentTemplateStatus";
DROP TYPE IF EXISTS "DocumentTemplateFieldType";
