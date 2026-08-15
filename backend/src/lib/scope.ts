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
import { logger } from './logger.js';
import type { UserScope } from './jwt.js';

/**
 * Role predicates for the scope-bound manager classes (ADR-030 D-5).
 *
 * `requireRole()` and every service-layer guard compare `actor.role` by exact
 * string (middleware/permissions.ts), with no hierarchy and no aliasing. So
 * `REGIONAL_MANAGER` — which holds MANAGER's entire token set by reference
 * (config/constants.ts) — has to be named literally at every comparison site,
 * and a site that names only `'manager'` fails in one of two ways:
 *
 *   1. `role === 'manager'` scope branches SKIP the scope check for an RM.
 *   2. `role !== 'admin' && role !== 'manager'` worker fallbacks MATCH an RM,
 *      silently narrowing it to its own rows and returning 200 with the wrong
 *      data — worse than a 403, because nothing signals the error.
 *
 * Both shapes shipped to production and were caught only by human security
 * review: `SIR-AUTH-021` (High — `resolveHotelAccess()` had no RM branch) and
 * `SIR-ANLY-015` (Medium — analytics role admission and token grant not
 * extended in lockstep). See `.claude/governance/
 * SPECIFICATION_ISSUES_REGISTER.md`.
 *
 * These predicates exist so the next role added to the platform is a change to
 * this file rather than a hunt through a dozen `===` comparisons. Prefer them
 * over literal role strings in any new scope guard.
 *
 * NOTE these answer "which authorization CLASS is this actor in", not "may this
 * actor reach this resource" — the latter is `isHotelInScope` /
 * `isWorkerInGroupScope` / `resolveScopeGroupFilter` below.
 */

/**
 * True for the two scope-bound manager roles: Hotel Manager (hotel scope) and
 * Regional Manager (hotel-group scope). Both hold the same operational
 * capability set (ADR-030 D-5) and differ only in the breadth of their `scope`
 * claim, which the scope primitives resolve — so a guard that scope-checks a
 * manager must scope-check an RM identically.
 *
 * DELIBERATELY enumerates role names rather than deriving from
 * `ROLE_PERMISSIONS` (e.g. "holds `staffing:write`"). Organizational position
 * and permission set coincide TODAY (D-5 gives RM Manager's tokens plus
 * `org_chart:read`), but that is an implementation coincidence, not the intent.
 * Deriving scope classification from the permission map would mean any future
 * token grant silently changes which branch a role takes in every guard below —
 * exactly the coupling that let a permission change (RM aliasing
 * MANAGER_PERMISSIONS) invalidate resolveWorkerScope's stated assumption and
 * produce SIR-AUTH-021. Keep this expressing "which scope class is this role",
 * and let the permission map answer "what may it do".
 *
 * `role` is `string`, not a union: it originates in a JWT claim
 * (`lib/jwt.ts`, `AuthContext.role`) and so is untrusted input that may hold
 * any value. Callers must therefore treat a `false` result as "not a scoped
 * manager" (deny/narrow), never as "must be a worker".
 */
export function isScopedManagerRole(role: string): boolean {
  return role === 'manager' || role === 'regional_manager';
}

/**
 * True for roles whose reads/writes are narrowed to their OWN records — i.e.
 * neither an admin (unrestricted) nor a scope-bound manager.
 *
 * Replaces the `role !== 'admin' && role !== 'manager'` shape, which
 * misclassified a Regional Manager as a worker. `checker` is NOT included: it
 * is cross-hotel by present behaviour at several call sites, so callers that
 * treat checker as non-self must say so explicitly (see
 * `isSelfScopedRole(role, { checkerIsSelfScoped: false })`).
 */
export function isSelfScopedRole(
  role: string,
  opts: { checkerIsSelfScoped?: boolean } = {}
): boolean {
  const { checkerIsSelfScoped = true } = opts;
  if (role === 'admin') return false;
  if (isScopedManagerRole(role)) return false;
  if (role === 'checker') return checkerIsSelfScoped;
  return true;
}

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

// Evaluates whether a manager's scope claim grants access to a worker's
// employment record (ADR-030 PR-1, C-10). Employment records are group-grain,
// never hotel-grain (REQ-EMP-012/ADR-022), so the compare is against
// EmploymentRecord.hotel_group_id directly — the same comparison
// employee-management's private isRecordInScope (service.ts) already performs,
// made a shared primitive here since a second scoped-write consumer (HR) now
// needs it. Deny-by-default: no scope, no employment record, or no group on
// the record all deny.
export async function isWorkerInGroupScope(scope: UserScope | null, workerId: string): Promise<boolean> {
  if (!scope) return false;
  const prisma = getPrisma();
  const record = await prisma.employmentRecord.findUnique({
    where: { user_id: workerId },
    select: { hotel_group_id: true },
  });
  if (!record || !record.hotel_group_id) return false;
  if (scope.type === 'global') return true;
  if (scope.type === 'hotel_group') return scope.hotel_group_id === record.hotel_group_id;
  // scope.type === 'hotel': resolve the hotel's group, mirroring isHotelInScope's
  // own hotel_group-scope branch in the opposite direction.
  const hotel = await prisma.hotel.findUnique({
    where: { id: scope.hotel_id },
    select: { hotel_group_id: true },
  });
  return !!hotel && hotel.hotel_group_id === record.hotel_group_id;
}

