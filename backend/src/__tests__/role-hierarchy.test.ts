import { describe, it, expect } from '@jest/globals';
import {
  PLATFORM_ROLES,
  canCreateRole,
  creatableRolesFor,
  asPlatformRole,
  createRoleDenialMessage,
  isExactlyOneLevelAbove,
  type PlatformRole,
} from '../lib/role-hierarchy.js';

/**
 * RULE A — "create is 1-level-down only" (project-owner decision, 2026-08-12).
 *
 * Unit-level, exhaustive coverage of the policy primitive itself: EVERY
 * (actor_role, target_role) pair in the 5x5 matrix is asserted explicitly,
 * with the expected outcome written out as a literal table rather than
 * derived from `creatableRolesFor` (which is one of the functions under
 * test). Deriving expectations from the implementation is exactly the flaw
 * `capability-policy.test.ts`'s own header calls out in
 * `route-role-matrix.test.ts` — both sides of the assertion would move
 * together and the suite could not detect a policy change.
 *
 * The HTTP-level enforcement of this rule lives in
 * `create-hierarchy-authz.test.ts` (routes + service). This file pins the
 * decision table; that one pins that the decision is actually consulted.
 */

/**
 * The ratified table, transcribed by hand from the owner's decision:
 *
 *   admin            -> regional_manager ONLY
 *   regional_manager -> manager ONLY
 *   manager          -> worker, checker ONLY
 *   worker           -> nobody
 *   checker          -> nobody
 */
const RATIFIED: Record<PlatformRole, readonly PlatformRole[]> = {
  // AMENDED 2026-09-02 (same project-owner authority as RULE A itself): the
  // admin may create any non-admin role directly, because the hierarchy is
  // not yet staffed and the admin has to open accounts for everyone. Every
  // other actor is still bound to one level down, and `admin` is still a
  // target for nobody -- both asserted below.
  admin: ['regional_manager', 'manager', 'worker', 'checker'],
  regional_manager: ['manager'],
  manager: ['worker', 'checker'],
  worker: [],
  checker: [],
};

