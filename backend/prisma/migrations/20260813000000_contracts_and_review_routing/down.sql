BEGIN;

-- Revert EmploymentType / created_by_id additions.
ALTER TABLE "Contract" DROP COLUMN IF EXISTS "employment_type";

ALTER TABLE "EmploymentRecord" DROP CONSTRAINT IF EXISTS "EmploymentRecord_created_by_id_fkey";
DROP INDEX IF EXISTS "EmploymentRecord_created_by_id_idx";
ALTER TABLE "EmploymentRecord" DROP COLUMN IF EXISTS "created_by_id";
ALTER TABLE "EmploymentRecord" DROP COLUMN IF EXISTS "employment_type";

DROP TYPE IF EXISTS "EmploymentType";

-- Recreate Document Templates / Document Instances module (mirrors
-- 20260809000000_document_templates_module/migration.sql exactly). Any rows
-- that existed before this migration ran are NOT recovered -- this restores
-- schema shape only.

CREATE TYPE "DocumentTemplateFieldType" AS ENUM ('TEXT', 'DATE', 'NUMBER', 'CHECKBOX', 'SELECT', 'INFO_BLOCK');
CREATE TYPE "DocumentTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "DocumentInstanceStatus" AS ENUM ('IN_PROGRESS', 'AWAITING_SIGNATURES', 'COMPLETED', 'VOIDED');
CREATE TYPE "SignerRole" AS ENUM ('SUBJECT', 'COUNTERSIGNER');

CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DocumentTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parent_template_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentTemplateSection" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "body_template" TEXT NOT NULL,

    CONSTRAINT "DocumentTemplateSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentTemplateField" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "DocumentTemplateFieldType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "order_index" INTEGER NOT NULL,
    "shared_key" TEXT,
    "select_options" JSONB,
    "validation" JSONB,
    "help_text" TEXT,
    "signer_role" "SignerRole" NOT NULL DEFAULT 'SUBJECT',

    CONSTRAINT "DocumentTemplateField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentTemplateSignatureBlock" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "signer_role" "SignerRole" NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "DocumentTemplateSignatureBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentInstance" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "status" "DocumentInstanceStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "final_document_id" TEXT,

    CONSTRAINT "DocumentInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentInstanceFieldValue" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "DocumentInstanceFieldValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentInstanceSignature" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "signature_block_id" TEXT NOT NULL,
    "signed_by_id" TEXT NOT NULL,
    "signature_image_key" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signer_ip" TEXT,
    "content_hash_at_signing" TEXT NOT NULL,

    CONSTRAINT "DocumentInstanceSignature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentTemplate_status_idx" ON "DocumentTemplate"("status");
CREATE INDEX "DocumentTemplate_parent_template_id_idx" ON "DocumentTemplate"("parent_template_id");
CREATE UNIQUE INDEX "DocumentTemplateSection_template_id_order_index_key" ON "DocumentTemplateSection"("template_id", "order_index");
CREATE INDEX "DocumentTemplateSection_template_id_idx" ON "DocumentTemplateSection"("template_id");
CREATE UNIQUE INDEX "DocumentTemplateField_section_id_field_key_key" ON "DocumentTemplateField"("section_id", "field_key");
CREATE INDEX "DocumentTemplateField_section_id_idx" ON "DocumentTemplateField"("section_id");
CREATE INDEX "DocumentTemplateField_shared_key_idx" ON "DocumentTemplateField"("shared_key");
CREATE INDEX "DocumentTemplateSignatureBlock_section_id_idx" ON "DocumentTemplateSignatureBlock"("section_id");
CREATE UNIQUE INDEX "DocumentInstance_final_document_id_key" ON "DocumentInstance"("final_document_id");
CREATE INDEX "DocumentInstance_worker_id_idx" ON "DocumentInstance"("worker_id");
CREATE INDEX "DocumentInstance_template_id_idx" ON "DocumentInstance"("template_id");
CREATE INDEX "DocumentInstance_status_idx" ON "DocumentInstance"("status");
CREATE UNIQUE INDEX "DocumentInstanceFieldValue_instance_id_field_id_key" ON "DocumentInstanceFieldValue"("instance_id", "field_id");
CREATE INDEX "DocumentInstanceFieldValue_instance_id_idx" ON "DocumentInstanceFieldValue"("instance_id");
CREATE UNIQUE INDEX "DocumentInstanceSignature_instance_id_signature_block_id_key" ON "DocumentInstanceSignature"("instance_id", "signature_block_id");
CREATE INDEX "DocumentInstanceSignature_instance_id_idx" ON "DocumentInstanceSignature"("instance_id");
CREATE INDEX "DocumentInstanceSignature_signed_by_id_idx" ON "DocumentInstanceSignature"("signed_by_id");

ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_parent_template_id_fkey" FOREIGN KEY ("parent_template_id") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentTemplateSection" ADD CONSTRAINT "DocumentTemplateSection_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentTemplateField" ADD CONSTRAINT "DocumentTemplateField_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "DocumentTemplateSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentTemplateSignatureBlock" ADD CONSTRAINT "DocumentTemplateSignatureBlock_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "DocumentTemplateSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "DocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_final_document_id_fkey" FOREIGN KEY ("final_document_id") REFERENCES "WorkerDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentInstanceFieldValue" ADD CONSTRAINT "DocumentInstanceFieldValue_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentInstanceFieldValue" ADD CONSTRAINT "DocumentInstanceFieldValue_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "DocumentTemplateField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentInstanceFieldValue" ADD CONSTRAINT "DocumentInstanceFieldValue_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentInstanceSignature" ADD CONSTRAINT "DocumentInstanceSignature_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentInstanceSignature" ADD CONSTRAINT "DocumentInstanceSignature_signature_block_id_fkey" FOREIGN KEY ("signature_block_id") REFERENCES "DocumentTemplateSignatureBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentInstanceSignature" ADD CONSTRAINT "DocumentInstanceSignature_signed_by_id_fkey" FOREIGN KEY ("signed_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
