/**
 * Role-creation hierarchy — "create is 1-level-down only".
 *
 * Project-owner decision, 2026-08-12 (RULE A): an actor may create a user
 * exactly ONE level below itself, and nothing else:
 *
 *   admin            -> regional_manager
 *   regional_manager -> manager
 *   manager          -> worker, checker
 *   worker/checker   -> nobody
 *
 * This NARROWS the previous behaviour, in which `POST /employee-management/`
 * admitted admin/manager/regional_manager with no check at all on the role
 * being created (an admin could mint another admin's peer, a manager could be
 * created by an admin directly, etc.), and in which `POST /users` admitted
 * admin and let it assign any role including `admin`.
 *
 * GOVERNANCE CONFLICT (must be recorded, not silently resolved here):
 * `ADR-065` grants manager/regional_manager a BROAD `createEmployee`
 * capability, and `ADR-030` §3 C-15 grants create to Admin only. Both
 * disagree with this decision, in opposite directions. The owner ratified
 * this rule knowing an `ADR-065`/`ADR-030` §3 amendment is owed; it is
 * tracked in `docs/10-testing/e2e/REMAINING_WORK.md`. Until that amendment
 * exists, this module plus the pins in
 * `src/__tests__/support/capability-violations.ts` are the authority trail.
 *
 * Lives at `lib/` (below `middleware/` and every feature module) for the same
 * reason `lib/scope.ts` does: two unrelated modules need the identical
 * decision (`users` for account creation, `employee-management` for
 * employment-record creation) and neither may depend on the other.
 *
 * Roles are compared as the lowercase JWT-claim strings (`AuthContext.role`),
 * with an explicit normalization helper for the UPPERCASE Prisma `Role` enum
 * that `User.role` stores — mixing the two casings silently is exactly how a
 * role gate stops matching.
 */

/** The lowercase JWT-claim role strings this platform recognizes. */
export const PLATFORM_ROLES = ['admin', 'regional_manager', 'manager', 'checker', 'worker'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * RULE A, as data. Frozen so no caller can widen the policy at runtime.
 *
 * A role absent from this map (or mapped to an empty list) may create nobody.
 * `worker` and `checker` are listed EXPLICITLY with empty arrays rather than
 * omitted, so "this role was considered and grants nothing" is
 * distinguishable from "this role was forgotten".
 */
const CREATABLE_ROLES: Readonly<Record<PlatformRole, readonly PlatformRole[]>> = Object.freeze({
  admin: Object.freeze(['regional_manager'] as const),
  regional_manager: Object.freeze(['manager'] as const),
  manager: Object.freeze(['worker', 'checker'] as const),
  checker: Object.freeze([] as const),
  worker: Object.freeze([] as const),
});

/**
 * Narrows an untrusted role string (it originates in a JWT claim, so it may
 * hold any value) to a `PlatformRole`. Returns `null` for anything else —
 * callers must treat `null` as "creates nothing", never as a default role.
 */
export function asPlatformRole(role: string | null | undefined): PlatformRole | null {
  if (!role) return null;
  const lower = role.toLowerCase();
  return (PLATFORM_ROLES as readonly string[]).includes(lower) ? (lower as PlatformRole) : null;
}

/**
 * The roles `actorRole` may create, in a stable order suitable for rendering a
 * form's options. Empty for worker/checker and for any unrecognized role.
 */
export function creatableRolesFor(actorRole: string | null | undefined): readonly PlatformRole[] {
  const actor = asPlatformRole(actorRole);
  if (!actor) return [];
  return CREATABLE_ROLES[actor];
}

/**
 * RULE A's single decision point. Deny-by-default: an unrecognized actor role
 * or an unrecognized target role both deny.
 */
export function canCreateRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  const target = asPlatformRole(targetRole);
  if (!target) return false;
  return creatableRolesFor(actorRole).includes(target);
}

/**
 * Human-readable denial message, shared by both enforcement sites so the two
 * surfaces cannot drift into differently-worded 403s for the same rule.
 */
export function createRoleDenialMessage(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): string {
  const allowed = creatableRolesFor(actorRole);
  const actorLabel = asPlatformRole(actorRole) ?? 'this role';
  if (allowed.length === 0) {
    return `A ${actorLabel} may not create users`;
  }
  return `A ${actorLabel} may only create users with role: ${allowed.join(', ')} (attempted: ${asPlatformRole(targetRole) ?? 'unknown'})`;
}
