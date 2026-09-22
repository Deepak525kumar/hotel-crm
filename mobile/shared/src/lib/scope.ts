import type { User } from '../types/api';

export type ScopeShape =
  /** A hotel manager: exactly one hotel, and no choice to make. */
  | { kind: 'hotel'; hotelId: string }
  /** A regional manager: every hotel in one group. */
  | { kind: 'group'; hotelGroupId: string }
  /** An admin: everything. */
  | { kind: 'global' }
  /** Signed out, or a token with no scope at all. */
  | { kind: 'none' };

/**
 * What the actor can see, derived from their RESOLVED SCOPE CLAIMS rather
 * than their role.
 *
 * This distinction is the point of the function. `frontend/CLAUDE.md` records
 * it as a rule because getting it wrong is silent: an admin and a regional
 * manager BOTH have `scope_hotel_id === null`, so `role === 'admin'` sends an
 * RM down the admin branch and shows them the whole platform. Nothing errors.
 *
 * Group is checked before hotel, matching the backend's own precedence
 * ("regional manager (hotel_group, broader scope wins)",
 * `auth/service.ts resolveScope`). A user who somehow carries both claims is
 * the broader one.
 *
 * A null scope is `none`, never `global`. The backend denies every scoped
 * capability on a null scope (ADR-030 D-7), so rendering it as "everything"
 * would promise data that every request will refuse.
 */
export function scopeOf(user: Pick<User, 'role' | 'scope_hotel_id' | 'scope_hotel_group_id'> | null): ScopeShape {
  if (!user) return { kind: 'none' };

  if (user.scope_hotel_group_id) {
    return { kind: 'group', hotelGroupId: user.scope_hotel_group_id };
  }
  if (user.scope_hotel_id) {
    return { kind: 'hotel', hotelId: user.scope_hotel_id };
  }
  // Only an admin legitimately reaches here with no claim. Any other role
  // with a null scope is unscoped, which the server treats as deny.
  return user.role === 'admin' ? { kind: 'global' } : { kind: 'none' };
}
