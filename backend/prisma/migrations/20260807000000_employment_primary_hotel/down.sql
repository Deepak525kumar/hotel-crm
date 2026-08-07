-- Down migration for 20260807000000_employment_primary_hotel

DROP INDEX "EmploymentRecord_primary_hotel_id_idx";
ALTER TABLE "EmploymentRecord" DROP CONSTRAINT "EmploymentRecord_primary_hotel_id_fkey";
ALTER TABLE "EmploymentRecord" DROP COLUMN "primary_hotel_id";
