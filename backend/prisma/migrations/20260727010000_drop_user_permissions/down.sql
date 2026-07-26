-- Down migration for 20260727010000_drop_user_permissions
--
-- ADR-031 M-3 is NOT REVERSIBLE BY DESIGN: any permission-matrix change made
-- after this migration ran (a new/edited ROLE_PERMISSIONS entry, PR-8
-- onward) has no corresponding stored value to restore for accounts created
-- or role-changed after the drop. This down.sql is a best-effort restoration
-- from the pre-drop backup table for accounts unchanged since the snapshot;
-- it does not restore correctness for the general case, and running it does
-- not undo any authorization decision made based on live derivation since.
--
-- Requires the backup table from this migration's up.sql
-- ("_User_permissions_backup_20260727") to still exist (it is retained one
-- release, not dropped automatically — see migration.sql's comment).
BEGIN;

  ALTER TABLE "User" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT '{}';

  UPDATE "User" u
  SET "permissions" = b."permissions"
  FROM "_User_permissions_backup_20260727" b
  WHERE u."id" = b."user_id";

COMMIT;
