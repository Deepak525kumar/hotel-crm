-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];
