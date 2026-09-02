/**
 * Role-creation hierarchy — "create is 1-level-down only".
 *
 * Project-owner decision, 2026-08-12 (RULE A): an actor may create a user
 * exactly ONE level below itself. AMENDED 2026-09-02 (same authority): the
 * admin is exempt and may create any non-admin role directly, because in
 * practice the hierarchy is not yet staffed and the admin has to open
 * accounts for everyone. The chain still binds every other actor.
 *
 *   admin            -> regional_manager, manager, worker, checker
 *   regional_manager -> manager
 *   manager          -> worker, checker
 *   worker/checker   -> nobody
 *
 * `admin` is creatable by NOBODY, admins included -- unchanged, and
 * re-confirmed with the amendment.
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
  // Owner decision (2026-09-02): an admin may create ANY non-admin role
  // directly. RULE A's one-level-down chain was written for a fully staffed
  // hierarchy; in practice few people know the system yet, so the admin has
  // to open accounts for everyone. The chain still governs everyone else --
  // a regional manager creates managers, a manager creates workers/checkers
  // -- so this widens exactly one actor and nothing else.
  //
  // `admin` remains creatable by NOBODY, admins included (owner decision,
  // confirmed 2026-09-02): an admin account is unscoped and can delete any
  // other, so minting one stays a deliberate out-of-band act rather than a
  // form submission.
  admin: Object.freeze(['regional_manager', 'manager', 'worker', 'checker'] as const),
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
 * The ORIGINAL one-level-down chain, unaffected by the 2026-09-02 amendment.
 *
 * Creation authority and review routing were the same question until the
 * admin was allowed to create every role; they are not the same question any
 * more. getReviewQueue routes an application to "whoever created it" only
 * when that person outranks the applicant by exactly one level -- which is
 * what makes creator-routing safe (no peer approvals, nobody reviewing
 * themselves) and what keeps a worker's application in front of their hotel's
 * MANAGER rather than the admin.
 *
 * Without this split, widening creation re-created the exact complaint the
 * review-queue routing was built to fix: "why is admin seeing all the review
 * requests". An admin opening accounts for everyone would have become the
 * reviewer for all of them.
 */
const ONE_LEVEL_DOWN: Readonly<Record<PlatformRole, readonly PlatformRole[]>> = Object.freeze({
  admin: Object.freeze(['regional_manager'] as const),
  regional_manager: Object.freeze(['manager'] as const),
  manager: Object.freeze(['worker', 'checker'] as const),
  checker: Object.freeze([] as const),
  worker: Object.freeze([] as const),
});

/**
 * Whether `actorRole` sits exactly one level above `targetRole` in the
 * original hierarchy. Deny-by-default on any unrecognized role, same as
 * canCreateRole.
 *
 * Use this for questions about RANK ("may this person review that one?").
 * Use canCreateRole for questions about PERMISSION ("may this person create
 * that account?"). They diverged deliberately -- see ONE_LEVEL_DOWN.
 */
export function isExactlyOneLevelAbove(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  const actor = asPlatformRole(actorRole);
  const target = asPlatformRole(targetRole);
  if (!actor || !target) return false;
  return ONE_LEVEL_DOWN[actor].includes(target);
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
