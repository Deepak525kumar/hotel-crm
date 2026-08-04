import { describe, it, expect } from '@jest/globals';
import { ROLE_PERMISSIONS } from '../config/constants.js';

/**
 * ADR-031 D-1 / C-6 (unconditional as of PR-7): ROLE_PERMISSIONS is consulted
 * on every request path (authMiddleware), so an unfrozen array is a live
 * authorization-integrity risk, not just a write-time hygiene concern. This
 * pins the freeze independent review found incomplete: MANAGER_PERMISSIONS
 * was already frozen, but ADMIN/CHECKER/WORKER's literals and the outer map
 * were not.
 */
describe('ROLE_PERMISSIONS immutability (ADR-031 D-1/C-6)', () => {
  it('the outer map is frozen — a role cannot be reassigned to a different array', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    expect(() => {
      (ROLE_PERMISSIONS as Record<string, string[]>).ADMIN = ['new:token'];
    }).toThrow(TypeError);
  });

  it('the outer map cannot gain a new role key', () => {
    expect(() => {
      (ROLE_PERMISSIONS as Record<string, string[]>).SUPERUSER = ['admin:*'];
    }).toThrow(TypeError);
  });

  it.each(Object.keys(ROLE_PERMISSIONS))('%s\'s permission array is frozen', (role) => {
    expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
  });

  it.each(Object.keys(ROLE_PERMISSIONS))('%s\'s permission array cannot be mutated in place', (role) => {
    expect(() => {
      ROLE_PERMISSIONS[role].push('should:not-append');
    }).toThrow(TypeError);
  });

  // Previously asserted `MANAGER === REGIONAL_MANAGER` by reference. ADR-060 /
  // ADR-030 §3 C-33 grants RM `org_chart:read` and Manager `✗` (CRR §1:23 — the
  // org chart is visible ONLY to Regional Manager and Admin), so the two sets
  // are deliberately no longer identical. What still matters is the containment
  // relation D-5 states: RM holds every Manager token, plus org-chart, and no
  // MASTER-data token.
  it('REGIONAL_MANAGER is a strict superset of MANAGER (ADR-030 D-5)', () => {
    for (const token of ROLE_PERMISSIONS.MANAGER) {
      expect(ROLE_PERMISSIONS.REGIONAL_MANAGER).toContain(token);
    }
    expect(ROLE_PERMISSIONS.REGIONAL_MANAGER.length).toBeGreaterThan(
      ROLE_PERMISSIONS.MANAGER.length
    );
  });

  it('REGIONAL_MANAGER\'s only addition over MANAGER is org_chart:read (ADR-060, C-33)', () => {
    const extra = ROLE_PERMISSIONS.REGIONAL_MANAGER.filter(
      (t) => !ROLE_PERMISSIONS.MANAGER.includes(t)
    );
    expect(extra).toEqual(['org_chart:read']);
  });

  it('MANAGER does not hold org_chart:read (C-33 is RM + Admin only)', () => {
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('org_chart:read');
  });

  // The arrays are distinct objects now, so the aliasing footgun the original
  // reference assertion guarded against is gone — but both must stay frozen
  // (covered by the it.each cases above) so neither can be mutated into the
  // other's shape.
  it('MANAGER and REGIONAL_MANAGER are distinct frozen arrays', () => {
    expect(ROLE_PERMISSIONS.MANAGER).not.toBe(ROLE_PERMISSIONS.REGIONAL_MANAGER);
    expect(Object.isFrozen(ROLE_PERMISSIONS.MANAGER)).toBe(true);
    expect(Object.isFrozen(ROLE_PERMISSIONS.REGIONAL_MANAGER)).toBe(true);
  });
});
