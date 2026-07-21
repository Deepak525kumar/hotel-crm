-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "hotel_group_id" TEXT,
ADD COLUMN     "manager_user_id" TEXT;

-- CreateTable
CREATE TABLE "HotelGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billing_info" TEXT,
    "regional_manager_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelGroup_regional_manager_user_id_idx" ON "HotelGroup"("regional_manager_user_id");

-- CreateIndex
CREATE INDEX "Hotel_hotel_group_id_idx" ON "Hotel"("hotel_group_id");

-- CreateIndex
CREATE INDEX "Hotel_manager_user_id_idx" ON "Hotel"("manager_user_id");

-- AddForeignKey
ALTER TABLE "HotelGroup" ADD CONSTRAINT "HotelGroup_regional_manager_user_id_fkey" FOREIGN KEY ("regional_manager_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_hotel_group_id_fkey" FOREIGN KEY ("hotel_group_id") REFERENCES "HotelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
