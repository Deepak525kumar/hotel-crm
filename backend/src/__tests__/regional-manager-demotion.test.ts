import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for the demote path (Regional Manager V1 Decision 6/11).
 * Locks: only REGIONAL_MANAGER users with zero owned hotel groups are
 * demoted (idempotent, Decision-11-safe), and the update and its AuditLog
 * snapshot happen inside one transaction.
 *
 * Race/deadlock fix (review follow-up on #339, second-review pass): the
 * ownership check now runs INSIDE a per-user `$transaction(async (tx) => ...)`
 * callback, after a `SELECT ... FOR UPDATE` row lock — the identical shape
 * `users/service.ts#updateUserRole` and `crm/service.ts#updateHotelGroup` use,
 * with the identical lock order (User row, then HotelGroup read). `makePrisma`
 * below reflects that: `$transaction` invokes the real callback against a `tx`
 * that shares this file's mocks (so `tx.user.update` etc. are observable), and
 * `$queryRaw` is mocked to resolve with no assertions of its own — the lock
 * has no observable effect against a mock with no real concurrent
 * transaction to block.
 */

import { demoteRegionalManagers } from '../scripts/regional-manager-demotion.js';

function makePrisma({
  regionalManagers,
  ownedGroupByUserId,
}: {
  regionalManagers: Array<{ id: string; role: string }>;
  ownedGroupByUserId: Record<string, { id: string } | undefined>;
}) {
  const userUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const auditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const queryRaw = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]);

  const userFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  userFindMany.mockResolvedValue(regionalManagers);
  const hotelGroupFindUnique = jest.fn(async ({ where }: any) =>
    ownedGroupByUserId[where.regional_manager_user_id] ?? null
  ) as jest.MockedFunction<(...args: any[]) => any>;

  const prisma: any = {
    user: { findMany: userFindMany, update: userUpdate },
    hotelGroup: { findUnique: hotelGroupFindUnique },
    auditLog: { create: auditLogCreate },
    $queryRaw: queryRaw,
  };
  // Genuinely invokes the callback against `prisma` itself as `tx` — not a
  // no-op stub — so the transaction body's actual logic (lock, check, branch,
  // write) runs for real in these tests, the same harness shape
  // users.test.ts/hotel-group.test.ts use for their own callback-form
  // transactions.
  prisma.$transaction = jest.fn((arg: unknown) => (arg as (tx: unknown) => Promise<unknown>)(prisma)) as jest.MockedFunction<
    (...args: any[]) => any
  >;

  return { prisma, userUpdate, auditLogCreate, queryRaw, transaction: prisma.$transaction };
}

describe('demoteRegionalManagers (Regional Manager V1 Decision 6/11)', () => {
  it('demotes a REGIONAL_MANAGER with no owned hotel group to MANAGER', async () => {
    const { prisma, userUpdate, auditLogCreate, transaction } = makePrisma({
      regionalManagers: [{ id: 'rm1', role: 'REGIONAL_MANAGER' }],
      ownedGroupByUserId: {},
    });

    const result = await demoteRegionalManagers(prisma);

    expect(result.demoted).toEqual(['rm1']);
    expect(result.skippedStillOwnsGroup).toBe(0);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'rm1' }, data: { role: 'MANAGER' } });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DEMOTE_REGIONAL_MANAGER',
          resource_id: 'rm1',
          old_values: { role: 'REGIONAL_MANAGER' },
          new_values: { role: 'MANAGER' },
        }),
      })
    );
    // Callback-form transaction (not array-form): one $transaction call per
    // user, running the lock-check-write sequence as a single unit.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('locks the user row before reading HotelGroup ownership (deadlock-avoidance lock order)', async () => {
    const callOrder: string[] = [];
    const { prisma } = makePrisma({
      regionalManagers: [{ id: 'rm1', role: 'REGIONAL_MANAGER' }],
      ownedGroupByUserId: {},
    });
    prisma.$queryRaw.mockImplementation(async () => {
      callOrder.push('user-lock');
      return [];
    });
    const originalFindUnique = prisma.hotelGroup.findUnique;
    prisma.hotelGroup.findUnique = jest.fn(async (...args: any[]) => {
      callOrder.push('hotelgroup-read');
      return originalFindUnique(...args);
    });

    await demoteRegionalManagers(prisma);

    expect(callOrder).toEqual(['user-lock', 'hotelgroup-read']);
  });

  // The core safety property: Decision 11 forbids demoting an RM who still
  // manages a group (a group must always have exactly one assigned RM). This
  // script must never bypass that guard — it should only ever act on rows the
  // live updateUserRole() guard would already permit.
  it('skips (does NOT demote) a REGIONAL_MANAGER who still owns a hotel group', async () => {
    const { prisma, userUpdate } = makePrisma({
      regionalManagers: [{ id: 'rm1', role: 'REGIONAL_MANAGER' }],
      ownedGroupByUserId: { rm1: { id: 'g1' } },
    });

    const result = await demoteRegionalManagers(prisma);

    expect(result.demoted).toEqual([]);
    expect(result.skippedStillOwnsGroup).toBe(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent — a mix of owned and unowned resolves each independently', async () => {
    const { prisma, userUpdate } = makePrisma({
      regionalManagers: [
        { id: 'rm_owns', role: 'REGIONAL_MANAGER' },
        { id: 'rm_free', role: 'REGIONAL_MANAGER' },
      ],
      ownedGroupByUserId: { rm_owns: { id: 'g1' } },
    });

    const result = await demoteRegionalManagers(prisma);

    expect(result.demoted).toEqual(['rm_free']);
    expect(result.skippedStillOwnsGroup).toBe(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'rm_free' }, data: { role: 'MANAGER' } });
  });

  it('no-ops cleanly when there are no REGIONAL_MANAGER users', async () => {
    const { prisma, userUpdate } = makePrisma({ regionalManagers: [], ownedGroupByUserId: {} });
    const result = await demoteRegionalManagers(prisma);
    expect(result.demoted).toEqual([]);
    expect(result.skippedStillOwnsGroup).toBe(0);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
