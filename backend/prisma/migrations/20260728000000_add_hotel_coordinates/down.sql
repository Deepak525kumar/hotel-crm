-- Down migration for 20260728000000_add_hotel_coordinates
BEGIN;
  ALTER TABLE "Hotel" DROP COLUMN "latitude";
  ALTER TABLE "Hotel" DROP COLUMN "longitude";
COMMIT;
