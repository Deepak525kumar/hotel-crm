-- CreateEnum
CREATE TYPE "DocumentCategory_new" AS ENUM ('TAX_NUMBER', 'SOCIAL_SECURITY_NUMBER', 'HEALTH_INSURANCE', 'ID_CARD', 'PASSPORT', 'ADDRESS', 'WORK_PERMIT');

-- AlterTable
ALTER TABLE "WorkerDocument" ALTER COLUMN "category" TYPE "DocumentCategory_new" USING ("category"::text::"DocumentCategory_new");

-- DropEnum
DROP TYPE "DocumentCategory";

-- RenameEnum
ALTER TYPE "DocumentCategory_new" RENAME TO "DocumentCategory";

-- AlterTable
ALTER TABLE "EmploymentRecord" ADD COLUMN "work_permit_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmploymentRecord" ADD COLUMN "target_hotel_group_id" TEXT;
ALTER TABLE "EmploymentRecord" ADD COLUMN "target_primary_hotel_id" TEXT;

-- CreateIndex
CREATE INDEX "EmploymentRecord_target_hotel_group_id_idx" ON "EmploymentRecord"("target_hotel_group_id");

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_target_hotel_group_id_fkey" FOREIGN KEY ("target_hotel_group_id") REFERENCES "HotelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_target_primary_hotel_id_fkey" FOREIGN KEY ("target_primary_hotel_id") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
