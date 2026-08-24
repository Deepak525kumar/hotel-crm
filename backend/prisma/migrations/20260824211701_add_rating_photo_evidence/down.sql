-- Paired rollback (repo convention: every migration ships a down.sql).
--
-- Purely additive forward migration, so the rollback is a single column drop.
-- No enum was created or altered, so none of the NotificationType-style
-- rebuild hazards apply here.
--
-- Data loss is intended and bounded: this drops the S3 KEYS for rating
-- evidence, not the objects themselves — those remain in the bucket under
-- `quality/<assignment_id>/rating/...` and would be orphaned rather than
-- deleted. That is the same trade every other photo column in this module
-- makes; a rollback that also deleted bucket objects would make the operation
-- irreversible in the other direction.
--
-- Rolling this back re-opens the CRR §15 gap it closed: createRating() will
-- reject every request with 'A photo is required to submit a rating' unless
-- the application code is rolled back with it, since the service writes this
-- column unconditionally. Roll back code and schema together.

ALTER TABLE "Rating" DROP COLUMN IF EXISTS "photo_urls";
