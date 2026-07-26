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

    // ADR-030 PR-3: the read filter accepts 'regional_manager' so the
    // hotel-group RM picker (F-3) can query it once M-3 promotes any user.
    // No permission or write-path change — read-only filter widening.
    it('filters by role=regional_manager', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers({ page: 1, limit: 20, role: 'regional_manager', hotel_id: undefined, search: undefined, is_active: undefined });

      const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: { role?: string } }>;
      expect(call[0]?.where.role).toBe('REGIONAL_MANAGER');
    });

    // ADR-030 PR-4 (D-7, C-14): GET /users was previously unscoped for
    // manager/regional_manager — any manager could list every user regardless
    // of hotel/group. Filters, does not deny.
    describe('scope filtering (ADR-030 PR-4)', () => {
      it('scopes a hotel_group-claim manager to their own group', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers(
          { page: 1, limit: 20, role: undefined, hotel_id: undefined, search: undefined, is_active: undefined },
          { role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        );

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{
          where: { employment_record?: { hotel_group_id: string } };
        }>;
        expect(call[0]?.where.employment_record).toEqual({ hotel_group_id: 'g1', status: 'ACTIVE' });
      });

      it('resolves a hotel-claim manager to their hotel\'s group', async () => {
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers(
          { page: 1, limit: 20, role: undefined, hotel_id: undefined, search: undefined, is_active: undefined },
          { role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
        );

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{
          where: { employment_record?: { hotel_group_id: string } };
        }>;
        expect(call[0]?.where.employment_record).toEqual({ hotel_group_id: 'g1', status: 'ACTIVE' });
      });

      it('denies (empty result) a manager with no scope claim', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers(
          { page: 1, limit: 20, role: undefined, hotel_id: undefined, search: undefined, is_active: undefined },
          { role: 'manager', scope: null }
        );

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBe('__none__');
      });

      it('denies rather than widens when an explicit ?hotel_id is outside the scope group', async () => {
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g_other' });
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers(
          { page: 1, limit: 20, role: undefined, hotel_id: 'h_other', search: undefined, is_active: undefined },
          { role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        );

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBe('__none__');
      });

      it('leaves admin unscoped regardless of scope claim', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers(
          { page: 1, limit: 20, role: undefined, hotel_id: undefined, search: undefined, is_active: undefined },
          { role: 'admin', scope: null }
        );

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{
          where: { employment_record?: unknown; id?: unknown };
        }>;
        expect(call[0]?.where.employment_record).toBeUndefined();
        expect(call[0]?.where.id).toBeUndefined();
      });

      // Security review FIND-01: the check must be an admin-bypass with
      // default-deny for everyone else, not a `{manager, regional_manager}`
      // allowlist that silently leaves any other role unrestricted.
      it('scope-resolves an unexpected non-admin role rather than leaving it unrestricted', async () => {
        mockPrisma.user.findMany.mockResolvedValue([]);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.listUsers(
          { page: 1, limit: 20, role: undefined, hotel_id: undefined, search: undefined, is_active: undefined },
          { role: 'checker', scope: null }
        );

        const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: string } }>;
        expect(call[0]?.where.id).toBe('__none__');
      });
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

  // ADR-030 PR-1 (C-15 / SIR-AUTH-019): updateUser had zero test coverage
  // before this PR. The pre-existing elevation guard checked only the
  // incoming data.role, never the target user's current role — a non-admin
  // actor sending a payload with no role field at all sailed through against
  // an existing ADMIN account. Not reachable over HTTP today (MANAGER lacks
  // users:write until GD-02), but this is the named prerequisite ADR-030
  // requires before that grant can be made.
  describe('updateUser', () => {
    it('forbids a manager from modifying an existing admin account, even with a non-privileged payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_admin', role: 'ADMIN', first_name: 'Real', last_name: 'Admin',
        phone: null, permissions: ['admin:*'], is_active: true, deleted_at: null,
      });

      await expect(
        service.updateUser('u_admin', { first_name: 'Changed' }, 'manager_actor', 'manager')
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Only admins can modify admin accounts' });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('forbids a manager from elevating an existing user to admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });

      await expect(
        service.updateUser('u_worker', { role: 'admin' }, 'manager_actor', 'manager')
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Only admins can assign admin role' });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows an admin to modify an existing admin account (workflow preserved)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_admin', role: 'ADMIN', first_name: 'Real', last_name: 'Admin',
        phone: null, permissions: ['admin:*'], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_admin', email: 'admin@test.com', first_name: 'Changed', last_name: 'Admin',
        phone: null, role: 'ADMIN', permissions: ['admin:*'], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUser('u_admin', { first_name: 'Changed' }, 'admin_actor', 'admin');
      expect(result.first_name).toBe('Changed');
    });

    it('allows a manager to modify a non-admin user\'s profile (workflow preserved)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUser('u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager');
      expect(result.first_name).toBe('Changed');
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
