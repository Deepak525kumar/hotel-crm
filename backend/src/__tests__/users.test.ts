import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: mockHotel,
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

    // hotel_id filter resolves the hotel's group and filters via the
    // employment_record relation at group grain.
    describe('hotel_id filter', () => {
      it('filters by the resolved hotel group via the employment_record relation', async () => {
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers({ page: 1, limit: 20, role: undefined, hotel_id: 'h1', search: undefined, is_active: undefined });

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: Record<string, unknown> }>;
        expect(call[0]?.where['employment_record']).toEqual({ hotel_group_id: 'g1', status: 'ACTIVE' });
      });

      it('filters out every user when the hotel has no hotel_group_id (deny-by-default)', async () => {
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers({ page: 1, limit: 20, role: undefined, hotel_id: 'h1', search: undefined, is_active: undefined });

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: Record<string, unknown> }>;
        expect(call[0]?.where['employment_record']).toEqual({ hotel_group_id: '__none__', status: 'ACTIVE' });
      });
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

    // HOTFIX-AUTH-003: privilege-escalation regression suite for the authenticated
    // admin-creation workflow. The route admits both admin and manager, but only
    // the server (never a non-admin caller) may assign the privileged ADMIN role.
    it('forbids a manager from creating an ADMIN account (privilege escalation)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createUser(
          { email: 'newadmin@test.com', password: 'pw12345678', first_name: 'Mal', last_name: 'Ory', role: 'admin' },
          'manager_actor',
          'manager'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Only admins can assign admin role' });

      // The escalated account must never be created.
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('allows an admin to create an ADMIN account (workflow preserved)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u_admin', email: 'newadmin@test.com', first_name: 'Real', last_name: 'Admin',
        phone: null, role: 'ADMIN', permissions: ['admin:*'], is_active: true, created_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createUser(
        { email: 'newadmin@test.com', password: 'pw12345678', first_name: 'Real', last_name: 'Admin', role: 'admin' },
        'admin_actor',
        'admin'
      );

      expect(result.role).toBe('admin');
      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string } }>;
      expect(createCall[0]?.data.role).toBe('ADMIN');
    });

    it('allows a manager to create a non-privileged WORKER account (workflow preserved)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Work', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, created_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createUser(
        { email: 'worker@test.com', password: 'pw12345678', first_name: 'Work', last_name: 'Er', role: 'worker' },
        'manager_actor',
        'manager'
      );

      expect(result.role).toBe('worker');
      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string } }>;
      expect(createCall[0]?.data.role).toBe('WORKER');
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
