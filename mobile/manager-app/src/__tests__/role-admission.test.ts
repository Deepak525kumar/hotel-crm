import { admit } from '@/lib/role-admission';
import { ALLOWED_ROLES } from '@/constants/app-config';

/**
 * Role admission, tested as a pure function.
 *
 * The 2026-08-25 mobile sweep found eight defects, five of them in `.tsx`
 * files that passed typecheck, because the logic was only reachable by
 * rendering a screen. Admission is extracted precisely so it is not one of
 * those.
 */
describe('role admission', () => {
  it.each(['manager', 'regional_manager', 'admin'] as const)('admits %s', (role) => {
    expect(admit({ role }).kind).toBe('admitted');
  });

  // Not a duplicate of the case above. This is the executable form of the bug
  // backend/CLAUDE.md says has broken ~40 sites: role gates are exact-match
  // strings, so `['manager','admin']` silently excludes regional_manager and
  // produces no error anywhere -- the RM just finds the door locked. ADR-030
  // D-5 makes RM a manager's full capability set at group scope, so wherever
  // manager is admitted, RM must be too.
  it('admits regional_manager wherever it admits manager', () => {
    expect(ALLOWED_ROLES).toContain('manager');
    expect(ALLOWED_ROLES).toContain('regional_manager');
  });

  it('sends a worker to their own app by name, not to an empty dashboard', () => {
    expect(admit({ role: 'worker' })).toEqual({ kind: 'wrong-app', role: 'worker', app: 'worker' });
  });

  it('sends a checker to their own app by name', () => {
    expect(admit({ role: 'checker' })).toEqual({
      kind: 'wrong-app',
      role: 'checker',
      app: 'checker',
    });
  });

  it('denies an unknown role rather than defaulting it in', () => {
    expect(admit({ role: 'kiosk' as never }).kind).toBe('denied');
  });

  it('denies a signed-out user', () => {
    expect(admit(null).kind).toBe('denied');
  });
});
