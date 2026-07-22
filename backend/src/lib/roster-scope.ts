/**
 * Roster cutover seam (Epic 5 PR 5.7, ADR-022 §Authorization migration plan /
 * ADR-023 §Compatibility / ADR-024 D1/D2/D5(i)).
 *
 * checkHotelAccess() and 6 consumer modules currently decide worker access by
 * reading `HotelWorker` ACTIVE-membership rows (a per-hotel roster). This
 * module is the single, centralized mapping from a worker's PR 5.6
 * `EmploymentRecord` to the same "is this worker eligible at this hotel?" /
 * "which hotels/workers are eligible?" questions, expressed at group grain
 * per ADR-023's explicit target formula:
 *
 *   worker.hotel_group_id == target_hotel.hotel_group_id
 *
 * REQ-EMP-012 (SPEC-EMP-001, FROZEN): a worker is "assignable only within
 * their Hotel Group" — i.e. per-hotel membership becomes group-grain
 * membership once the cutover flag is on. `EmploymentStatus.ACTIVE` is the
 * parity state for `HotelWorkerStatus.ACTIVE` (SPEC-EMP-001 State and
 * Lifecycle: "Active — may be scheduled and may accept broadcasts").
 *
 * This mirrors the Epic 3 "single injection point" precedent already
 * established by `middleware/permissions.ts`'s `resolveHotelAccess()` /
 * `isHotelInScope()` — every one of the 10 call sites goes through exactly
 * one of the functions below, so the ADR-024 D2 flag flip has one place to
 * change allow/deny/list behavior instead of ten.
 *
 * Mechanism (ADR-024 D2/D3): flag-gated, NOT dual-write, NOT a per-request
 * fallback blend. Deny-by-default mirrors `resolveScope()`'s existing
 * null-scope precedent in `auth/service.ts` — an ungrouped or non-ACTIVE
 * employee has no scope at all, exactly like a user with no JWT scope claim.
 */
import { EmploymentStatus } from '@prisma/client';
import { getPrisma } from './db.js';
import { isHotelInScope } from '../middleware/permissions.js';
import { isRosterCutoverEnabled } from '../config/feature-flags.js';
import type { UserScope } from './jwt.js';

export { isRosterCutoverEnabled };

/**
 * Resolves a worker's group-grain scope from their PR 5.6 EmploymentRecord.
 * Deny-by-default: returns `null` (no scope) when there is no record, the
 * record is not ACTIVE, or `hotel_group_id` is still unset (ADR-023 §4,
 * nullable until hire-approval) — never widens access on missing data.
 */
export async function resolveWorkerGroupScope(userId: string): Promise<UserScope | null> {
  const prisma = getPrisma();
  const record = await prisma.employmentRecord.findUnique({
    where: { user_id: userId },
    select: { status: true, hotel_group_id: true },
  });
  if (!record || record.status !== EmploymentStatus.ACTIVE || !record.hotel_group_id) {
    return null;
  }
  return { type: 'hotel_group', hotel_group_id: record.hotel_group_id };
}

/**
 * Forward case (#1-4, #6): is this worker eligible to act at this hotel?
 * Reuses the existing `isHotelInScope()` hotel->group resolution rather than
 * reimplementing it.
 */
export async function isWorkerEligibleForHotel(userId: string, hotelId: string): Promise<boolean> {
  const scope = await resolveWorkerGroupScope(userId);
  return isHotelInScope(scope, hotelId);
}

/**
 * Reverse case (#5): given a worker, which hotels are they eligible at?
 * Only ever needs to handle the `hotel_group` shape `resolveWorkerGroupScope`
 * returns (or `null`) — `global`/`hotel` scopes are not reachable here.
 */
export async function listEligibleHotelIds(userId: string): Promise<string[]> {
  const scope = await resolveWorkerGroupScope(userId);
  if (!scope || scope.type !== 'hotel_group') return [];
  const prisma = getPrisma();
  const hotels = await prisma.hotel.findMany({
    where: { hotel_group_id: scope.hotel_group_id },
    select: { id: true },
  });
  return hotels.map((h) => h.id);
}

/**
 * Reverse case (#7): given a hotel, which workers are eligible there (fan-out
 * roster)? Resolves the hotel's group first; an ungrouped hotel has no
 * eligible workers under the cutover.
 */
export async function listEligibleWorkerIds(hotelId: string): Promise<string[]> {
  const prisma = getPrisma();
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
    select: { hotel_group_id: true },
  });
  if (!hotel?.hotel_group_id) return [];
  const records = await prisma.employmentRecord.findMany({
    where: { hotel_group_id: hotel.hotel_group_id, status: EmploymentStatus.ACTIVE },
    select: { user_id: true },
  });
  return records.map((r) => r.user_id);
}
