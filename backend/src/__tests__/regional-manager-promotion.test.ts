import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for ADR-030 M-3 (scripts/regional-manager-promotion.ts).
 * Locks: only current-MANAGER regional managers are promoted (idempotent),
 * and the update and its AuditLog snapshot happen inside one transaction.
 * User.permissions is no longer read or written here — the column was
 * dropped by ADR-031 M-3/PR-7.
 *
 * Race/deadlock fix (review follow-up on #339, deferred there, closed here):
 * the ownership check now runs INSIDE a per-group `$transaction(async (tx) =>
 * ...)` callback, after a `SELECT ... FOR UPDATE` row lock on the candidate
 * user — the identical shape `regional-manager-demotion.test.ts` uses, with
 * the identical lock order (User row, then the group re-read).  `makePrisma`
 * below reflects that: `$transaction` invokes the real callback against a
 * `tx` that shares this file's mocks, and `$queryRaw` is mocked to resolve
 * with no assertions of its own — the lock has no observable effect against
 * a mock with no real concurrent transaction to block.
 */

import { promoteRegionalManagers } from '../scripts/regional-manager-promotion.js';

function makePrisma({
  groups,
  users,
}: {
  groups: Array<{ id: string; regional_manager_user_id: string }>;
  users: Record<string, { id: string; role: string }>;
}) {
  const userUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const auditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const queryRaw = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]);

  const hotelGroupFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  hotelGroupFindMany.mockResolvedValue(groups);
  // hotelGroup.findUnique re-reads the group's CURRENT regional_manager_user_id
  // under the lock — defaults to the same snapshot findMany returned, so tests
  // that don't care about the race can override just `users` and get the
  // pre-existing behavior; the race-closure test below overrides this directly.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const hotelGroupFindUnique = jest.fn(async ({ where }: any) => groupById.get(where.id) ?? null) as jest.MockedFunction<
    (...args: any[]) => any
  >;

  const userFindUnique = jest.fn(async ({ where }: any) => users[where.id] ?? null) as jest.MockedFunction<
    (...args: any[]) => any
  >;

  const prisma: any = {
    hotelGroup: { findMany: hotelGroupFindMany, findUnique: hotelGroupFindUnique },
    user: {
      findUnique: userFindUnique,
      update: userUpdate,
    },
    auditLog: { create: auditLogCreate },
    $queryRaw: queryRaw,
  };
  // Genuinely invokes the callback against `prisma` itself as `tx` — not a
  // no-op stub — so the transaction body's actual logic (lock, re-read,
  // check, branch, write) runs for real in these tests.
  prisma.$transaction = jest.fn((arg: unknown) => (arg as (tx: unknown) => Promise<unknown>)(prisma)) as jest.MockedFunction<
    (...args: any[]) => any
  >;

  return { prisma, userUpdate, auditLogCreate, queryRaw, hotelGroupFindUnique, groupById, transaction: prisma.$transaction };
}

describe('promoteRegionalManagers (ADR-030 M-3)', () => {
  it('promotes a MANAGER referenced as a group RM to REGIONAL_MANAGER', async () => {
    const { prisma, userUpdate, auditLogCreate, transaction } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'MANAGER' } },
    });

    const result = await promoteRegionalManagers(prisma);

    expect(result.promoted).toEqual([{ user_id: 'u1', hotel_group_id: 'g1' }]);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'REGIONAL_MANAGER' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PROMOTE_REGIONAL_MANAGER',
          resource_id: 'u1',
          old_values: { role: 'MANAGER' },
        }),
      })
    );
    // Callback-form transaction (not array-form): one $transaction call per
    // group, running the lock-reread-check-write sequence as a single unit.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — skips a user already promoted to REGIONAL_MANAGER', async () => {
    const { prisma, userUpdate } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'REGIONAL_MANAGER' } },
    });

    const result = await promoteRegionalManagers(prisma);

    expect(result.promoted).toEqual([]);
    expect(result.skippedAlreadyPromoted).toBe(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('skips a group whose regional_manager_user_id resolves to no user', async () => {
    const { prisma, userUpdate } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'ghost' }],
      users: {},
    });

    const result = await promoteRegionalManagers(prisma);

    expect(result.promoted).toEqual([]);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('skips a group that no longer exists by the time the transaction runs', async () => {
    const { prisma, userUpdate, hotelGroupFindUnique } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'MANAGER' } },
    });
    hotelGroupFindUnique.mockResolvedValueOnce(null);

    const result = await promoteRegionalManagers(prisma);

    expect(result.promoted).toEqual([]);
    expect(result.skippedAlreadyPromoted).toBe(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  // Race-closure test: simulates a concurrent transfer that reassigned the
  // group to a DIFFERENT manager between the outer findMany snapshot and this
  // transaction acquiring its lock. The re-read under lock must see the NEW
  // manager (u2, still MANAGER) — not promote u1 based on the stale snapshot,
  // and correctly promote u2 instead since u2 is the group's real current RM.
  it('re-reads the group\'s CURRENT regional manager under lock, not the stale outer snapshot', async () => {
    const { prisma, userUpdate, groupById } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: {
        u1: { id: 'u1', role: 'MANAGER' },
        u2: { id: 'u2', role: 'MANAGER' },
      },
    });
    // Simulate the concurrent transfer: by the time the transaction's
    // re-read runs, the group now points at u2, not the u1 the outer
    // findMany snapshot captured.
    groupById.set('g1', { id: 'g1', regional_manager_user_id: 'u2' });

    const result = await promoteRegionalManagers(prisma);

    expect(result.promoted).toEqual([{ user_id: 'u2', hotel_group_id: 'g1' }]);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u2' }, data: { role: 'REGIONAL_MANAGER' } });
  });

  it('locks the candidate user row before re-reading group ownership (deadlock-avoidance lock order)', async () => {
    const callOrder: string[] = [];
    const { prisma } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'MANAGER' } },
    });
    prisma.$queryRaw.mockImplementation(async () => {
      callOrder.push('user-lock');
      return [];
    });
    const originalFindUnique = prisma.hotelGroup.findUnique;
    prisma.hotelGroup.findUnique = jest.fn(async (...args: any[]) => {
      callOrder.push('hotelgroup-reread');
      return originalFindUnique(...args);
    });

    await promoteRegionalManagers(prisma);

    expect(callOrder).toEqual(['user-lock', 'hotelgroup-reread']);
  });
});
