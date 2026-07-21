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
 * this same module. No authorization-scoping behavior is asserted here —
 * role/scope enforcement over HotelGroup data lands at Epic 5 PR 5.4/5.5
 * (ADR-024), not this PR.
 */

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
  },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
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
    it('creates and returns a hotel group when the regional manager exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_1', deleted_at: null });
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
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_1', deleted_at: new Date() });

      await expect(
        service.createHotelGroup({ name: 'Berlin Group', regional_manager_user_id: 'rm_1' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotelGroup.create).not.toHaveBeenCalled();
    });
  });

  describe('getHotelGroup', () => {
    it('returns the hotel group when found', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getHotelGroup('hg_1', 'actor_1', 'admin');
      expect(result.id).toBe('hg_1');
    });

    it('throws NotFoundError when the hotel group does not exist', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(null);

      await expect(service.getHotelGroup('nonexistent', 'actor_1', 'admin')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });
  });

  describe('listHotelGroups', () => {
    it('returns paginated hotel groups', async () => {
      mockPrisma.hotelGroup.findMany.mockResolvedValue([{ id: 'hg_1', name: 'Berlin Group' }]);
      mockPrisma.hotelGroup.count.mockResolvedValue(1);

      const result = await service.listHotelGroups({ page: 1, limit: 20 });

      expect(result.hotelGroups).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });
  });

  describe('updateHotelGroup', () => {
    it('updates the regional manager when the new user exists', async () => {
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', billing_info: null, regional_manager_user_id: 'rm_1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'rm_2', deleted_at: null });
      mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group', regional_manager_user_id: 'rm_2' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateHotelGroup('hg_1', { regional_manager_user_id: 'rm_2' }, 'admin_1', 'admin');

      expect(result.regional_manager_user_id).toBe('rm_2');
      const updateCall = (mockPrisma.hotelGroup.update as jest.Mock).mock.calls[0] as Array<{ data: { regional_manager_user_id: string } }>;
      expect(updateCall[0]?.data.regional_manager_user_id).toBe('rm_2');
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
