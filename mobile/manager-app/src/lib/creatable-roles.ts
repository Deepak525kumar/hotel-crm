/**
 * Which roles this actor may create — RULE A, mirrored for the UI only.
 *
 * The authority is `backend/src/lib/role-hierarchy.ts` (owner decision
 * 2026-08-12, amended 2026-09-02), and `canCreateRole` enforces it on every
 * request. This exists so the form does not offer a choice the server will
 * refuse; it is NEVER the gate.
 *
 * Pinned against the real module by `creatable-roles.test.ts`, which imports
 * it rather than restating it — the same reason `capability-map.test.ts`
 * imports the real ROLE_PERMISSIONS. A hand-copied hierarchy that drifts
 * would offer a manager the ability to mint a manager, and the refusal would
 * arrive as a 403 they cannot act on.
 *
 * Two consequences that surprise readers of the older ADRs, both deliberate:
 * nobody may create an `admin`, admins included; and an admin may create
 * every other role directly, because the hierarchy is not yet staffed.
 */
const CREATABLE: Record<string, readonly string[]> = {
  admin: ['regional_manager', 'manager', 'worker', 'checker'],
  regional_manager: ['manager'],
  manager: ['worker', 'checker'],
  worker: [],
  checker: [],
};

export function creatableRoles(actorRole: string | null | undefined): readonly string[] {
  if (!actorRole) return [];
  return CREATABLE[actorRole] ?? [];
}

/** A manager placing a worker needs a hotel; an RM creating a manager needs a group. */
export function scopeFieldFor(targetRole: string): 'hotel' | 'group' | null {
  if (targetRole === 'worker' || targetRole === 'checker') return 'hotel';
  if (targetRole === 'manager') return 'hotel';
  if (targetRole === 'regional_manager') return 'group';
  return null;
}
