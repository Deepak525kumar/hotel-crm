ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_created_by_id_fkey";
DROP INDEX IF EXISTS "User_created_by_id_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "created_by_id";
