import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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

import { UserService } from '../modules/users/service.js';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService();
  });

  describe('listUsers', () => {
    it('returns paginated users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'a@b.com', first_name: 'A', last_name: 'B', phone: null, profile_photo_url: null, role: 'WORKER', permissions: [], is_active: true, created_at: new Date(), updated_at: new Date() },
      ]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, limit: 20, role: undefined, hotel_id: undefined, search: undefined, is_active: undefined });

      expect(result.users).toHaveLength(1);
      expect(result.users[0]?.role).toBe('worker');
      expect(result.pagination.total).toBe(1);
    });

    it('filters by role', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers({ page: 1, limit: 20, role: 'manager', hotel_id: undefined, search: undefined, is_active: undefined });

      const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: { role?: string } }>;
      expect(call[0]?.where.role).toBe('MANAGER');
    });
  });

  describe('getUser', () => {
    it('returns user and logs audit', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', first_name: 'A', last_name: 'B',
        phone: null, profile_photo_url: null, role: 'WORKER',
        permissions: [], is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getUser('u1', 'actor', 'admin');
      expect(result.id).toBe('u1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundError when soft-deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', deleted_at: new Date(),
      });

      await expect(service.getUser('u1', 'actor', 'admin')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });
  });

  describe('createUser', () => {
    it('throws ConflictError when email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createUser({ email: 'exists@test.com', password: 'pw12345678', first_name: 'A', last_name: 'B', role: 'worker' }, 'actor', 'admin')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });
  });

  describe('deleteUser', () => {
    it('prevents self-deletion', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'actor', deleted_at: null });

      await expect(service.deleteUser('actor', 'actor', 'admin')).rejects.toMatchObject({
        name: 'ForbiddenError',
        message: 'Cannot delete your own account',
      });
    });

    it('soft-deletes user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', deleted_at: null, email: 'u@t.com' });
      mockPrisma.user.update.mockResolvedValue({ id: 'u1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.deleteUser('u1', 'actor', 'admin');

      const updateCall = (mockPrisma.user.update as jest.Mock).mock.calls[0] as Array<{ data: { deleted_at: Date; is_active: boolean } }>;
      expect(updateCall[0]?.data.is_active).toBe(false);
      expect(updateCall[0]?.data.deleted_at).toBeInstanceOf(Date);
    });
  });
});
