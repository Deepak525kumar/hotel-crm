/*
  Warnings:

  - You are about to drop the `_User_permissions_backup_20260727` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_WorkApplication_backup_20260729` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboxSourceModule" ADD VALUE 'DOCUMENTS';
ALTER TYPE "OutboxSourceModule" ADD VALUE 'AUTH';

-- DropForeignKey
ALTER TABLE "WorkerDocument" DROP CONSTRAINT "WorkerDocument_uploaded_by_id_fkey";

-- DropIndex
DROP INDEX "CalendarAbsence_marked_by_id_idx";

-- DropIndex
DROP INDEX "WorkerAssignment_skill_slot_id_idx";

-- AlterTable
ALTER TABLE "DocumentTemplateField" ADD COLUMN     "signer_role" "SignerRole" NOT NULL DEFAULT 'SUBJECT';

-- AlterTable
ALTER TABLE "EmploymentRecord" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "_User_permissions_backup_20260727";

-- DropTable
DROP TABLE "_WorkApplication_backup_20260729";

-- AddForeignKey
ALTER TABLE "WorkerDocument" ADD CONSTRAINT "WorkerDocument_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