export async function isManagerInGroupScope(scope: UserScope | null, managerUserId: string): Promise<boolean> {
  if (!scope) return false;
  if (scope.type === 'global') return true;

  const targetGroupId = await resolveScopeGroupFilter(scope).then(f => f.kind === 'group' ? f.hotelGroupId : null);
  if (!targetGroupId) return false;

  const prisma = getPrisma();
  const managedHotels = await prisma.hotel.findMany({
    where: { manager_user_id: managerUserId, hotel_group_id: targetGroupId },
    select: { id: true }
  });
  
  return managedHotels.length > 0;
}

// 2026-08-13 (review-queue reviewing gap, found while rebuilding the review
// queue UI): isWorkerInGroupScope() above denies by design when
// hotel_group_id is null -- correct for the general case, but an
// EmploymentRecord in that exact state (PENDING, not yet approved) is
// precisely what a manager/RM's review queue exists to show. Its own
// target_hotel_group_id/target_primary_hotel_id (schema.prisma, ADR-065 §6
// item 3/5 -- set at creation from the CREATING actor's own scope, "display/
// default-selection only, never read by eligibility checks") is the
// pre-approval equivalent of hotel_group_id for this one purpose: deciding
// whether a REVIEWER may view (never write) a not-yet-approved applicant's
// document completeness. Falls through to isWorkerInGroupScope's real,
// post-approval group once hotel_group_id is set, so this never widens
// access for an already-active worker.
export async function isWorkerInReviewerScope(scope: UserScope | null, workerId: string): Promise<boolean> {
  if (!scope) return false;
  const prisma = getPrisma();
  const record = await prisma.employmentRecord.findUnique({
    where: { user_id: workerId },
    select: { hotel_group_id: true, target_hotel_group_id: true, target_primary_hotel_id: true },
  });
  if (!record) return false;

  if (record.hotel_group_id) {
    return isWorkerInGroupScope(scope, workerId);
  }

  if (scope.type === 'global') return true;
  if (record.target_hotel_group_id && scope.type === 'hotel_group') {
    return scope.hotel_group_id === record.target_hotel_group_id;
  }
  if (record.target_primary_hotel_id && scope.type === 'hotel') {
    return scope.hotel_id === record.target_primary_hotel_id;
  }
  // Cross-check the other direction too (e.g. an RM's group scope against a
  // manager-created applicant whose target is hotel-grain only, or vice
  // versa) by resolving through the hotel<->group relationship, mirroring
  // isWorkerInGroupScope's own hotel-scope branch.
  if (record.target_primary_hotel_id && scope.type === 'hotel_group') {
    const hotel = await prisma.hotel.findUnique({
      where: { id: record.target_primary_hotel_id },
      select: { hotel_group_id: true },
    });
    return !!hotel && hotel.hotel_group_id === scope.hotel_group_id;
  }
  return false;
}

// ADR-030 PR-4 (D-7 "filter, don't deny"): resolves a manager/regional_manager
// scope claim down to a single hotel_group_id list-filter. Three consumers
// need the identical resolution (users/hotel-groups/analytics list reads),
// hence a shared primitive rather than three inline copies. Distinct from
// `isHotelInScope`/`isWorkerInGroupScope` (which answer "may this actor reach
// one specific hotel/worker") — this answers "what group should a *list* be
// narrowed to." A missing scope claim resolves to `deny` (there is nothing to
// filter BY, so the safe default is zero rows, not every row).
export type ScopeGroupFilter =
  | { kind: 'none' }
  | { kind: 'group'; hotelGroupId: string }
  | { kind: 'deny' };

export async function resolveScopeGroupFilter(scope: UserScope | null): Promise<ScopeGroupFilter> {
  if (!scope) return { kind: 'deny' };
  if (scope.type === 'global') return { kind: 'none' };
  if (scope.type === 'hotel_group') return { kind: 'group', hotelGroupId: scope.hotel_group_id };
  // scope.type === 'hotel': hotel groups are group-grain (ADR-023), so a
  // hotel-scoped manager resolves to their one hotel's group — mirroring
  // isHotelInScope's own hotel_group-scope branch in the opposite direction.
  const prisma = getPrisma();
  const hotel = await prisma.hotel.findUnique({
    where: { id: scope.hotel_id },
    select: { hotel_group_id: true },
  });
  if (!hotel?.hotel_group_id) return { kind: 'deny' };
  return { kind: 'group', hotelGroupId: hotel.hotel_group_id };
}

// A non-admin actor can never legitimately resolve to 'none' (unrestricted) —
// see resolveNonAdminScopeFilter below — so that state is deliberately
// excluded from its return type, not just its runtime behavior.
export type NonAdminScopeFilter = { kind: 'group'; hotelGroupId: string } | { kind: 'deny' };

// Wraps resolveScopeGroupFilter for callers that already gate on
// `actorRole !== 'admin'`. `resolveScope()` (auth/service.ts) only ever mints
// a `{type:'global'}` claim for role === 'admin' — so a `'none'` result
// reaching here for a non-admin actor is an invariant violation (a
// token/claim-issuance bug), not a normal case. Logs loudly and fails closed
// (deny) rather than silently granting the same unrestricted access this
// primitive exists to prevent (security review FIND-01, ADR-030 PR-4).
export async function resolveNonAdminScopeFilter(
  actorRole: string,
  scope: UserScope | null
): Promise<NonAdminScopeFilter> {
  const filter = await resolveScopeGroupFilter(scope);
  if (filter.kind === 'none') {
    logger.error('Scope invariant violation: non-admin actor resolved to global scope', {
      actorRole,
    });
    return { kind: 'deny' };
  }
  return filter;
}

