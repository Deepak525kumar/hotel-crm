-- Down migration for 20260807120000_hotel_group_lifecycle

DROP INDEX "HotelGroup_deleted_at_idx";
DROP INDEX "HotelGroup_is_active_idx";
ALTER TABLE "HotelGroup" DROP COLUMN "deleted_at";
ALTER TABLE "HotelGroup" DROP COLUMN "is_active";
