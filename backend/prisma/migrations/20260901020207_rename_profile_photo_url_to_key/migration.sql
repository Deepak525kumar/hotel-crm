-- Renames User.profile_photo_url -> User.profile_photo_key.
--
-- The column never held a URL: no upload path ever wrote to it (grep across
-- the codebase before this migration found zero writers). It now holds an S3
-- object key, resolved to a presigned GET only inside the stable
-- /users/:id/photo route -- see backend/src/modules/users/photo-serving.ts.
-- A plain column rename, so existing data (there is none in practice) is
-- preserved either way.

ALTER TABLE "User" RENAME COLUMN "profile_photo_url" TO "profile_photo_key";
