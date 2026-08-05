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
 * never touched `User.permissions` (that backfill was M-2, superseded by
 * ADR-031's request-time derivation model; the column itself is dropped as of
 * ADR-031 M-3/PR-7).
 *
 * Snapshot (ADR-030 §5's "operational envelope: ... a pre-migration snapshot
 * of (user_id, role) to a backup table retained for one release") is recorded
 * as one AuditLog row per promoted user rather than a new table — AuditLog is
 * already the append-only, never-mutated snapshot mechanism (ADR-016) this
 * repository uses for exactly this purpose.
 *
 * RACE FIX (review follow-up on #339, deferred there, closed here): the
 * original shape read `group.regional_manager_user_id` from an unlocked
 * `findMany`, then separately checked and wrote the user row — a window in
 * which a concurrent `PATCH /hotel-groups/:id` (transferring this group to a
 * different manager) could land between the read and the write, promoting a
 * MANAGER who no longer owns the group by the time the promotion commits.
 * Fixed with the same shape `regional-manager-demotion.ts` uses: the group's
 * CURRENT `regional_manager_user_id` is re-read inside a per-group
 * transaction, after a `SELECT ... FOR UPDATE` lock on that user row — same
 * lock order (User row, then the re-read) as `users/service.ts#updateUserRole`
 * and `crm/service.ts#updateHotelGroup`, so a concurrent transfer serializes
 * against this script rather than racing or deadlocking it.
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
    // Whole check-and-promote runs as ONE transaction per group, not a
    // pre-transaction read followed by a separate write — see this file's
    // header comment for the race this closes.
    const outcome = await prisma.$transaction(async (tx) => {
      // Vacancy model (2026-08-06): a group can now have no RM assigned at
      // all -- nothing to lock or promote. Guarding here rather than
      // filtering the outer `groups` query keeps this file's own re-read
      // (not the stale outer snapshot) as the source of truth, per this
      // file's header comment.
      if (!group.regional_manager_user_id) return { kind: 'skip' as const };

      // Row lock on the candidate user FIRST — blocks a concurrent transfer's
      // own User-row lock (crm/service.ts#updateHotelGroup) until this
      // transaction commits or rolls back.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${group.regional_manager_user_id} FOR UPDATE`;

      // Re-read the group's CURRENT regional manager under the lock — the
      // outer `groups` snapshot can be stale by the time we reach here.
      const currentGroup = await tx.hotelGroup.findUnique({
        where: { id: group.id },
        select: { regional_manager_user_id: true },
      });
      if (!currentGroup || !currentGroup.regional_manager_user_id) return { kind: 'skip' as const };

      const user = await tx.user.findUnique({
        where: { id: currentGroup.regional_manager_user_id },
        select: { id: true, role: true },
      });

      if (!user) return { kind: 'skip' as const };
      if (user.role !== UserRole.MANAGER) {
        // Already REGIONAL_MANAGER (idempotent re-run) or some other role
        // (e.g. ADMIN acting as a group's nominal RM) — never touched.
        return { kind: 'skip' as const };
      }

      await tx.user.update({
        where: { id: user.id },
        data: { role: UserRole.REGIONAL_MANAGER },
      });
      await tx.auditLog.create({
        data: {
          actor_id: null,
          actor_role: null,
          action: 'PROMOTE_REGIONAL_MANAGER',
          resource_type: 'USER',
          resource_id: user.id,
          old_values: { role: user.role },
          new_values: { role: UserRole.REGIONAL_MANAGER },
          details: { hotel_group_id: group.id, migration: 'ADR-030-M-3' },
          timestamp: new Date(),
        },
      });

      return { kind: 'promoted' as const, user_id: user.id };
    });

    if (outcome.kind === 'skip') {
      skippedAlreadyPromoted += 1;
      continue;
    }

    promoted.push({ user_id: outcome.user_id, hotel_group_id: group.id });
  }

  return { promoted, skippedAlreadyPromoted };
}
