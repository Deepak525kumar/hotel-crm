import { creatableRoles } from '@/lib/creatable-roles';
// The REAL authority, imported rather than restated.
import { creatableRolesFor } from '../../../../backend/src/lib/role-hierarchy';

/**
 * The client's role list must equal RULE A's, exactly.
 *
 * `backend/src/lib/role-hierarchy.ts` is the authority (owner decision
 * 2026-08-12, amended 2026-09-02) and `canCreateRole` enforces it on every
 * request. The client mirrors it only so the form does not offer a choice the
 * server will refuse.
 *
 * A hand-copied hierarchy that drifts is worse than none: it would offer a
 * manager the ability to mint another manager, and the refusal arrives as a
 * 403 the manager cannot act on. So this imports the real module — the same
 * reason capability-map.test.ts imports the real ROLE_PERMISSIONS rather than
 * fabricating one.
 *
 * RULE A also contradicts ADR-065 and ADR-030 §3 C-15, in opposite
 * directions, knowingly: the owner ratified it with the amendments owed and
 * tracked. This test pins the code, which is the authority trail until those
 * amendments exist.
 */
describe('creatable roles mirror RULE A', () => {
  it.each(['admin', 'regional_manager', 'manager', 'worker', 'checker'])(
    '%s matches the backend exactly',
    (actor) => {
      expect([...creatableRoles(actor)].sort()).toEqual([...creatableRolesFor(actor)].sort());
    }
  );

  // Stated separately because it is the consequence most likely to be
  // "corrected" by someone reading the older ADRs.
  it('nobody creates an admin, admins included', () => {
    for (const actor of ['admin', 'regional_manager', 'manager', 'worker', 'checker']) {
      expect(creatableRoles(actor)).not.toContain('admin');
    }
  });

  it('a worker and a checker create nobody', () => {
    expect(creatableRoles('worker')).toEqual([]);
    expect(creatableRoles('checker')).toEqual([]);
  });

  it('an unknown or absent actor creates nobody, rather than defaulting in', () => {
    expect(creatableRoles(null)).toEqual([]);
    expect(creatableRoles('kiosk')).toEqual([]);
  });
});
