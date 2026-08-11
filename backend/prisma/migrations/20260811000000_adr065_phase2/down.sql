ALTER TABLE "EmploymentRecord" DROP CONSTRAINT IF EXISTS "EmploymentRecord_target_primary_hotel_id_fkey";
ALTER TABLE "EmploymentRecord" DROP CONSTRAINT IF EXISTS "EmploymentRecord_target_hotel_group_id_fkey";
DROP INDEX IF EXISTS "EmploymentRecord_target_hotel_group_id_idx";
ALTER TABLE "EmploymentRecord" DROP COLUMN IF EXISTS "target_primary_hotel_id";
ALTER TABLE "EmploymentRecord" DROP COLUMN IF EXISTS "target_hotel_group_id";
ALTER TABLE "EmploymentRecord" DROP COLUMN IF EXISTS "work_permit_required";

DELETE FROM "WorkerDocument" WHERE "category" = 'WORK_PERMIT';

CREATE TYPE "DocumentCategory_new" AS ENUM ('TAX_NUMBER', 'SOCIAL_SECURITY_NUMBER', 'HEALTH_INSURANCE', 'ID_CARD', 'PASSPORT', 'ADDRESS');
ALTER TABLE "WorkerDocument" ALTER COLUMN "category" TYPE "DocumentCategory_new" USING ("category"::text::"DocumentCategory_new");
DROP TYPE "DocumentCategory";
ALTER TYPE "DocumentCategory_new" RENAME TO "DocumentCategory";
