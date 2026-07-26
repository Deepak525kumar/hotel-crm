-- ADR-031 M-3 (PR-7): drops the stored User.permissions snapshot. Permissions
-- have been derived request-time from ROLE_PERMISSIONS[role] since PR-3; this
-- column stopped being read at PR-3, stopped being written at PR-4, and is
-- retired here. NOT REVERSIBLE BY DESIGN (data loss) — a pre-drop snapshot is
-- retained in a backup table for one release, matching ADR-030 §5's
-- operational envelope ("a pre-migration snapshot of (user_id, role,
-- permissions) to a backup table retained for one release").
--
-- The backup table is intentionally NOT dropped by this migration or its
-- down.sql — it is retained for one release per the ADR, then removed by a
-- separate, later migration once that release window has passed.
CREATE TABLE "_User_permissions_backup_20260727" AS
  SELECT "id" AS "user_id", "role", "permissions", now() AS "snapshotted_at"
  FROM "User";

ALTER TABLE "User" DROP COLUMN "permissions";
