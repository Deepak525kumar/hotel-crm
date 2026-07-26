import { describe, it, expect } from '@jest/globals';
import { ROLE_PERMISSIONS } from '../config/constants.js';

/**
 * ADR-031 D-1 / C-6 (PR-3): once ROLE_PERMISSIONS is consulted on the request
 * path (authMiddleware, when FEATURE_DERIVED_PERMISSIONS is on), an
 * unfrozen array becomes a live authorization-integrity risk, not just a
 * write-time hygiene concern. This pins the freeze independent review found
 * incomplete: MANAGER_PERMISSIONS was already frozen, but ADMIN/CHECKER/
 * WORKER's literals and the outer map were not.
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

  it('MANAGER and REGIONAL_MANAGER share the same frozen array by reference (unchanged intent)', () => {
    expect(ROLE_PERMISSIONS.MANAGER).toBe(ROLE_PERMISSIONS.REGIONAL_MANAGER);
  });
});
