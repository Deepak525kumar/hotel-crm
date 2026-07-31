-- SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN) -- schema-only PR 1 of the
-- planned 5-PR implementation sequence (schema -> core interfaces -> sweep
-- engine -> audit -> eligibility API). Additive, pre-launch, no production
-- data to migrate (PDD §10 Phase 3).
--
-- Scope (human decision, 2026-07-31): generic retention infrastructure for
-- consuming modules without their own mechanism. Does not own or migrate
-- backend-geo's already-ratified Tier-1 sweep (GD-14, SIR-GEO-002).
--
-- RULE-RETENTION-01: RetentionTier is a closed three-value set (TIER_1/2/3);
-- windows (6mo/5yr/6yr) are service-layer logic, not encoded here.
-- RULE-RETENTION-02/REQ-RETENTION-014: RetentionCategory persists a
-- consuming module's category-to-tier registration (unique per module_id +
-- category_id; OD-RETENTION-03 duplicate-conflict handling remains OPEN).
-- RULE-RETENTION-03/REQ-RETENTION-015: RetentionLog tracks per-record
-- deletion-eligibility state pre-deletion, FK-scoped to a registered
-- RetentionCategory only (RULE-RETENTION-07: unregistered categories are
-- never swept).
-- RULE-RETENTION-06/REQ-RETENTION-018: RetentionAuditEntry is the immutable
-- post-deletion audit record (category/tier/timestamp only, never the
-- deleted personal data).

-- CreateEnum
CREATE TYPE "RetentionTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateTable
CREATE TABLE "RetentionCategory" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "tier" "RetentionTier" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionLog" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "record_ref" TEXT NOT NULL,
    "tagged_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionAuditEntry" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "tier" "RetentionTier" NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetentionCategory_module_id_category_id_key" ON "RetentionCategory"("module_id", "category_id");

-- CreateIndex
CREATE INDEX "RetentionLog_category_id_idx" ON "RetentionLog"("category_id");

-- CreateIndex
CREATE INDEX "RetentionLog_tagged_at_idx" ON "RetentionLog"("tagged_at");

-- CreateIndex
CREATE INDEX "RetentionLog_deleted_at_idx" ON "RetentionLog"("deleted_at");

-- CreateIndex
CREATE INDEX "RetentionAuditEntry_module_id_category_id_idx" ON "RetentionAuditEntry"("module_id", "category_id");

-- CreateIndex
CREATE INDEX "RetentionAuditEntry_deleted_at_idx" ON "RetentionAuditEntry"("deleted_at");

-- AddForeignKey
ALTER TABLE "RetentionLog" ADD CONSTRAINT "RetentionLog_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "RetentionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
