import { ALLOWED_ROLES, PUSH_APP } from '@/constants/app-config';
// The REAL permission matrix, imported from the backend rather than restated.
import { ROLE_PERMISSIONS } from '../../../../backend/src/config/constants';

/**
 * Pins this app's role list against the backend's own ROLE_PERMISSIONS.
 *
 * Imported, never fabricated. A chatbot tool once required a permission token
 * the WORKER role does not hold and would have denied every worker in
 * production, while 100+ tests passed -- because the tests invented the
 * permission. A green suite built on invented permissions proves only that
 * the code agrees with itself.
 *
 * This is a client convenience, not the security boundary: every endpoint
 * re-derives authorization server-side. It exists so the app does not render
 * a door that the server will slam.
 */
describe('capability map', () => {
  it('every role this app admits actually exists in the backend matrix', () => {
    for (const role of ALLOWED_ROLES) {
      const key = role.toUpperCase() as keyof typeof ROLE_PERMISSIONS;
      expect(ROLE_PERMISSIONS[key]).toBeDefined();
    }
  });

  // ADR-030 D-5: RM is MANAGER's set plus exactly one token. If that ever
  // stops being true, this app's single shared navigation is wrong and the
  // screens need to diverge -- so the assumption is pinned rather than
  // assumed.
  it('regional_manager is manager’s set plus exactly org_chart:read', () => {
    const manager = [...ROLE_PERMISSIONS.MANAGER].sort();
    const rm = [...ROLE_PERMISSIONS.REGIONAL_MANAGER].sort();
    const extra = rm.filter((p) => !manager.includes(p));
    const missing = manager.filter((p) => !rm.includes(p));

    expect(extra).toEqual(['org_chart:read']);
    expect(missing).toEqual([]);
  });

  // Quality is Checker-only (ADR-030 C-27). A manager reads inspections and
  // never writes one, so no screen in this app may offer a rating affordance.
  it('neither manager nor regional_manager holds quality:write', () => {
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('quality:write');
    expect(ROLE_PERMISSIONS.REGIONAL_MANAGER).not.toContain('quality:write');
  });

  // Master data is Admin-only (ADR-030 D-3).
  it('neither manager nor regional_manager holds hotels:write', () => {
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('hotels:write');
    expect(ROLE_PERMISSIONS.REGIONAL_MANAGER).not.toContain('hotels:write');
  });

  it('registers push as its own app, never as WORKER or CHECKER', () => {
    // A manager token answering another app's APNs topic gets
    // DeviceTokenNotForTopic on every send.
    expect(PUSH_APP).toBe('MANAGER');
  });
});
