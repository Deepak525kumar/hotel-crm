import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Regression suite for Epic 5 PR 5.2 (ADR-023 HotelGroup CRUD + RM assignment).
 *
 * CrmService.*HotelGroup* is a straightforward CRUD surface over the additive
 * HotelGroup entity introduced in PR 5.1 (schema-only, unread until now).
 * These tests lock: (a) regional_manager_user_id is validated against an
 * existing user before create/update, per ADR-023's "one HotelGroup has
 * exactly one assigned Regional Manager"; (b) standard CRUD behavior
 * (create/read/list/update/delete) mirrors the existing Hotel CRUD pattern in
 * this same module. Scope enforcement over HotelGroup reads (list-filter,
 * single-fetch deny) is added at ADR-030 PR-4 — see the dedicated describe
 * block below.
 */

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  hotelGroup: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    delete: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    // updateHotelGroup()'s transfer path bumps token_generation on both the
    // outgoing and incoming RM (post-#339 review fix).
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: mockHotel,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  // Vacancy-history model (2026-08-06): createHotelGroup()/updateHotelGroup()
  // record RM assign/unassign transitions in this table.
  regionalManagerAssignmentHistory: {
    create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
    updateMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 1 }),
  },
  // updateHotelGroup() now runs inside a transaction (lock-ordering fix,
  // post-#339 review): it takes a row lock on the RM user id(s) via
  // `SELECT ... FOR UPDATE` before re-reading/writing the HotelGroup row, in
  // the same User-before-HotelGroup order users/service.ts#updateUserRole
  // uses, so the two can never deadlock against each other.
  $queryRaw: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  $transaction: jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(mockPrisma);
  }) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { CrmService } from '../modules/crm/service.js';

