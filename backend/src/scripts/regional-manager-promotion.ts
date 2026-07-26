/**
 * ADR-030 M-3 (§5, §6 PR-2) — promotes existing HotelGroup.regional_manager_user_id
 * users from MANAGER to REGIONAL_MANAGER.
 *
 * Gated by FEATURE_RM_ROLE (D-6): the enum value lands unconditionally (M-1),
 * but this promotion — and therefore every behavioral effect of the new role —
 * does not run while the flag is off, matching the "both-off = current
 * behavior" posture. Must not run in production before PR-3 ships (mobile/
 * frontend role-union widening + the hotel-group RM-picker fix, F-3), per the
 * ADR-030 §6 ordering constraint.
 *
 * Idempotent: only rows currently `role = MANAGER` are selected, so re-running
 * after a partial or repeat run touches nothing already promoted. Data-only —
 * does not touch `User.permissions` (that backfill is M-2, deferred to PR-5
 * per ADR-030 §5: "Runs with PR-5 and re-runs on any later matrix change").
 *
 * Snapshot (ADR-030 §5's "operational envelope: ... both take a pre-migration
 * snapshot of (user_id, role, permissions) to a backup table retained for one
 * release") is recorded as one AuditLog row per promoted user rather than a
 * new table — AuditLog is already the append-only, never-mutated snapshot
 * mechanism (ADR-016) this repository uses for exactly this purpose.
 */
import { PrismaClient, UserRole } from '@prisma/client';

export interface RegionalManagerPromotionResult {
  promoted: Array<{ user_id: string; hotel_group_id: string }>;
  skippedAlreadyPromoted: number;
}

export async function promoteRegionalManagers(
  prisma: Pick<PrismaClient, 'hotelGroup' | 'user' | 'auditLog' | '$transaction'>
): Promise<RegionalManagerPromotionResult> {
  const groups = await prisma.hotelGroup.findMany({
    select: { id: true, regional_manager_user_id: true },
  });

  const promoted: Array<{ user_id: string; hotel_group_id: string }> = [];
  let skippedAlreadyPromoted = 0;

  for (const group of groups) {
    const user = await prisma.user.findUnique({
      where: { id: group.regional_manager_user_id },
      select: { id: true, role: true, permissions: true },
    });

    if (!user) continue;
    if (user.role !== UserRole.MANAGER) {
      // Already REGIONAL_MANAGER (idempotent re-run) or some other role
      // (e.g. ADMIN acting as a group's nominal RM) — never touched.
      skippedAlreadyPromoted += 1;
      continue;
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.REGIONAL_MANAGER },
      }),
      prisma.auditLog.create({
        data: {
          actor_id: null,
          actor_role: null,
          action: 'PROMOTE_REGIONAL_MANAGER',
          resource_type: 'USER',
          resource_id: user.id,
          old_values: { role: user.role, permissions: user.permissions },
          new_values: { role: UserRole.REGIONAL_MANAGER, permissions: user.permissions },
          details: { hotel_group_id: group.id, migration: 'ADR-030-M-3' },
          timestamp: new Date(),
        },
      }),
    ]);

    promoted.push({ user_id: user.id, hotel_group_id: group.id });
  }

  return { promoted, skippedAlreadyPromoted };
}
