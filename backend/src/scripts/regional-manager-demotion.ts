/**
 * Regional Manager V1 Decision 6/11 — demotes REGIONAL_MANAGER users who no
 * longer manage any hotel group back to MANAGER.
 *
 * This is the counterpart to `promoteRegionalManagers` (ADR-030 M-3), closing
 * the gap the earlier audit flagged: the M-3 promotion had no inverse, making
 * every promotion one-way. It is deliberately NOT a way to demote an RM who
 * still owns a group — `updateUserRole` (users/service.ts) already enforces
 * Decision 11 as a live guard (ConflictError) at the point of any role change,
 * API or script. This script only ever touches rows the guard would already
 * allow: REGIONAL_MANAGER users with zero matching HotelGroup row (transferred
 * away via PATCH /hotel-groups/:id, or never assigned one to begin with).
 *
 * Idempotent: only rows currently `role = REGIONAL_MANAGER` with no owned
 * group are selected, so re-running after a partial run touches nothing
 * already demoted or still legitimately holding a group.
 *
 * Snapshot: one AuditLog row per demoted user, mirroring M-3's own snapshot
 * convention (AuditLog as the append-only (user_id, role) record, ADR-016).
 *
 * RACE/DEADLOCK FIX (review follow-up on #339, previously deferred): the
 * ownership check now runs INSIDE a per-user transaction, after a
 * `SELECT ... FOR UPDATE` lock on that user's row — the identical fix
 * `users/service.ts#updateUserRole` and `crm/service.ts#updateHotelGroup`
 * apply, and the identical lock order (User row, then HotelGroup read), so a
 * concurrent group assignment via the API cannot land in the gap between this
 * script's check and its write, and a concurrent updateUserRole()/
 * updateHotelGroup() call on the same user cannot deadlock against this
 * script (same order, so Postgres serializes rather than deadlocks).
 */
import { PrismaClient, UserRole } from '@prisma/client';

export interface RegionalManagerDemotionResult {
  demoted: string[];
  skippedStillOwnsGroup: number;
}

export async function demoteRegionalManagers(
  prisma: Pick<PrismaClient, 'user' | 'hotelGroup' | 'auditLog' | '$transaction'>
): Promise<RegionalManagerDemotionResult> {
  const regionalManagers = await prisma.user.findMany({
    where: { role: UserRole.REGIONAL_MANAGER, deleted_at: null },
    select: { id: true, role: true },
  });

  const demoted: string[] = [];
  let skippedStillOwnsGroup = 0;

  for (const user of regionalManagers) {
    // Whole check-and-demote runs as ONE transaction per user, not a
    // pre-transaction read followed by a separate write — see this file's
    // header comment for the race this closes.
    const wasDemoted = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;

      const ownedGroup = await tx.hotelGroup.findUnique({
        where: { regional_manager_user_id: user.id },
        select: { id: true },
      });

      if (ownedGroup) {
        // Decision 11: a group must always have exactly one assigned RM.
        // Demoting this user would either violate that invariant or strand
        // the group with an acting RM whose role no longer grants any
        // authority. Transfer the group to a successor first
        // (PATCH /hotel-groups/:id).
        return false;
      }

      await tx.user.update({
        where: { id: user.id },
        data: { role: UserRole.MANAGER },
      });
      await tx.auditLog.create({
        data: {
          actor_id: null,
          actor_role: null,
          action: 'DEMOTE_REGIONAL_MANAGER',
          resource_type: 'USER',
          resource_id: user.id,
          old_values: { role: user.role },
          new_values: { role: UserRole.MANAGER },
          details: { reason: 'no_owned_hotel_group' },
          timestamp: new Date(),
        },
      });

      return true;
    });

    if (wasDemoted) {
      demoted.push(user.id);
    } else {
      skippedStillOwnsGroup += 1;
    }
  }

  return { demoted, skippedStillOwnsGroup };
}
