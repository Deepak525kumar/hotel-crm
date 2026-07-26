-- ADR-031 M-3 (PR-7): drops the stored User.permissions snapshot. Permissions
-- have been derived request-time from ROLE_PERMISSIONS[role] since PR-3; this
-- column stopped being read at PR-3, stopped being written at PR-4, and is
-- retired here. NOT REVERSIBLE BY DESIGN (data loss) — a pre-drop snapshot is
-- retained in a backup table for one release, matching ADR-030 §5's
-- operational envelope ("a pre-migration snapshot of (user_id, role,
-- permissions) to a backup table retained for one release").
--
-- The backup table is NOT dropped by this (up) migration — it persists
-- across the one-release retention window as an operational/deployment
-- policy: nobody should invoke this migration's down.sql (an actual
-- rollback) before that window passes. If down.sql IS invoked, it drops the
-- backup table as its final step, after restoring from it — see down.sql's
-- comment for why: the migration harness requires every migration to be
-- fully reversible to an empty schema (scripts/migrate-harness.sh `verify`),
-- so "retained for one release" cannot mean "survives an actual rollback."
--
-- `role` is snapshotted as `text`, not the live `UserRole` enum: a
-- `CREATE TABLE ... AS SELECT` on an enum column makes the new table's
-- column depend on that exact enum type. A later migration's down.sql may
-- need to rename/replace `UserRole` (e.g. `20260726000000_add_regional_
-- manager_role`'s down.sql renames it to `UserRole_old` and drops the old
-- type) — a live dependency from this backup table would block that DROP
-- TYPE with "other objects depend on it". Casting to text keeps the
-- snapshot's data identical while carrying no enum-type dependency.
CREATE TABLE "_User_permissions_backup_20260727" AS
  SELECT "id" AS "user_id", "role"::text AS "role", "permissions", now() AS "snapshotted_at"
  FROM "User";

ALTER TABLE "User" DROP COLUMN "permissions";
