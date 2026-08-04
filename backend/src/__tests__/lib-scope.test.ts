import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Direct unit tests for lib/scope.ts's list-filter primitives (ADR-030 PR-4).
 *
 * resolveNonAdminScopeFilter's whole reason to exist: `resolveScope()`
 * (auth/service.ts) only ever mints a `{type:'global'}` claim for role ===
 * 'admin', so a non-admin actor resolving to 'none' is an invariant
 * violation — a token/claim-issuance bug upstream, not a normal case. This
 * pins that it logs loudly and fails closed (deny) rather than silently
 * granting the same unrestricted access the FIND-01 fix exists to prevent.
 */

const mockErrorLog = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: mockErrorLog,
  },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotel: {
      findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : null }),
    },
  }),
}));

import {
  resolveNonAdminScopeFilter,
  resolveScopeGroupFilter,
  isScopedManagerRole,
  isSelfScopedRole,
} from '../lib/scope.js';

describe('resolveNonAdminScopeFilter (ADR-030 PR-4, security review FIND-01)', () => {
  beforeEach(() => {
    mockErrorLog.mockClear();
  });

  it('denies and logs when a non-admin actor somehow resolves to global scope', async () => {
    const result = await resolveNonAdminScopeFilter('manager', { type: 'global' });

    expect(result).toEqual({ kind: 'deny' });
    expect(mockErrorLog).toHaveBeenCalledWith(
      'Scope invariant violation: non-admin actor resolved to global scope',
      { actorRole: 'manager' }
    );
  });

  it('passes through a normal hotel_group scope without logging', async () => {
    const result = await resolveNonAdminScopeFilter('manager', { type: 'hotel_group', hotel_group_id: 'g1' });

    expect(result).toEqual({ kind: 'group', hotelGroupId: 'g1' });
    expect(mockErrorLog).not.toHaveBeenCalled();
  });

  it('denies without logging when there is simply no scope claim', async () => {
    const result = await resolveNonAdminScopeFilter('manager', null);

    expect(result).toEqual({ kind: 'deny' });
    expect(mockErrorLog).not.toHaveBeenCalled();
  });
});

describe('resolveScopeGroupFilter', () => {
  it('resolves a hotel-scoped claim to its hotel_group via lookup', async () => {
    const result = await resolveScopeGroupFilter({ type: 'hotel', hotel_id: 'h1' });
    expect(result).toEqual({ kind: 'group', hotelGroupId: 'g1' });
  });

  it('denies when the hotel-scoped claim resolves to no group', async () => {
    const result = await resolveScopeGroupFilter({ type: 'hotel', hotel_id: 'h_orphan' });
    expect(result).toEqual({ kind: 'deny' });
  });
});


/**
 * Direct unit coverage for the role-classification predicates.
 *
 * These became the platform's root of trust for scope classification: ~40
 * authorization sites across middleware and nine service modules now branch on
 * them instead of comparing role strings inline. Every other suite exercises
 * them only INDIRECTLY (through a route or service), so a wrong result here
 * would surface as a scattering of confusing failures elsewhere — or, for a role
 * no suite covers, not at all. Pinned exhaustively and directly.
 *
 * The tables below enumerate EVERY value of prisma's UserRole enum, lowercased
 * as the JWT claim carries it, plus the untrusted-input cases: `role` is typed
 * `string` (lib/jwt.ts, AuthContext.role) because it arrives in a token claim
 * and may hold any value at all.
 */
