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

  // Person-centric assignment redesign (2026-08-07): createHotelGroup no
  // longer accepts (or requires) regional_manager_user_id. A group is created
  // vacant and its RM is assigned afterwards via
  // users/service.ts#updateUserRole -- the same vacancy model Hotel already
  // used, now applied symmetrically. The RM-validation cases that lived here
  // (nonexistent / soft-deleted / not-yet-an-RM target) moved with the write
  // path; see users.test.ts.
  describe('createHotelGroup', () => {
    it('creates a hotel group with no regional manager assigned', async () => {
      const fake = { id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: null, created_at: new Date(), updated_at: new Date() };
      mockPrisma.hotelGroup.create.mockResolvedValue(fake);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createHotelGroup({ name: 'Berlin Group' }, 'admin_1', 'admin');

      expect(result.name).toBe('Berlin Group');
      expect(mockPrisma.hotelGroup.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
      const createCall = (mockPrisma.hotelGroup.create as jest.Mock).mock.calls[0] as Array<{ data: Record<string, unknown> }>;
      expect(createCall[0]?.data).not.toHaveProperty('regional_manager_user_id');
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

  // Person-centric assignment redesign (2026-08-07): updateHotelGroup no
  // longer accepts regional_manager_user_id at all -- RM assignment moved to
  // users/service.ts#updateUserRole, the single authoritative role+assignment
  // write path. The RM transfer/history/token-bump coverage that used to live
  // in this describe now lives in users.test.ts's
  // "updateUserRole - person-centric assignment" block. Only non-RM field
  // updates remain here.
  describe('updateHotelGroup', () => {
    it('updates non-assignment fields (name, billing_info)', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Munich Group', billing_info: 'VAT-123' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateHotelGroup('hg_1', { name: 'Munich Group', billing_info: 'VAT-123' }, 'admin_1', 'admin');

      expect(result.name).toBe('Munich Group');
    });

    it('never writes regional_manager_user_id, even indirectly', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Munich Group' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotelGroup('hg_1', { name: 'Munich Group' }, 'admin_1', 'admin');

      const updateCall = (mockPrisma.hotelGroup.update as jest.Mock).mock.calls[0] as Array<{ data: Record<string, unknown> }>;
      expect(updateCall[0]?.data).not.toHaveProperty('regional_manager_user_id');
      // No token bump either: this path can no longer change anyone's scope.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the hotel group does not exist', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.updateHotelGroup('nonexistent', { name: 'New Name' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });

  // Entity lifecycle parity (2026-08-07): HotelGroup previously had no
  // lifecycle columns at all and only supported hard delete. It now shares
  // Hotel's model exactly.
  describe('lifecycle', () => {
    const active = { id: 'hg_1', name: 'Berlin', is_active: true, deleted_at: null };
    const deleted = { id: 'hg_1', name: 'Berlin', is_active: false, deleted_at: new Date('2026-08-01') };

    beforeEach(() => {
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('deactivate touches is_active only', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(active);
      await service.deactivateHotelGroup('hg_1', 'a1', 'admin');
      expect(mockPrisma.hotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: false } })
      );
    });

    it('reactivate returns a deactivated group to active', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ ...active, is_active: false });
      await service.reactivateHotelGroup('hg_1', 'a1', 'admin');
      expect(mockPrisma.hotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: true } })
      );
    });

    it('restore clears both columns together', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(deleted);
      await service.restoreHotelGroup('hg_1', 'a1', 'admin');
      expect(mockPrisma.hotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: true, deleted_at: null } })
      );
    });

    it('deactivate/reactivate refuse to operate on a deleted group', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(deleted);
      await expect(service.deactivateHotelGroup('hg_1', 'a1', 'admin')).rejects.toMatchObject({ name: 'ConflictError' });
      await expect(service.reactivateHotelGroup('hg_1', 'a1', 'admin')).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockPrisma.hotelGroup.update).not.toHaveBeenCalled();
    });

    it('listHotelGroups excludes deleted by default', async () => {
      mockPrisma.hotelGroup.findMany.mockResolvedValue([]);
      mockPrisma.hotelGroup.count.mockResolvedValue(0);
      await service.listHotelGroups({ page: 1, limit: 20 } as never, { role: 'admin', scope: null });
      const where = ((mockPrisma.hotelGroup.findMany as jest.Mock).mock.calls[0]![0] as {
        where: Record<string, unknown>;
      }).where;
      expect(where.deleted_at).toBeNull();
    });

    it('getHotelGroup reports a deleted group as not found', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(deleted);
      await expect(
        service.getHotelGroup('hg_1', 'a1', 'admin', null)
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });

  describe('deleteHotelGroup', () => {
    // BEHAVIOUR CHANGE (2026-08-07): this is now a SOFT delete. It previously
    // issued prisma.hotelGroup.delete, destroying the row and detaching every
    // member hotel via ON DELETE SET NULL -- irreversible, and it silently
    // orphaned hotels. Hotel and HotelGroup now share one lifecycle, so the
    // group is marked deleted and stays restorable.
    it('soft-deletes the hotel group, leaving member hotels attached', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });
      mockPrisma.hotelGroup.delete.mockResolvedValue({ id: 'hg_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.deleteHotelGroup('hg_1', 'admin_1', 'admin');

      expect(mockPrisma.hotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hg_1' },
          data: expect.objectContaining({ is_active: false, deleted_at: expect.any(Date) }),
        })
      );
      // The row must survive: a hard delete could not be restored, and would
      // detach every member hotel.
      expect(mockPrisma.hotelGroup.delete).not.toHaveBeenCalled();
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
