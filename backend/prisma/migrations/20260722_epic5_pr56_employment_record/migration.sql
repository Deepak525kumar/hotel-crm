-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('INACTIVE', 'UNDER_REVIEW', 'ACTIVE', 'REJECTED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "SkillTag" AS ENUM ('CLEANER', 'PUBLIC_SERVICE', 'KITCHEN_DISHWASHER', 'WAITER');

-- CreateTable
CREATE TABLE "EmploymentRecord" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'INACTIVE',
    "marked_suitable" BOOLEAN NOT NULL DEFAULT false,
    "hotel_group_id" TEXT,
    "skills" "SkillTag"[],
    "personal_data" JSONB,
    "konfession" TEXT,
    "disability_status" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBlocklistEntry" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "employment_record_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeBlocklistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentRecord_user_id_key" ON "EmploymentRecord"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentRecord_employee_id_key" ON "EmploymentRecord"("employee_id");

-- CreateIndex
CREATE INDEX "EmploymentRecord_hotel_group_id_idx" ON "EmploymentRecord"("hotel_group_id");

-- CreateIndex
CREATE INDEX "EmploymentRecord_status_idx" ON "EmploymentRecord"("status");

-- CreateIndex
CREATE INDEX "EmployeeBlocklistEntry_hotel_id_idx" ON "EmployeeBlocklistEntry"("hotel_id");

-- CreateIndex
CREATE INDEX "EmployeeBlocklistEntry_employment_record_id_idx" ON "EmployeeBlocklistEntry"("employment_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeBlocklistEntry_hotel_id_employment_record_id_key" ON "EmployeeBlocklistEntry"("hotel_id", "employment_record_id");

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_hotel_group_id_fkey" FOREIGN KEY ("hotel_group_id") REFERENCES "HotelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBlocklistEntry" ADD CONSTRAINT "EmployeeBlocklistEntry_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBlocklistEntry" ADD CONSTRAINT "EmployeeBlocklistEntry_employment_record_id_fkey" FOREIGN KEY ("employment_record_id") REFERENCES "EmploymentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBlocklistEntry" ADD CONSTRAINT "EmployeeBlocklistEntry_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
