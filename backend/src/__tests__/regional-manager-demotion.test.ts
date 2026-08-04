import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for the demote path (Regional Manager V1 Decision 6/11).
 * Mirrors regional-manager-promotion.test.ts's makePrisma/expectAtomicBatch
 * shape. Locks: only REGIONAL_MANAGER users with zero owned hotel groups are
 * demoted (idempotent, Decision-11-safe), and the update and its AuditLog
 * snapshot happen inside one transaction.
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
  const transaction = jest.fn(async (ops: any[]) => {
    for (const op of ops) await op;
  }) as jest.MockedFunction<(...args: any[]) => any>;

  const userFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  userFindMany.mockResolvedValue(regionalManagers);
  const hotelGroupFindUnique = jest.fn(async ({ where }: any) =>
    ownedGroupByUserId[where.regional_manager_user_id] ?? null
  ) as jest.MockedFunction<(...args: any[]) => any>;

  const prisma = {
    user: { findMany: userFindMany, update: userUpdate },
    hotelGroup: { findUnique: hotelGroupFindUnique },
    auditLog: { create: auditLogCreate },
    $transaction: transaction,
  } as any;

  return { prisma, userUpdate, auditLogCreate, transaction };
}

function expectAtomicBatch(transaction: jest.MockedFunction<(...args: any[]) => any>, callIndex: number): void {
  const args = transaction.mock.calls[callIndex];
  expect(args).toBeDefined();
  const ops = args![0];
  expect(Array.isArray(ops)).toBe(true);
  expect(ops).toHaveLength(2);
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
    expect(transaction).toHaveBeenCalledTimes(1);
    expectAtomicBatch(transaction, 0);
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
