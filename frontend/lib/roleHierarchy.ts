import type { Role } from "@/lib/types";

/**
 * RULE A — "create is 1-level-down only" (project-owner decision, 2026-08-12).
 *
 * Mirrors `backend/src/lib/role-hierarchy.ts` exactly:
 *
 *   admin            -> regional_manager, manager, worker, checker (2026-09-02)
 *   regional_manager -> manager ONLY
 *   manager          -> worker, checker ONLY
 *   worker/checker   -> nobody
 *
 * This is a UI AFFORDANCE, not the boundary. The backend enforces the same
 * table at the route and service layer (`users/service.ts#createUser`,
 * `employee-management/service.ts#createEmployee`) and remains the
 * authoritative decision point — the same split every other gate in
 * `components/auth/RoleGate.tsx` documents. It exists so the form does not
 * offer a role whose submission would just 403, not so the check can be
 * skipped server-side.
 *
 * Kept as a duplicated table rather than fetched from an endpoint because no
 * capability endpoint exists today and inventing one for this is out of scope.
 * That makes drift possible: if the backend table changes, THIS FILE must
 * change with it. The two are cross-referenced in both directions for that
 * reason.
 */
const CREATABLE_ROLES: Readonly<Record<Role, readonly Role[]>> = Object.freeze({
  // Owner decision (2026-09-02): the admin may create ANY non-admin role
  // directly. RULE A's one-level-down chain assumed a staffed hierarchy; in
  // practice the admin has to open accounts for everyone. Mirrors
  // backend/src/lib/role-hierarchy.ts, which is the authority -- this copy
  // only decides which options the form offers.
  //
  // `admin` stays absent from every list, admins included: an admin account
  // is unscoped and can delete any other, so creating one remains a
  // deliberate out-of-band act.
  admin: Object.freeze([
    "regional_manager",
    "manager",
    "worker",
    "checker",
  ] as const),
  regional_manager: Object.freeze(["manager"] as const),
  manager: Object.freeze(["worker", "checker"] as const),
  checker: Object.freeze([] as const),
  worker: Object.freeze([] as const),
});

/**
 * The roles `actorRole` may create, in a stable order suitable for rendering
 * form options. Empty for worker/checker, for an unknown role, and for a
 * signed-out viewer (`undefined`) — callers must treat empty as "may create
 * nobody", never as "no restriction".
 */
export function creatableRolesFor(actorRole: Role | string | null | undefined): readonly Role[] {
  if (!actorRole) return [];
  return CREATABLE_ROLES[actorRole as Role] ?? [];
}

/** True when `actorRole` may create a user with `targetRole`. */
export function canCreateRole(
  actorRole: Role | string | null | undefined,
  targetRole: Role | string | null | undefined,
): boolean {
  if (!targetRole) return false;
  return creatableRolesFor(actorRole).includes(targetRole as Role);
}

/** True when `actorRole` may create anybody at all (gates "New user" entry points). */
export function canCreateAnyRole(actorRole: Role | string | null | undefined): boolean {
  return creatableRolesFor(actorRole).length > 0;
}
