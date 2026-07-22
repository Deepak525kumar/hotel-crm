/**
 * Shared JWT-scope evaluation primitive (Epic 5 PR 5.5, ADR-023/024).
 *
 * Lives at the `lib/` layer (below `middleware/` and any feature module) so
 * both `middleware/permissions.ts` (the checkHotelAccess() seam, Epic 3) and
 * `lib/roster-scope.ts` (the roster-cutover seam, Epic 5 PR 5.7) can depend on
 * it without a circular import between the two. `middleware/permissions.ts`
 * re-exports `isHotelInScope` so existing call sites
 * (`attendance/service.ts`, `quality/service.ts`) keep importing it from
 * there unchanged.
 */
import { getPrisma } from './db.js';
import type { UserScope } from './jwt.js';

// Evaluates whether a manager's PR 5.4 JWT `scope` claim grants access to the
// given hotel (Epic 5 PR 5.5, ADR-024). null scope denies; global allows; hotel
// scope allows only the matching hotel; hotel_group scope allows any hotel whose
// hotel_group_id matches (one findUnique to resolve the target hotel's group).
export async function isHotelInScope(scope: UserScope | null, hotelId: string): Promise<boolean> {
  if (!scope) return false;
  if (scope.type === 'global') return true;
  if (scope.type === 'hotel') return scope.hotel_id === hotelId;
  // hotel_group
  const prisma = getPrisma();
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
    select: { hotel_group_id: true },
  });
  return !!hotel && hotel.hotel_group_id === scope.hotel_group_id;
}
