import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for ADR-030 M-2 (scripts/role-permissions-backfill.ts).
 * Locks: only ADMIN/MANAGER/REGIONAL_MANAGER rows are considered, a row
 * whose stored permissions already match ROLE_PERMISSIONS is left untouched
 * (idempotent), and an out-of-date row is updated with an AuditLog snapshot
 * inside one transaction.
 */

jest.mock('../config/constants.js', () => ({
  ROLE_PERMISSIONS: {
    ADMIN: ['admin:*', 'hotel_groups:read', 'hotel_groups:write'],
    MANAGER: ['hotels:read', 'hotel_groups:read', 'users:write'],
    REGIONAL_MANAGER: ['hotels:read', 'hotel_groups:read', 'users:write'],
  },
}));

import { backfillRolePermissions } from '../scripts/role-permissions-backfill.js';

function makePrisma(users: Array<{ id: string; role: string; permissions: string[] }>) {
  const userFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  userFindMany.mockResolvedValue(users);
  const userUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const auditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  const transaction = jest.fn(async (ops: any[]) => {
    for (const op of ops) await op;
  }) as jest.MockedFunction<(...args: any[]) => any>;

  const prisma = {
    user: { findMany: userFindMany, update: userUpdate },
    auditLog: { create: auditLogCreate },
    $transaction: transaction,
  } as any;

  return { prisma, userFindMany, userUpdate, auditLogCreate };
}

describe('backfillRolePermissions (ADR-030 M-2)', () => {
  it('queries only ADMIN/MANAGER/REGIONAL_MANAGER, excluding deleted rows', async () => {
    const { prisma, userFindMany } = makePrisma([]);

    await backfillRolePermissions(prisma);

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER'] }, deleted_at: null },
      })
    );
  });

  it('updates a MANAGER row whose stored permissions are stale', async () => {
    const { prisma, userUpdate, auditLogCreate } = makePrisma([
      { id: 'u1', role: 'MANAGER', permissions: ['hotels:read'] },
    ]);

    const result = await backfillRolePermissions(prisma);

    expect(result.updated).toEqual([{ user_id: 'u1', role: 'MANAGER' }]);
    expect(result.unchanged).toBe(0);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { permissions: ['hotels:read', 'hotel_groups:read', 'users:write'] },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BACKFILL_PERMISSIONS',
          resource_id: 'u1',
          old_values: { permissions: ['hotels:read'] },
        }),
      })
    );
  });

  it('is idempotent — skips a row whose permissions already match (order-insensitive)', async () => {
    const { prisma, userUpdate } = makePrisma([
      { id: 'u1', role: 'MANAGER', permissions: ['users:write', 'hotel_groups:read', 'hotels:read'] },
    ]);

    const result = await backfillRolePermissions(prisma);

    expect(result.updated).toEqual([]);
    expect(result.unchanged).toBe(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('backfills a REGIONAL_MANAGER row (the previously-missing ROLE_PERMISSIONS entry)', async () => {
    const { prisma, userUpdate } = makePrisma([
      { id: 'u2', role: 'REGIONAL_MANAGER', permissions: [] },
    ]);

    const result = await backfillRolePermissions(prisma);

    expect(result.updated).toEqual([{ user_id: 'u2', role: 'REGIONAL_MANAGER' }]);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { permissions: ['hotels:read', 'hotel_groups:read', 'users:write'] },
    });
  });
});
