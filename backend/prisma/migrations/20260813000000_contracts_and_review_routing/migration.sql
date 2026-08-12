BEGIN;

-- 2026-08-13 feature batch:
--   1. Contract feature replaces the Document Templates / Document Instances
--      module (product decision, owner-confirmed: templates are removed
--      entirely rather than hidden — this repo has no template/instance
--      rows in any environment that matters yet).
--   2. EmploymentType (FULL_TIME/PART_TIME) becomes a mandatory field on
--      both EmploymentRecord (set by the creating actor) and Contract
--      (copied from the record at contract-generation time).
--   3. EmploymentRecord.created_by_id records who created the application,
--      so the review queue can route to that creator's own superior
--      instead of admin/scope-only routing.

-- ---------------------------------------------------------------------------
-- Drop Document Templates / Document Instances module (fully removed, not
-- hidden -- see EmploymentRecord/Contract feature above for the reason).
-- ---------------------------------------------------------------------------

ALTER TABLE "DocumentInstance" DROP CONSTRAINT IF EXISTS "DocumentInstance_created_by_id_fkey";
ALTER TABLE "DocumentInstance" DROP CONSTRAINT IF EXISTS "DocumentInstance_final_document_id_fkey";
ALTER TABLE "DocumentInstance" DROP CONSTRAINT IF EXISTS "DocumentInstance_template_id_fkey";
ALTER TABLE "DocumentInstance" DROP CONSTRAINT IF EXISTS "DocumentInstance_worker_id_fkey";
ALTER TABLE "DocumentInstanceFieldValue" DROP CONSTRAINT IF EXISTS "DocumentInstanceFieldValue_field_id_fkey";
ALTER TABLE "DocumentInstanceFieldValue" DROP CONSTRAINT IF EXISTS "DocumentInstanceFieldValue_instance_id_fkey";
ALTER TABLE "DocumentInstanceFieldValue" DROP CONSTRAINT IF EXISTS "DocumentInstanceFieldValue_updated_by_id_fkey";
ALTER TABLE "DocumentInstanceSignature" DROP CONSTRAINT IF EXISTS "DocumentInstanceSignature_instance_id_fkey";
ALTER TABLE "DocumentInstanceSignature" DROP CONSTRAINT IF EXISTS "DocumentInstanceSignature_signature_block_id_fkey";
ALTER TABLE "DocumentInstanceSignature" DROP CONSTRAINT IF EXISTS "DocumentInstanceSignature_signed_by_id_fkey";
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT IF EXISTS "DocumentTemplate_created_by_id_fkey";
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT IF EXISTS "DocumentTemplate_parent_template_id_fkey";
ALTER TABLE "DocumentTemplateField" DROP CONSTRAINT IF EXISTS "DocumentTemplateField_section_id_fkey";
ALTER TABLE "DocumentTemplateSection" DROP CONSTRAINT IF EXISTS "DocumentTemplateSection_template_id_fkey";
ALTER TABLE "DocumentTemplateSignatureBlock" DROP CONSTRAINT IF EXISTS "DocumentTemplateSignatureBlock_section_id_fkey";

DROP TABLE IF EXISTS "DocumentInstanceSignature";
DROP TABLE IF EXISTS "DocumentInstanceFieldValue";
DROP TABLE IF EXISTS "DocumentInstance";
DROP TABLE IF EXISTS "DocumentTemplateSignatureBlock";
DROP TABLE IF EXISTS "DocumentTemplateField";
DROP TABLE IF EXISTS "DocumentTemplateSection";
DROP TABLE IF EXISTS "DocumentTemplate";

DROP TYPE IF EXISTS "DocumentInstanceStatus";
DROP TYPE IF EXISTS "DocumentTemplateFieldType";
DROP TYPE IF EXISTS "DocumentTemplateStatus";
DROP TYPE IF EXISTS "SignerRole";

-- ---------------------------------------------------------------------------
-- EmploymentType + EmploymentRecord/Contract columns
-- ---------------------------------------------------------------------------

CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME');

-- Nullable first so existing rows can be backfilled, then made NOT NULL.
-- Backfill default of FULL_TIME is a documented assumption for pre-existing
-- data only (no prior application recorded this distinction); it has no
-- bearing on new applications, which require the caller to choose.
ALTER TABLE "EmploymentRecord" ADD COLUMN "employment_type" "EmploymentType";
UPDATE "EmploymentRecord" SET "employment_type" = 'FULL_TIME' WHERE "employment_type" IS NULL;
ALTER TABLE "EmploymentRecord" ALTER COLUMN "employment_type" SET NOT NULL;

ALTER TABLE "EmploymentRecord" ADD COLUMN "created_by_id" TEXT;
CREATE INDEX "EmploymentRecord_created_by_id_idx" ON "EmploymentRecord"("created_by_id");
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Contract" ADD COLUMN "employment_type" "EmploymentType";
UPDATE "Contract" c SET "employment_type" = COALESCE(
  (SELECT er."employment_type" FROM "EmploymentRecord" er WHERE er."user_id" = c."worker_id"),
  'FULL_TIME'
) WHERE c."employment_type" IS NULL;
ALTER TABLE "Contract" ALTER COLUMN "employment_type" SET NOT NULL;

COMMIT;
