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

import { resolveNonAdminScopeFilter, resolveScopeGroupFilter } from '../lib/scope.js';

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
