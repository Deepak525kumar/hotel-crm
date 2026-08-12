-- CreateTable
CREATE TABLE "DailyShiftSummary" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "total_rooms" INTEGER NOT NULL,
    "stay_over_rooms" INTEGER NOT NULL,
    "checkout_rooms" INTEGER NOT NULL,
    "total_people_working" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyShiftSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyShiftSummary_hotel_id_idx" ON "DailyShiftSummary"("hotel_id");

-- CreateIndex
CREATE UNIQUE INDEX "DailyShiftSummary_hotel_id_date_key" ON "DailyShiftSummary"("hotel_id", "date");

-- AddForeignKey
ALTER TABLE "DailyShiftSummary" ADD CONSTRAINT "DailyShiftSummary_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyShiftSummary" ADD CONSTRAINT "DailyShiftSummary_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyShiftSummary" ADD CONSTRAINT "DailyShiftSummary_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
