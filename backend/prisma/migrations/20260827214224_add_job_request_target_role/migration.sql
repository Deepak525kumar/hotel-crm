-- AlterTable
ALTER TABLE "WorkRequest" ADD COLUMN     "target_role" "UserRole" NOT NULL DEFAULT 'WORKER';

-- CreateIndex
CREATE INDEX "WorkRequest_target_role_idx" ON "WorkRequest"("target_role");
