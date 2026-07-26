/**
 * ADR-030 M-2 (§5, §6 PR-5) — backfills User.permissions for every ADMIN,
 * MANAGER, and REGIONAL_MANAGER row from the current ROLE_PERMISSIONS map.
 *
 * Load-bearing: `ROLE_PERMISSIONS` is a source constant with zero effect on
 * any existing account's *stored* `User.permissions` snapshot (permissions
 * are stored, not derived — ADR-030 §1 fact 2). Without this script, none of
 * §3's matrix changes (D-4's `users:write` grant, D-9's `hotel_groups:*`
 * split) take effect for a single existing account, no matter what
 * FEATURE_GD02_MATRIX or the route gates say.
 *
 * Gated by FEATURE_GD02_MATRIX (D-6): refuses to run unless the flag is
 * explicitly enabled — running it while off would grant every existing
 * admin/manager the new tokens before the route gates are prepared to
 * enforce them narrowly (D-3/D-9's flag-gated narrowing).
 *
 * Idempotent: only rows whose stored `permissions` differ from
 * `ROLE_PERMISSIONS[role]` are touched, so re-running (e.g. "re-runs on any
 * later matrix change until ADR-031 lands", §5) is safe and cheap on a
 * matrix that hasn't changed. Snapshot (§5's "operational envelope... a
 * pre-migration snapshot... to a backup table") is one AuditLog row per
 * updated user, mirroring M-3's regional-manager-promotion.ts precedent
 * rather than introducing a new table.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { ROLE_PERMISSIONS } from '../config/constants.js';

export interface RolePermissionsBackfillResult {
  updated: Array<{ user_id: string; role: string }>;
  unchanged: number;
  total: number;
}

const BACKFILL_ROLES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.REGIONAL_MANAGER];

function permissionsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((perm, i) => perm === sortedB[i]);
}

export async function backfillRolePermissions(
  prisma: Pick<PrismaClient, 'user' | 'auditLog' | '$transaction'>
): Promise<RolePermissionsBackfillResult> {
  const users = await prisma.user.findMany({
    where: { role: { in: BACKFILL_ROLES }, deleted_at: null },
    select: { id: true, role: true, permissions: true },
  });

  const updated: Array<{ user_id: string; role: string }> = [];
  let unchanged = 0;

  for (const user of users) {
    const targetPermissions = ROLE_PERMISSIONS[user.role] ?? [];
    if (permissionsEqual(user.permissions, targetPermissions)) {
      unchanged += 1;
      continue;
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { permissions: targetPermissions },
      }),
      prisma.auditLog.create({
        data: {
          actor_id: null,
          actor_role: null,
          action: 'BACKFILL_PERMISSIONS',
          resource_type: 'USER',
          resource_id: user.id,
          old_values: { permissions: user.permissions },
          new_values: { permissions: targetPermissions },
          details: { role: user.role, migration: 'ADR-030-M-2' },
          timestamp: new Date(),
        },
      }),
    ]);

    updated.push({ user_id: user.id, role: user.role });
  }

  return { updated, unchanged, total: users.length };
}
