import { describe, it, expect, jest } from '@jest/globals';

/**
 * ADR-031 §4 C-2 / §6 M-2 — regression test for the reconciliation report.
 * Locks: read-only (no update/transaction call exists at all on the mocked
 * prisma), drift direction classification (loses/gains/differs), and that an
 * already-matching row is excluded, not merely marked unchanged.
 */
jest.mock('../config/constants.js', () => ({
  ROLE_PERMISSIONS: {
    ADMIN: ['admin:*', 'users:write'],
    WORKER: ['hotels:read', 'tasks:read'],
  },
}));

import { buildTokenGenerationReconciliationReport } from '../scripts/token-generation-reconciliation-report.js';

function makePrisma(users: Array<{ id: string; role: string; permissions: string[] }>) {
  const findMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
  findMany.mockResolvedValue(users);
  return { prisma: { user: { findMany } }, findMany };
}

describe('buildTokenGenerationReconciliationReport (ADR-031 M-2)', () => {
  it('excludes a row whose stored permissions already match ROLE_PERMISSIONS', async () => {
    const { prisma } = makePrisma([
      { id: 'u1', role: 'WORKER', permissions: ['hotels:read', 'tasks:read'] },
    ]);

    const report = await buildTokenGenerationReconciliationReport(prisma as any);

    expect(report.total_rows).toBe(1);
    expect(report.drifted_count).toBe(0);
    expect(report.sample).toHaveLength(0);
  });

  it('classifies a row currently missing a permission the target would grant as gains_permissions', async () => {
    // stored lacks 'users:write', which ROLE_PERMISSIONS.ADMIN has — switching
    // to derivation would GRANT it, a security-incident-class direction.
    const { prisma } = makePrisma([
      { id: 'u1', role: 'ADMIN', permissions: ['admin:*'] },
    ]);

    const report = await buildTokenGenerationReconciliationReport(prisma as any);

    expect(report.drifted_count).toBe(1);
    expect(report.sample[0]).toMatchObject({ user_id: 'u1', direction: 'gains_permissions' });
  });

  it('classifies a row holding a permission the target would remove as loses_permissions', async () => {
    // stored carries 'admin:*', which ROLE_PERMISSIONS.WORKER does not have —
    // switching to derivation would REVOKE it, an availability-incident-class
    // direction.
    const { prisma } = makePrisma([
      { id: 'u1', role: 'WORKER', permissions: ['hotels:read', 'tasks:read', 'admin:*'] },
    ]);

    const report = await buildTokenGenerationReconciliationReport(prisma as any);

    expect(report.drifted_count).toBe(1);
    expect(report.sample[0]).toMatchObject({ user_id: 'u1', direction: 'loses_permissions' });
  });

  it('classifies a row with both a missing and an extra permission as differs', async () => {
    const { prisma } = makePrisma([
      { id: 'u1', role: 'ADMIN', permissions: ['stale:token'] }, // missing both admin:*/users:write, holds an extra
    ]);

    const report = await buildTokenGenerationReconciliationReport(prisma as any);

    expect(report.sample[0]).toMatchObject({ user_id: 'u1', direction: 'differs' });
  });

  it('never calls update/transaction — read-only by construction', async () => {
    const { prisma, findMany } = makePrisma([
      { id: 'u1', role: 'ADMIN', permissions: [] },
    ]);
    (prisma.user as any).update = jest.fn();

    await buildTokenGenerationReconciliationReport(prisma as any);

    expect(findMany).toHaveBeenCalledWith({
      where: { deleted_at: null },
      select: { id: true, role: true, permissions: true },
    });
    expect((prisma.user as any).update).not.toHaveBeenCalled();
  });

  it('caps the sample at 25 rows but reports the true drifted_count', async () => {
    const users = Array.from({ length: 40 }, (_, i) => ({
      id: `u${i}`,
      role: 'ADMIN',
      permissions: [] as string[],
    }));
    const { prisma } = makePrisma(users);

    const report = await buildTokenGenerationReconciliationReport(prisma as any);

    expect(report.drifted_count).toBe(40);
    expect(report.sample).toHaveLength(25);
  });
});
