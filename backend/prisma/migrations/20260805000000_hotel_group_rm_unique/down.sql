-- Down migration for 20260805000000_hotel_group_rm_unique
ALTER TABLE "HotelGroup" DROP CONSTRAINT "HotelGroup_regional_manager_user_id_key";
