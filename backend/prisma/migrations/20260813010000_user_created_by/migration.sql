-- 2026-08-13 fix: tracks who created each User account (POST /users).
-- Closes a real gap in getUser()'s scope check (users/service.ts) -- a
-- manager/RM who just created a worker/checker account had no way to view
-- that profile afterward, because EmploymentRecord (the thing
-- isWorkerInGroupScope checks) doesn't exist yet at account-creation time
-- (it's created separately, later, via POST /employees). The creator may
-- now always view their own creation, closing the gap without reopening an
-- IDOR -- only the actual creator gets the exception.
ALTER TABLE "User" ADD COLUMN "created_by_id" TEXT;
CREATE INDEX "User_created_by_id_idx" ON "User"("created_by_id");
ALTER TABLE "User" ADD CONSTRAINT "User_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
