-- Down migration for 20260726000000_add_regional_manager_role
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without REGIONAL_MANAGER, which is only safe if no row
-- uses it — i.e. ADR-030 M-3 has not promoted any user (FEATURE_RM_ROLE was
-- never enabled, or its promotion has since been reversed). Verify no
-- User.role = 'REGIONAL_MANAGER' rows exist before running this.
BEGIN;

  ALTER TYPE "UserRole" RENAME TO "UserRole_old";

  CREATE TYPE "UserRole" AS ENUM ('WORKER', 'CHECKER', 'MANAGER', 'ADMIN');

  ALTER TABLE "User"
    ALTER COLUMN "role" DROP DEFAULT,
    ALTER COLUMN "role" TYPE "UserRole"
      USING ("role"::text::"UserRole"),
    ALTER COLUMN "role" SET DEFAULT 'WORKER';

  ALTER TABLE "AuditLog"
    ALTER COLUMN "actor_role" TYPE "UserRole"
      USING ("actor_role"::text::"UserRole");

  DROP TYPE "UserRole_old";

COMMIT;