describe('RULE A — create is 1-level-down only (lib/role-hierarchy)', () => {
  it('covers all five platform roles with no gaps or duplicates', () => {
    expect(new Set(PLATFORM_ROLES).size).toBe(PLATFORM_ROLES.length);
    expect([...PLATFORM_ROLES].sort()).toEqual(
      ['admin', 'checker', 'manager', 'regional_manager', 'worker'].sort()
    );
    expect(Object.keys(RATIFIED).sort()).toEqual([...PLATFORM_ROLES].sort());
  });

  // ---------------------------------------------------------------------
  // The full 5x5 matrix: 25 explicit (actor, target) decisions.
  // ---------------------------------------------------------------------
  describe('every (actor_role, target_role) pair', () => {
    for (const actor of PLATFORM_ROLES) {
      for (const target of PLATFORM_ROLES) {
        const expected = RATIFIED[actor].includes(target);
        it(`${actor} -> ${target} = ${expected ? 'ALLOW' : 'DENY'}`, () => {
          expect(canCreateRole(actor, target)).toBe(expected);
        });
      }
    }
  });

  // ---------------------------------------------------------------------
  // Named properties of the rule, asserted independently of the matrix
  // above so a wrong table edit fails twice rather than passing quietly.
  // ---------------------------------------------------------------------
  describe('invariants', () => {
    it('nobody may create an admin — admin is one level below nothing', () => {
      for (const actor of PLATFORM_ROLES) {
        expect(canCreateRole(actor, 'admin')).toBe(false);
      }
    });

    it('nobody may create their own role (no peer creation)', () => {
      for (const role of PLATFORM_ROLES) {
        expect(canCreateRole(role, role)).toBe(false);
      }
    });

    it('worker and checker may create nobody at all', () => {
      for (const actor of ['worker', 'checker'] as const) {
        expect(creatableRolesFor(actor)).toEqual([]);
        for (const target of PLATFORM_ROLES) {
          expect(canCreateRole(actor, target)).toBe(false);
        }
      }
    });

    it('each creating role grants exactly the ratified target set', () => {
      expect([...creatableRolesFor('admin')].sort()).toEqual([
        'checker',
        'manager',
        'regional_manager',
        'worker',
      ]);
      expect([...creatableRolesFor('regional_manager')]).toEqual(['manager']);
      expect([...creatableRolesFor('manager')].sort()).toEqual(['checker', 'worker']);
    });

    // The one-level-down rule still binds every actor EXCEPT the admin
    // (amended 2026-09-02). Keeping this assertion for the other roles is the
    // point: widening the admin must not quietly widen anyone else, and a
    // regional manager reaching a worker is the specific over-reach it guards.
    it('no role except admin may create more than one level down', () => {
      expect(canCreateRole('regional_manager', 'worker')).toBe(false);
      expect(canCreateRole('regional_manager', 'checker')).toBe(false);
      expect(canCreateRole('manager', 'regional_manager')).toBe(false);
    });

    // The amendment's own boundary: the admin gained every non-admin role and
    // nothing more. `admin` remains a target for nobody, admins included.
    it('grants the admin every non-admin role, and admin to nobody', () => {
      expect(canCreateRole('admin', 'regional_manager')).toBe(true);
      expect(canCreateRole('admin', 'manager')).toBe(true);
      expect(canCreateRole('admin', 'worker')).toBe(true);
      expect(canCreateRole('admin', 'checker')).toBe(true);
      expect(canCreateRole('admin', 'admin')).toBe(false);
      for (const actor of PLATFORM_ROLES) {
        expect(canCreateRole(actor, 'admin')).toBe(false);
      }
    });

    it('no role may create upward', () => {
      expect(canCreateRole('regional_manager', 'admin')).toBe(false);
      expect(canCreateRole('manager', 'regional_manager')).toBe(false);
      expect(canCreateRole('worker', 'manager')).toBe(false);
      expect(canCreateRole('checker', 'manager')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Untrusted input: `role` originates in a JWT claim and may hold anything.
  // ---------------------------------------------------------------------
  describe('deny-by-default on unrecognized input', () => {
    it.each([
      ['unknown actor role', 'superadmin', 'worker'],
      ['unknown target role', 'admin', 'superadmin'],
      ['both unknown', 'root', 'root'],
      ['empty actor', '', 'worker'],
      ['empty target', 'admin', ''],
    ])('denies %s', (_label, actor, target) => {
      expect(canCreateRole(actor, target)).toBe(false);
    });

    it.each([[null], [undefined]])('denies a %s actor or target', (value) => {
      expect(canCreateRole(value as unknown as string, 'worker')).toBe(false);
      expect(canCreateRole('admin', value as unknown as string)).toBe(false);
    });

    it('creatableRolesFor returns empty (never a default role) for unrecognized input', () => {
      expect(creatableRolesFor('superadmin')).toEqual([]);
      expect(creatableRolesFor(null)).toEqual([]);
      expect(creatableRolesFor(undefined)).toEqual([]);
      expect(creatableRolesFor('')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // Casing: `User.role` is the UPPERCASE Prisma enum, `AuthContext.role` is
  // the lowercase JWT claim. Both enforcement sites compare across that
  // boundary, so the normalization is load-bearing, not cosmetic.
  // ---------------------------------------------------------------------
  describe('role-casing normalization (Prisma UPPERCASE vs JWT lowercase)', () => {
    it('accepts the Prisma enum casing on either side', () => {
      expect(canCreateRole('admin', 'REGIONAL_MANAGER')).toBe(true);
      expect(canCreateRole('ADMIN', 'regional_manager')).toBe(true);
      expect(canCreateRole('MANAGER', 'WORKER')).toBe(true);
      expect(canCreateRole('MANAGER', 'CHECKER')).toBe(true);
      expect(canCreateRole('REGIONAL_MANAGER', 'MANAGER')).toBe(true);
    });

    it('still denies across casings (normalization does not widen the rule)', () => {
      // ADMIN -> WORKER moved to the ALLOW list with the 2026-09-02
      // amendment, so the denials asserted here are the ones that must
      // survive it: a role reaching sideways, a role reaching itself, and
      // `admin` as a target.
      expect(canCreateRole('REGIONAL_MANAGER', 'WORKER')).toBe(false);
      expect(canCreateRole('MANAGER', 'MANAGER')).toBe(false);
      expect(canCreateRole('WORKER', 'WORKER')).toBe(false);
      expect(canCreateRole('ADMIN', 'ADMIN')).toBe(false);
    });

    it('asPlatformRole normalizes known roles and rejects everything else', () => {
      expect(asPlatformRole('ADMIN')).toBe('admin');
      expect(asPlatformRole('Regional_Manager')).toBe('regional_manager');
      expect(asPlatformRole('superadmin')).toBeNull();
      expect(asPlatformRole('')).toBeNull();
      expect(asPlatformRole(null)).toBeNull();
    });
  });

  describe('denial message', () => {
    it('names the roles the actor MAY create', () => {
      expect(createRoleDenialMessage('admin', 'worker')).toContain('regional_manager');
      expect(createRoleDenialMessage('manager', 'admin')).toContain('worker');
      expect(createRoleDenialMessage('manager', 'admin')).toContain('checker');
    });

    it('says plainly that a worker/checker may create nobody', () => {
      expect(createRoleDenialMessage('worker', 'worker')).toMatch(/may not create users/);
      expect(createRoleDenialMessage('checker', 'worker')).toMatch(/may not create users/);
    });
  });

  // The policy table must not be mutable at runtime: a caller that could push
  // onto the returned array would widen authorization for every later caller
  // in the process.
  // Creation authority and RANK were the same question until the admin was
  // allowed to create every role. They must not be conflated again: the
  // review queue routes an application to its creator only when that person
  // outranks the applicant by exactly one level, and routing on creation
  // permission instead would have made the admin the reviewer for every
  // account they opened -- the "why is admin seeing all the review requests"
  // complaint that routing exists to fix.
  describe('rank is separate from creation permission (2026-09-02 amendment)', () => {
    it('keeps the original one-level chain for rank', () => {
      expect(isExactlyOneLevelAbove('admin', 'regional_manager')).toBe(true);
      expect(isExactlyOneLevelAbove('regional_manager', 'manager')).toBe(true);
      expect(isExactlyOneLevelAbove('manager', 'worker')).toBe(true);
      expect(isExactlyOneLevelAbove('manager', 'checker')).toBe(true);
    });

    it('does not treat the admin as one level above manager/worker/checker', () => {
      // Precisely the pairs canCreateRole now allows -- so a test that used
      // one for the other would pass by accident.
      expect(canCreateRole('admin', 'manager')).toBe(true);
      expect(isExactlyOneLevelAbove('admin', 'manager')).toBe(false);
      expect(canCreateRole('admin', 'worker')).toBe(true);
      expect(isExactlyOneLevelAbove('admin', 'worker')).toBe(false);
      expect(canCreateRole('admin', 'checker')).toBe(true);
      expect(isExactlyOneLevelAbove('admin', 'checker')).toBe(false);
    });

    it('denies by default on unknown or upward pairs', () => {
      expect(isExactlyOneLevelAbove('superadmin', 'worker')).toBe(false);
      expect(isExactlyOneLevelAbove('worker', 'manager')).toBe(false);
      expect(isExactlyOneLevelAbove(null, 'worker')).toBe(false);
      expect(isExactlyOneLevelAbove('manager', 'manager')).toBe(false);
    });
  });

  it('the returned target list is frozen (policy cannot be widened at runtime)', () => {
    // `worker` is admin's legitimately now (2026-09-02), so the widening this
    // guards against is pushing `admin` -- the one target the amendment
    // deliberately did NOT grant.
    const targets = creatableRolesFor('admin');
    expect(Object.isFrozen(targets)).toBe(true);
    expect(() => (targets as PlatformRole[]).push('admin')).toThrow();
    expect(canCreateRole('admin', 'admin')).toBe(false);

    // The narrower lists must stay closed too.
    const rmTargets = creatableRolesFor('regional_manager');
    expect(Object.isFrozen(rmTargets)).toBe(true);
    expect(() => (rmTargets as PlatformRole[]).push('worker')).toThrow();
    expect(canCreateRole('regional_manager', 'worker')).toBe(false);
  });
});
