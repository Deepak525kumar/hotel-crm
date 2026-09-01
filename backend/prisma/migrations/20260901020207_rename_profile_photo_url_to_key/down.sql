-- Down migration for 20260901020207_rename_profile_photo_url_to_key
BEGIN;
  ALTER TABLE "User" RENAME COLUMN "profile_photo_key" TO "profile_photo_url";
COMMIT;