describe('CrmService - Hotel Groups', () => {
  let service: CrmService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CrmService();
  });

  describe('createHotelGroup', () => {
    it('creates and returns a hotel group when the regional manager exists and already holds the role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_1', deleted_at: null, role: 'REGIONAL_MANAGER' });
      const fake = { id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1', created_at: new Date(), updated_at: new Date() };
      mockPrisma.hotelGroup.create.mockResolvedValue(fake);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createHotelGroup({ name: 'Berlin Group', regional_manager_user_id: 'rm_1' }, 'admin_1', 'admin');

      expect(result.name).toBe('Berlin Group');
      expect(mockPrisma.hotelGroup.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects when regional_manager_user_id does not reference an existing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createHotelGroup({ name: 'Berlin Group', regional_manager_user_id: 'nonexistent' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotelGroup.create).not.toHaveBeenCalled();
    });

    it('rejects when regional_manager_user_id references a soft-deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_1', deleted_at: new Date(), role: 'REGIONAL_MANAGER' });

      await expect(
        service.createHotelGroup({ name: 'Berlin Group', regional_manager_user_id: 'rm_1' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotelGroup.create).not.toHaveBeenCalled();
    });

    // Regional Manager V1 Decision 12: the target must already hold
    // REGIONAL_MANAGER. Previously assertRegionalManagerExists only checked
    // the user existed, so a WORKER/MANAGER row could be written into
    // regional_manager_user_id with no actual RM authority ever granted.
    it('rejects when regional_manager_user_id references a user who is not yet a Regional Manager', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'mgr_1', deleted_at: null, role: 'MANAGER' });

      await expect(
        service.createHotelGroup({ name: 'Berlin Group', regional_manager_user_id: 'mgr_1' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotelGroup.create).not.toHaveBeenCalled();
    });
  });

  describe('getHotelGroup', () => {
    it('returns the hotel group when found', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getHotelGroup('hg_1', 'actor_1', 'admin', null);
      expect(result.id).toBe('hg_1');
    });

    it('throws NotFoundError when the hotel group does not exist', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(null);

      await expect(service.getHotelGroup('nonexistent', 'actor_1', 'admin', null)).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    // ADR-030 PR-4 (D-7, C-08): single-resource fetch, so an out-of-scope
    // group now denies (403-equivalent ForbiddenError) rather than being
    // silently readable by any manager.
    describe('scope enforcement (ADR-030 PR-4)', () => {
      it('allows a manager whose hotel_group scope matches the group', async () => {
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });

        const result = await service.getHotelGroup('hg_1', 'mgr_1', 'manager', {
          type: 'hotel_group',
          hotel_group_id: 'hg_1',
        });
        expect(result.id).toBe('hg_1');
      });

      it('denies a manager whose hotel_group scope does not match the group', async () => {
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });

        await expect(
          service.getHotelGroup('hg_1', 'mgr_1', 'manager', { type: 'hotel_group', hotel_group_id: 'hg_other' })
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
      });

      it('allows a hotel-scoped manager whose hotel belongs to the group', async () => {
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'hg_1' });

        const result = await service.getHotelGroup('hg_1', 'mgr_1', 'manager', { type: 'hotel', hotel_id: 'h1' });
        expect(result.id).toBe('hg_1');
      });

      it('denies a manager with no scope claim', async () => {
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });

        await expect(service.getHotelGroup('hg_1', 'mgr_1', 'manager', null)).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });

      it('leaves admin unscoped regardless of scope claim', async () => {
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });

        const result = await service.getHotelGroup('hg_1', 'adm_1', 'admin', null);
        expect(result.id).toBe('hg_1');
      });

      // Security review FIND-01: admin-bypass + default-deny, not a
      // `{manager, regional_manager}` allowlist.
      it('scope-resolves an unexpected non-admin role rather than leaving it unrestricted', async () => {
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });

        await expect(service.getHotelGroup('hg_1', 'chk_1', 'checker', null)).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });
    });
  });

  describe('listHotelGroups', () => {
    it('returns paginated hotel groups', async () => {
      mockPrisma.hotelGroup.findMany.mockResolvedValue([{ id: 'hg_1', name: 'Berlin Group' }]);
      mockPrisma.hotelGroup.count.mockResolvedValue(1);

      const result = await service.listHotelGroups({ page: 1, limit: 20 }, { role: 'admin', scope: null });

      expect(result.hotelGroups).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    // ADR-030 PR-4 (D-7, C-08): previously unscoped — any manager listed
    // every hotel group. Filters, does not deny.
    describe('scope filtering (ADR-030 PR-4)', () => {
      it('scopes a hotel_group-claim manager to their own group', async () => {
        mockPrisma.hotelGroup.findMany.mockResolvedValue([]);
        mockPrisma.hotelGroup.count.mockResolvedValue(0);

        await service.listHotelGroups(
          { page: 1, limit: 20 },
          { role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'hg_1' } }
        );

        const call = (mockPrisma.hotelGroup.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBe('hg_1');
      });

      it('denies (empty result) a manager with no scope claim', async () => {
        mockPrisma.hotelGroup.findMany.mockResolvedValue([]);
        mockPrisma.hotelGroup.count.mockResolvedValue(0);

        await service.listHotelGroups({ page: 1, limit: 20 }, { role: 'manager', scope: null });

        const call = (mockPrisma.hotelGroup.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBe('__none__');
      });

      it('leaves admin unscoped regardless of scope claim', async () => {
        mockPrisma.hotelGroup.findMany.mockResolvedValue([]);
        mockPrisma.hotelGroup.count.mockResolvedValue(0);

        await service.listHotelGroups({ page: 1, limit: 20 }, { role: 'admin', scope: null });

        const call = (mockPrisma.hotelGroup.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBeUndefined();
      });

      // Security review FIND-01: admin-bypass + default-deny, not a
      // `{manager, regional_manager}` allowlist.
      it('scope-resolves an unexpected non-admin role rather than leaving it unrestricted', async () => {
        mockPrisma.hotelGroup.findMany.mockResolvedValue([]);
        mockPrisma.hotelGroup.count.mockResolvedValue(0);

        await service.listHotelGroups({ page: 1, limit: 20 }, { role: 'checker', scope: null });

        const call = (mockPrisma.hotelGroup.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBe('__none__');
      });
    });
  });

  describe('updateHotelGroup', () => {
    it('updates the regional manager when the new user exists and already holds the role', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_2', deleted_at: null, role: 'REGIONAL_MANAGER' });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', regional_manager_user_id: 'rm_2' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateHotelGroup('hg_1', { regional_manager_user_id: 'rm_2' }, 'admin_1', 'admin');

      expect(result.regional_manager_user_id).toBe('rm_2');
      const updateCall = (mockPrisma.hotelGroup.update as jest.Mock).mock.calls[0] as Array<{ data: { regional_manager_user_id: string } }>;
      expect(updateCall[0]?.data.regional_manager_user_id).toBe('rm_2');
    });

    // Post-#339 review finding: a transfer previously left both RMs' access
    // tokens carrying a stale `scope` claim (minted at login/refresh, never
    // re-derived per-request) for up to JWT_ACCESS_EXPIRY — the outgoing RM
    // kept acting on the old group, the incoming RM couldn't act on the new
    // one until they refreshed. Both must be invalidated in the SAME
    // transaction as the group write.
    it('bumps token_generation for BOTH the outgoing and incoming RM on transfer', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_2', deleted_at: null, role: 'REGIONAL_MANAGER' });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', regional_manager_user_id: 'rm_2' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotelGroup('hg_1', { regional_manager_user_id: 'rm_2' }, 'admin_1', 'admin');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'rm_1' },
        data: { token_generation: { increment: 1 } },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'rm_2' },
        data: { token_generation: { increment: 1 } },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('does NOT bump token_generation for a non-RM field change (name only)', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Munich Group', regional_manager_user_id: 'rm_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotelGroup('hg_1', { name: 'Munich Group' }, 'admin_1', 'admin');

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does NOT bump token_generation when regional_manager_user_id is set to its current value (no-op)', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_1', deleted_at: null, role: 'REGIONAL_MANAGER' });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', regional_manager_user_id: 'rm_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotelGroup('hg_1', { regional_manager_user_id: 'rm_1' }, 'admin_1', 'admin');

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Race-closure follow-up (second-review pass on #339): assertRegionalManagerExists
    // (the D12 check) runs BEFORE the transaction/row-lock, so its result can
    // be stale by the time the lock is actually held — a concurrent
    // updateUserRole() demotion could commit in that exact gap. This asserts
    // the role is RE-CHECKED under the lock, not just before it: simulates the
    // target's role having changed between the outer assertion and the
    // in-transaction re-read (mockResolvedValueOnce for the first call, a
    // different value for the second — both resolve through the same mock
    // since $transaction hands the callback `mockPrisma` itself as `tx`).
    it('re-checks the new RM still holds the role INSIDE the transaction, not only before it', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'rm_2', deleted_at: null, role: 'REGIONAL_MANAGER' }) // outer assertRegionalManagerExists — passes
        .mockResolvedValueOnce({ id: 'rm_2', deleted_at: null, role: 'MANAGER' }); // in-transaction re-check — demoted concurrently, must now fail

      await expect(
        service.updateHotelGroup('hg_1', { regional_manager_user_id: 'rm_2' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });

      expect(mockPrisma.hotelGroup.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Deadlock-avoidance follow-up (post-#339 review): updateUserRole()
    // (users/service.ts) locks the target User row FIRST, then reads
    // HotelGroup. A concurrent transfer here must lock in the SAME order —
    // User before HotelGroup — or the two operations deadlock instead of
    // cleanly serializing under Postgres. This asserts the row lock
    // ($queryRaw ... FOR UPDATE) is taken before the HotelGroup write.
    it('locks the RM user row(s) before writing the HotelGroup row (deadlock-avoidance lock order)', async () => {
      const callOrder: string[] = [];
      mockPrisma.$queryRaw.mockImplementation(async () => {
        callOrder.push('user-lock');
        return [];
      });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_2', deleted_at: null, role: 'REGIONAL_MANAGER' });
      mockPrisma.hotelGroup.update.mockImplementation(async () => {
        callOrder.push('hotelgroup-write');
        return { id: 'hg_1', name: 'Berlin Group', regional_manager_user_id: 'rm_2' };
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotelGroup('hg_1', { regional_manager_user_id: 'rm_2' }, 'admin_1', 'admin');

      // Locks BOTH RM user rows (outgoing rm_1, incoming rm_2) before the
      // HotelGroup write — see updateHotelGroup's own comment on why both,
      // not just one, must be locked.
      expect(callOrder).toEqual(['user-lock', 'user-lock', 'hotelgroup-write']);
    });

    // Regional Manager V1 Decision 12: this is the live "transfer" path — the
    // successor must already hold REGIONAL_MANAGER, not merely exist.
    it('rejects transferring to a user who is not yet a Regional Manager', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'mgr_2', deleted_at: null, role: 'MANAGER' });

      await expect(
        service.updateHotelGroup('hg_1', { regional_manager_user_id: 'mgr_2' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotelGroup.update).not.toHaveBeenCalled();
    });

    it('rejects reassignment to a nonexistent user without writing', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateHotelGroup('hg_1', { regional_manager_user_id: 'nonexistent' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotelGroup.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the hotel group does not exist', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.updateHotelGroup('nonexistent', { name: 'New Name' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });

  describe('deleteHotelGroup', () => {
    it('hard-deletes the hotel group', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });
      mockPrisma.hotelGroup.delete.mockResolvedValue({ id: 'hg_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.deleteHotelGroup('hg_1', 'admin_1', 'admin');

      expect(mockPrisma.hotelGroup.delete).toHaveBeenCalledWith({ where: { id: 'hg_1' } });
    });

    it('throws NotFoundError when the hotel group does not exist', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(null);

      await expect(service.deleteHotelGroup('nonexistent', 'admin_1', 'admin')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
      expect(mockPrisma.hotelGroup.delete).not.toHaveBeenCalled();
    });
  });
});
