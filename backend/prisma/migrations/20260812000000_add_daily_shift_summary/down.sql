-- DropForeignKey
ALTER TABLE "DailyShiftSummary" DROP CONSTRAINT IF EXISTS "DailyShiftSummary_updated_by_id_fkey";
ALTER TABLE "DailyShiftSummary" DROP CONSTRAINT IF EXISTS "DailyShiftSummary_created_by_id_fkey";
ALTER TABLE "DailyShiftSummary" DROP CONSTRAINT IF EXISTS "DailyShiftSummary_hotel_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "DailyShiftSummary";
