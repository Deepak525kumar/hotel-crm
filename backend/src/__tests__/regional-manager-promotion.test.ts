import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for ADR-030 M-3 (scripts/regional-manager-promotion.ts).
 * Locks: only current-MANAGER regional managers are promoted (idempotent),
 * and the update and its AuditLog snapshot happen inside one transaction.
 * User.permissions is no longer read or written here — the column was
 * dropped by ADR-031 M-3/PR-7.
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
  const transaction = jest.fn(async (ops: any[]) => {
    for (const op of ops) await op;
  }) as jest.MockedFunction<(...args: any[]) => any>;

  const hotelGroupFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  hotelGroupFindMany.mockResolvedValue(groups);
  const userFindUnique = jest.fn(async ({ where }: any) => users[where.id] ?? null) as jest.MockedFunction<
    (...args: any[]) => any
  >;

  const prisma = {
    hotelGroup: { findMany: hotelGroupFindMany },
    user: {
      findUnique: userFindUnique,
      update: userUpdate,
    },
    auditLog: { create: auditLogCreate },
    $transaction: transaction,
  } as any;

  return { prisma, userUpdate, auditLogCreate, transaction };
}

/**
 * Asserts the role update and its AuditLog snapshot were submitted as ONE
 * `$transaction([...])` batch, not merely that both eventually ran.
 *
 * The mock above resolves each op it is handed, so a script rewritten to call
 * `user.update(...)` and `auditLog.create(...)` sequentially — losing atomicity
 * and allowing a promotion with no audit row if the second write failed — would
 * still satisfy the existing "was update called / was auditLog called"
 * assertions. This checks the shape ADR-030 M-3 actually requires: both
 * promises present in a single array argument.
 */
function expectAtomicBatch(
  transaction: jest.MockedFunction<(...args: any[]) => any>,
  callIndex: number
): void {
  const args = transaction.mock.calls[callIndex];
  expect(args).toBeDefined();
  const ops = args![0];
  expect(Array.isArray(ops)).toBe(true);
  // One role update + one audit row, submitted together.
  expect(ops).toHaveLength(2);
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
    // ADR-030 M-3 requires the promotion and its audit snapshot to be atomic:
    // a promoted user with no audit row (or vice versa) is an unacceptable
    // partial state for a migration that doubles as the pre-migration
    // (user_id, role) snapshot.
    expect(transaction).toHaveBeenCalledTimes(1);
    expectAtomicBatch(transaction, 0);
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
});
