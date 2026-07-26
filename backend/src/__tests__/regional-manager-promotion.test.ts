import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for ADR-030 M-3 (scripts/regional-manager-promotion.ts).
 * Locks: only current-MANAGER regional managers are promoted (idempotent),
 * the update and its AuditLog snapshot happen inside one transaction, and
 * User.permissions is left untouched (M-2's job, deferred to PR-5).
 */

import { promoteRegionalManagers } from '../scripts/regional-manager-promotion.js';

function makePrisma({
  groups,
  users,
}: {
  groups: Array<{ id: string; regional_manager_user_id: string }>;
  users: Record<string, { id: string; role: string; permissions: string[] }>;
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

  return { prisma, userUpdate, auditLogCreate };
}

describe('promoteRegionalManagers (ADR-030 M-3)', () => {
  it('promotes a MANAGER referenced as a group RM to REGIONAL_MANAGER', async () => {
    const { prisma, userUpdate, auditLogCreate } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'MANAGER', permissions: ['hotels:read'] } },
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
          old_values: { role: 'MANAGER', permissions: ['hotels:read'] },
        }),
      })
    );
  });

  it('is idempotent — skips a user already promoted to REGIONAL_MANAGER', async () => {
    const { prisma, userUpdate } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'REGIONAL_MANAGER', permissions: [] } },
    });

    const result = await promoteRegionalManagers(prisma);

    expect(result.promoted).toEqual([]);
    expect(result.skippedAlreadyPromoted).toBe(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('does not touch User.permissions (deferred to M-2/PR-5)', async () => {
    const { prisma, userUpdate } = makePrisma({
      groups: [{ id: 'g1', regional_manager_user_id: 'u1' }],
      users: { u1: { id: 'u1', role: 'MANAGER', permissions: ['hotels:read', 'users:write'] } },
    });

    await promoteRegionalManagers(prisma);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'REGIONAL_MANAGER' },
    });
    const updateArgs = userUpdate.mock.calls[0][0] as any;
    expect(updateArgs.data.permissions).toBeUndefined();
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