describe('isScopedManagerRole (ADR-030 D-5 scope classification)', () => {
  it.each([
    ['manager', true],
    ['regional_manager', true],
    ['admin', false],
    ['checker', false],
    ['worker', false],
  ] as [string, boolean][])('%s -> %s', (role, expected) => {
    expect(isScopedManagerRole(role)).toBe(expected);
  });

  // A guard reading `isScopedManagerRole(role) === false` must treat that as
  // "not a scoped manager", never as "is a worker" — unknown/hostile claim
  // values land here and must not acquire manager scope.
  it.each(['', 'MANAGER', 'Manager', 'regional manager', 'regionalmanager', 'system', 'service_account', 'super_admin', 'undefined', 'null'])(
    'denies scoped-manager classification for untrusted claim value %p',
    (role) => {
      expect(isScopedManagerRole(role)).toBe(false);
    }
  );

  // Case sensitivity is load-bearing: resolveScope()/authMiddleware lowercase
  // the role before it reaches any guard, so an uppercase value here would mean
  // the claim bypassed that normalization.
  it('is case-sensitive — the JWT claim is lowercased upstream by design', () => {
    expect(isScopedManagerRole('REGIONAL_MANAGER')).toBe(false);
    expect(isScopedManagerRole('regional_manager')).toBe(true);
  });

  // Guards against the classification being re-derived from ROLE_PERMISSIONS:
  // admin holds a superset of every manager token (via admin:*) yet is NOT a
  // scope-bound manager — it is unrestricted. A permission-derived
  // implementation would get this backwards.
  it('does not classify admin as a scoped manager despite holding every manager token', () => {
    expect(isScopedManagerRole('admin')).toBe(false);
  });
});

describe('isSelfScopedRole (worker-fallback classification)', () => {
  it.each([
    ['worker', true],
    ['checker', true],
    ['admin', false],
    ['manager', false],
    ['regional_manager', false],
  ] as [string, boolean][])('%s -> %s (default opts)', (role, expected) => {
    expect(isSelfScopedRole(role)).toBe(expected);
  });

  // THE regression this predicate exists to prevent: the shape it replaced
  // (`role !== 'admin' && role !== 'manager'`) returned TRUE for
  // regional_manager, narrowing an RM to its own rows and returning 200 with
  // the wrong data. If this ever flips to true, geo/attendance/job-requests/
  // assignments all silently mis-scope an RM again.
  it('NEVER classifies regional_manager as self-scoped (the silent-narrowing defect)', () => {
    expect(isSelfScopedRole('regional_manager')).toBe(false);
    expect(isSelfScopedRole('regional_manager', { checkerIsSelfScoped: false })).toBe(false);
    expect(isSelfScopedRole('regional_manager', { checkerIsSelfScoped: true })).toBe(false);
  });

  // attendance/service.ts passes this because checker is cross-hotel there;
  // geo/service.ts relies on the default. Both must keep working.
  it('checkerIsSelfScoped:false makes checker non-self, leaving other roles unchanged', () => {
    expect(isSelfScopedRole('checker', { checkerIsSelfScoped: false })).toBe(false);
    expect(isSelfScopedRole('worker', { checkerIsSelfScoped: false })).toBe(true);
    expect(isSelfScopedRole('admin', { checkerIsSelfScoped: false })).toBe(false);
    expect(isSelfScopedRole('manager', { checkerIsSelfScoped: false })).toBe(false);
  });

  // Fails SAFE for untrusted input: an unrecognized claim value is narrowed to
  // its own records rather than granted management breadth. This is why the
  // predicate returns a boolean instead of exhaustively switching with
  // assertNever — role is untrusted string input, so there is no "impossible"
  // value to assert against, and throwing would turn a hostile token into a 500
  // where a narrowed 403/empty result is correct.
  it.each(['', 'system', 'service_account', 'super_admin', 'MANAGER', 'unknown_future_role'])(
    'treats untrusted claim value %p as self-scoped (fails safe, narrowest access)',
    (role) => {
      expect(isSelfScopedRole(role)).toBe(true);
    }
  );

  // Every real role lands in exactly one class: unrestricted (admin),
  // scope-bound manager, or self-scoped. No role may be in two, and none may be
  // in zero — a role falling through every class is how an authorization gap
  // starts.
  it('partitions the five real roles into exactly one class each', () => {
    for (const role of ['worker', 'checker', 'manager', 'regional_manager', 'admin']) {
      const classes = [
        role === 'admin',
        isScopedManagerRole(role),
        isSelfScopedRole(role, { checkerIsSelfScoped: true }),
      ].filter(Boolean);
      expect(classes).toHaveLength(1);
    }
  });
});
