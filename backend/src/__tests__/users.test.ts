import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Vacancy-history model (2026-08-06): demoting a Regional Manager/Manager who
// still owns a group/hotel now auto-clears the assignment (rather than
// blocking), so updateUserRole() also writes hotelGroup/hotel and their
// paired *AssignmentHistory tables.
const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  update: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
};

// Regional Manager V1 Decision 11: updateUserRole() checks whether the target
// still owns a hotel group before permitting demotion.
const mockHotelGroup = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // Single-posting invariant (2026-08-07) reads the END STATE back inside the
  // transaction via findFirst, rather than trusting the conditional
  // vacate/assign branches above it.
  findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  update: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
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
  hotelGroup: mockHotelGroup,
  // updateUser()'s and getUser()'s manager/RM scope check (isWorkerInGroupScope,
  // lib/scope.ts) reads EmploymentRecord directly via getPrisma(), not through
  // `this.prisma` -- same mock object, since jest.mock('../lib/db.js') below
  // makes getPrisma() return this mockPrisma everywhere.
  employmentRecord: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    // Person-centric assignment redesign (2026-08-07): updateUserRole writes
    // a worker/checker's hotel_group_id (existing eligibility field) and
    // primary_hotel_id (new, display-only).
    update: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
  },
  regionalManagerAssignmentHistory: {
    updateMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 1 }),
    create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
  },
  hotelManagerAssignmentHistory: {
    updateMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 1 }),
    create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
  },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  // updateUserRole()'s Decision-11 race fix (post-#339 review) takes a
  // `SELECT ... FOR UPDATE` row lock inside the transaction before the
  // ownership check — a no-op against this mock (no real DB, no concurrent
  // transaction to block), but tx.$queryRaw must exist and resolve.
  $queryRaw: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  // ADR-031 PR-4: token_generation bumps commit inside a transaction whose
  // callback receives mockPrisma itself, so tx.user.update etc. resolve
  // against the same mocks as the non-transactional calls in this file.
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

import { UserService } from '../modules/users/service.js';

let hotelRows: Map<string, string>;
let groupRow: { id: string; rm: string } | null;

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    // The single-posting invariant reads Hotel/HotelGroup back AFTER the
    // vacate+assign writes, so these mocks must reflect those writes the way
    // the database would. A static stub returning the pre-vacate row would
    // make the invariant reject a transition that actually cleared it.
    hotelRows = new Map();
    groupRow = null;
    mockHotel.findMany.mockImplementation(async ({ where }: any) =>
      [...hotelRows.entries()]
        .filter(([, mgr]) => mgr === where?.manager_user_id)
        .map(([id]) => ({ id })),
    );
    mockHotel.update.mockImplementation(async ({ where, data }: any) => {
      if (data?.manager_user_id !== undefined) {
        if (data.manager_user_id === null) hotelRows.delete(where.id);
        else hotelRows.set(where.id, data.manager_user_id);
      }
      return { id: where.id, ...data };
    });
    mockHotelGroup.findFirst.mockImplementation(async ({ where }: any) =>
      groupRow && groupRow.rm === where?.regional_manager_user_id
        ? { id: groupRow.id }
        : null,
    );
    mockHotelGroup.update.mockImplementation(async ({ where, data }: any) => {
      if (data?.regional_manager_user_id !== undefined) {
        groupRow =
          data.regional_manager_user_id === null
            ? null
            : { id: where.id, rm: data.regional_manager_user_id };
      }
      return { id: where.id, ...data };
    });
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

      const result = await service.getUser('u1', 'actor', 'admin', null);
      expect(result.id).toBe('u1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundError when soft-deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', deleted_at: new Date(),
      });

      await expect(service.getUser('u1', 'actor', 'admin', null)).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    // Read-side counterpart of updateUser's scope check (2026-08-06): a
    // manager/RM could previously read any user's full profile platform-wide.
    it('forbids a manager from viewing a worker outside their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'other_group' });

      await expect(
        service.getUser('u_worker', 'manager_actor', 'manager', { type: 'hotel_group', hotel_group_id: 'my_group' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows a manager to view a worker within their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getUser(
        'u_worker', 'manager_actor', 'manager', { type: 'hotel_group', hotel_group_id: 'my_group' }
      );
      expect(result.id).toBe('u_worker');
    });

    it('forbids a manager from viewing another manager (non-worker/checker target)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_mgr2', role: 'MANAGER', first_name: 'Other', last_name: 'Mgr',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });

      await expect(
        service.getUser('u_mgr2', 'manager_actor', 'manager', { type: 'global' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows a manager to view their own profile (self-read exemption)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'manager_actor', role: 'MANAGER', first_name: 'Self', last_name: 'Mgr',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getUser('manager_actor', 'manager_actor', 'manager', { type: 'global' });
      expect(result.id).toBe('manager_actor');
      expect(mockPrisma.employmentRecord.findUnique).not.toHaveBeenCalled();
    });

    it('denies a manager with no scope claim from viewing an in-group worker', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'some_group' });

      await expect(
        service.getUser('u_worker', 'manager_actor', 'manager', null)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows a regional_manager to view a worker within their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getUser(
        'u_worker', 'rm_actor', 'regional_manager', { type: 'hotel_group', hotel_group_id: 'my_group' }
      );
      expect(result.id).toBe('u_worker');
    });

    it('forbids a regional_manager from viewing a worker outside their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'other_group' });

      await expect(
        service.getUser('u_worker', 'rm_actor', 'regional_manager', { type: 'hotel_group', hotel_group_id: 'my_group' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    // NOTE: `checker` does not actually hold `users:read` (ROLE_PERMISSIONS.CHECKER
    // has no users:* entry) and can never reach this route in practice — the
    // route-level `requirePermission('users:read')` gate rejects it with a 403
    // before this service method is ever called. This test only pins the
    // service's own in-isolation behavior (defense-in-depth / regression guard
    // if a permission is ever added), not a reachable IDOR the way the
    // manager/RM cases above are.
    it('does not scope a checker actor at the service level (unreachable at the route today)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, profile_photo_url: null, is_active: true,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getUser('u_worker', 'checker_actor', 'checker', null);
      expect(result.id).toBe('u_worker');
      expect(mockPrisma.employmentRecord.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('createUser', () => {
    it('throws ConflictError when email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createUser({ email: 'exists@test.com', password: 'pw12345678', first_name: 'A', last_name: 'B', role: 'worker', phone: '+1234567890' }, 'actor', 'admin')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    // HOTFIX-AUTH-003: privilege-escalation regression suite for the authenticated
    // admin-creation workflow. The route admits both admin and manager, but only
    // the server (never a non-admin caller) may assign the privileged ADMIN role.
    it('forbids a manager from creating an ADMIN account (privilege escalation)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createUser(
          { email: 'newadmin@test.com', password: 'pw12345678', first_name: 'Mal', last_name: 'Ory', role: 'admin', phone: '+1234567890' },
          'manager_actor',
          'manager'
        )
      // Message changed with RULE A (2026-08-12): the old HOTFIX-AUTH-003
      // guard ("Only admins can assign admin role") was superseded by the
      // 1-level-down check, which denies this for a strictly broader reason.
      // The security property under test is unchanged and still asserted.
      ).rejects.toMatchObject({ name: 'ForbiddenError' });

      // The escalated account must never be created.
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    // RULE A (project-owner decision, 2026-08-12): create is 1-level-down
    // ONLY, and `admin` is one level below nothing — so NO role, admin
    // included, may create an admin account. This REPLACES the previous
    // "allows an admin to create an ADMIN account (workflow preserved)" case:
    // that workflow was deliberately removed, not accidentally broken, so the
    // assertion is inverted rather than deleted.
    it('forbids even an admin from creating an ADMIN account (RULE A: admin is not 1-level-down from anything)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createUser(
          { email: 'newadmin@test.com', password: 'pw12345678', first_name: 'Real', last_name: 'Admin', role: 'admin', phone: '+1234567890' },
          'admin_actor',
          'admin'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('allows an admin to create a REGIONAL_MANAGER account (RULE A: admin -> regional_manager)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u_rm', email: 'rm@test.com', first_name: 'Reg', last_name: 'Man',
        phone: null, role: 'REGIONAL_MANAGER', is_active: true, created_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createUser(
        { email: 'rm@test.com', password: 'pw12345678', first_name: 'Reg', last_name: 'Man', role: 'regional_manager', phone: '+1234567890' },
        'admin_actor',
        'admin'
      );

      expect(result.role).toBe('regional_manager');
      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string } }>;
      expect(createCall[0]?.data.role).toBe('REGIONAL_MANAGER');
    });

    it('allows a manager to create a non-privileged WORKER account (workflow preserved)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Work', last_name: 'Er',
        phone: null, role: 'WORKER', is_active: true, created_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createUser(
        { email: 'worker@test.com', password: 'pw12345678', first_name: 'Work', last_name: 'Er', role: 'worker', phone: '+1234567890' },
        'manager_actor',
        'manager'
      );

      expect(result.role).toBe('worker');
      // ADR-031 D-1/M-3 (PR-7): permissions are derived from
      // ROLE_PERMISSIONS[role] in the response, not read from a stored
      // column (dropped) or written to the create call.
      expect(result.permissions.length).toBeGreaterThan(0);
      expect(result.permissions).not.toContain('admin:*');
      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string } }>;
      expect(createCall[0]?.data.role).toBe('WORKER');
      expect(createCall[0]?.data).not.toHaveProperty('permissions');
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
        service.updateUser('u_admin', { first_name: 'Changed' }, 'manager_actor', 'manager', null)
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Only admins can modify admin accounts' });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Person-centric assignment redesign (2026-08-07): the "manager elevates
    // a user to admin via PUT /users/:id" case this used to assert is now
    // structurally impossible -- `role` was removed from UpdateUserSchema
    // entirely, so the payload cannot express a role change and is rejected
    // at the schema boundary before reaching the service. Role changes are
    // admin-only via PUT /users/:id/role (updateUserRole), covered there.

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

      const result = await service.updateUser('u_admin', { first_name: 'Changed' }, 'admin_actor', 'admin', null);
      expect(result.first_name).toBe('Changed');
    });

    it('allows a manager to modify a worker\'s profile within their hotel group scope (workflow preserved)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUser(
        'u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager',
        { type: 'hotel_group', hotel_group_id: 'my_group' }
      );
      expect(result.first_name).toBe('Changed');
    });

    // Product decision (2026-08-06): a scoped manager/RM may only edit
    // worker/checker targets within their scope. No employment record (not
    // yet onboarded) or a record outside the actor's group both deny; a
    // non-worker/checker target (another manager/admin) is never reachable
    // by a non-admin actor at all, regardless of scope.
    it('forbids a manager from modifying a worker outside their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'other_group' });

      await expect(
        service.updateUser(
          'u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager',
          { type: 'hotel_group', hotel_group_id: 'my_group' }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('forbids a manager from modifying a not-yet-onboarded worker (no EmploymentRecord)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser(
          'u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager',
          { type: 'hotel_group', hotel_group_id: 'my_group' }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('forbids a manager from modifying a fellow manager, even one in scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_mgr2', role: 'MANAGER', first_name: 'Other', last_name: 'Mgr',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });

      await expect(
        service.updateUser('u_mgr2', { first_name: 'Changed' }, 'manager_actor', 'manager', { type: 'global' })
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Only admins can modify manager or admin accounts' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.employmentRecord.findUnique).not.toHaveBeenCalled();
    });

    it('allows a manager to modify their own profile (self-edit exemption)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'manager_actor', role: 'MANAGER', first_name: 'Self', last_name: 'Mgr',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'manager_actor', email: 'mgr@test.com', first_name: 'Changed', last_name: 'Mgr',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUser(
        'manager_actor', { first_name: 'Changed' }, 'manager_actor', 'manager', { type: 'global' }
      );
      expect(result.first_name).toBe('Changed');
      expect(mockPrisma.employmentRecord.findUnique).not.toHaveBeenCalled();
    });

    it('denies a manager with no scope claim from modifying an in-group worker', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'some_group' });

      await expect(
        service.updateUser('u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager', null)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows a regional_manager to modify a worker within their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUser(
        'u_worker', { first_name: 'Changed' }, 'rm_actor', 'regional_manager',
        { type: 'hotel_group', hotel_group_id: 'my_group' }
      );
      expect(result.first_name).toBe('Changed');
    });

    it('forbids a regional_manager from modifying a worker outside their hotel group scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'other_group' });

      await expect(
        service.updateUser(
          'u_worker', { first_name: 'Changed' }, 'rm_actor', 'regional_manager',
          { type: 'hotel_group', hotel_group_id: 'my_group' }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Regression: phone is @unique-but-nullable. An empty string is a real,
    // non-null value, so writing "" for every phoneless user collided with
    // the first phoneless user to save, surfacing as a false P2002
    // "already exists" on totally unrelated edits. Blank phone must persist
    // as null, not "".
    it('normalizes a blank phone to null instead of writing an empty string', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateUser(
        'u_worker', { first_name: 'Changed', phone: '   ' }, 'manager_actor', 'manager',
        { type: 'hotel_group', hotel_group_id: 'my_group' }
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: null }) })
      );
    });

    it('leaves phone untouched when the field is omitted from the payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: '+15551234567', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: '+15551234567', role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateUser(
        'u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager',
        { type: 'hotel_group', hotel_group_id: 'my_group' }
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '+15551234567' }) })
      );
    });

    // ADR-031 D-4/C-5: a role change or deactivation must bump
    // token_generation atomically with the state change that motivates it.
    // Person-centric assignment redesign (2026-08-07): the role-change half
    // of this moved to updateUserRole (PUT /users/:id/role), the sole role
    // write path -- its own suite asserts the bump. updateUser can no longer
    // change a role at all, so only the deactivation case remains here.

    it('bumps token_generation on deactivation (is_active -> false)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Work', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: false, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateUser('u_worker', { is_active: false }, 'admin_actor', 'admin', null);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ token_generation: { increment: 1 } }) })
      );
    });

    it('does not bump token_generation when neither role nor is_active change', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateUser('u_worker', { first_name: 'Changed' }, 'admin_actor', 'admin', null);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.not.objectContaining({ token_generation: expect.anything() }) })
      );
    });
  });

  // IDOR fix (2026-08-08): updateUserProfile() (the FEATURE_GD02_MATRIX-on
  // path, replacing updateUser above) had isWorkerInGroupScope but no
  // equivalent to updateUser's target-role check -- a manager/RM in-group
  // could tamper with another manager's, RM's, or admin's profile as long
  // as the target happened to carry a matching-group EmploymentRecord.
  describe('updateUserProfile (IDOR fix, 2026-08-08)', () => {
    it('forbids a manager from modifying a fellow manager, even one in scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_mgr2', role: 'MANAGER', first_name: 'Other', last_name: 'Mgr',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });

      await expect(
        service.updateUserProfile('u_mgr2', { first_name: 'Changed' }, 'manager_actor', 'manager', { type: 'global' })
      ).rejects.toMatchObject({ name: 'ForbiddenError', message: 'Only admins can modify manager or admin accounts' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.employmentRecord.findUnique).not.toHaveBeenCalled();
    });

    it('allows a manager to modify their own profile (self-edit exemption)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'manager_actor', role: 'MANAGER', first_name: 'Self', last_name: 'Mgr',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'manager_actor', email: 'mgr@test.com', first_name: 'Changed', last_name: 'Mgr',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUserProfile(
        'manager_actor', { first_name: 'Changed' }, 'manager_actor', 'manager', { type: 'global' }
      );
      expect(result.first_name).toBe('Changed');
      expect(mockPrisma.employmentRecord.findUnique).not.toHaveBeenCalled();
    });

    it('allows a manager to modify an in-scope worker (unchanged target-role class)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', first_name: 'Work', last_name: 'Er',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'my_group' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Changed', last_name: 'Er',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUserProfile(
        'u_worker', { first_name: 'Changed' }, 'manager_actor', 'manager', { type: 'hotel_group', hotel_group_id: 'my_group' }
      );
      expect(result.first_name).toBe('Changed');
    });

    it('allows an admin to modify any account regardless of target role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_mgr2', role: 'MANAGER', first_name: 'Other', last_name: 'Mgr',
        phone: null, permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_mgr2', email: 'mgr2@test.com', first_name: 'Changed', last_name: 'Mgr',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateUserProfile('u_mgr2', { first_name: 'Changed' }, 'admin_actor', 'admin', null);
      expect(result.first_name).toBe('Changed');
    });
  });

  describe('updateUserRole', () => {
    it('always bumps token_generation on an assigned role change', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u_worker', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u_worker', email: 'worker@test.com', first_name: 'Work', last_name: 'Er',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateUserRole('u_worker', { role: 'manager' }, 'admin_actor', 'admin');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u_worker' }, data: expect.objectContaining({ role: 'MANAGER' }) })
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u_worker' }, data: { token_generation: { increment: 1 } } })
      );
    });

    // Vacancy model (2026-08-06, supersedes Regional Manager V1 Decision 11's
    // "transfer OR remove" block): demoting an RM who still owns a group no
    // longer requires an immediate successor -- it auto-clears the group's
    // assignment (vacancy reason DEMOTED) and records it in
    // RegionalManagerAssignmentHistory, rather than throwing ConflictError.
    describe('demoting a Regional Manager/Manager who still owns a group/hotel (vacancy model)', () => {
      it('auto-clears the group and vacates it when demoting a regional_manager who still owns a hotel group', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'rm1', role: 'REGIONAL_MANAGER', permissions: [], is_active: true, deleted_at: null,
        });
        mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', name: 'North Region' });
        mockPrisma.user.update.mockResolvedValue({
          id: 'rm1', email: 'rm@test.com', first_name: 'R', last_name: 'M',
          phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await expect(
          service.updateUserRole('rm1', { role: 'manager' }, 'admin_actor', 'admin')
        ).resolves.toBeDefined();

        expect(mockHotelGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'g1' },
            data: expect.objectContaining({
              regional_manager_user_id: null,
              regional_manager_vacancy_reason: 'DEMOTED',
            }),
          })
        );
        expect(mockPrisma.regionalManagerAssignmentHistory.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { hotel_group_id: 'g1', regional_manager_user_id: 'rm1', unassigned_at: null },
            data: expect.objectContaining({ reason: 'DEMOTED' }),
          })
        );
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'rm1' }, data: expect.objectContaining({ role: 'MANAGER' }) })
        );
      });

      it('auto-clears every hotel and vacates it when demoting a manager who still manages hotels', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'mgr1', role: 'MANAGER', permissions: [], is_active: true, deleted_at: null,
        });
        hotelRows.set('h1', 'mgr1');
        hotelRows.set('h2', 'mgr1');
        mockPrisma.user.update.mockResolvedValue({
          id: 'mgr1', email: 'mgr@test.com', first_name: 'M', last_name: 'G',
          phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await expect(
          service.updateUserRole('mgr1', { role: 'worker' }, 'admin_actor', 'admin')
        ).resolves.toBeDefined();

        expect(mockHotel.update).toHaveBeenCalledTimes(2);
        expect(mockHotel.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'h1' },
            data: expect.objectContaining({ manager_user_id: null, manager_vacancy_reason: 'DEMOTED' }),
          })
        );
        expect(mockPrisma.hotelManagerAssignmentHistory.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { hotel_id: 'h1', manager_user_id: 'mgr1', unassigned_at: null },
            data: expect.objectContaining({ reason: 'DEMOTED' }),
          })
        );
      });

      it('does not touch Hotel at all when demoting a non-manager target', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'w1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
        });
        mockPrisma.user.update.mockResolvedValue({
          id: 'w1', email: 'w@test.com', first_name: 'W', last_name: 'K',
          phone: null, role: 'CHECKER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await service.updateUserRole('w1', { role: 'checker' }, 'admin_actor', 'admin');

        // The single-posting invariant (2026-08-07) reads Hotel back on every
        // call, so "never queried Hotel" is no longer the right assertion.
        // The intent -- this path performs no Hotel WRITE -- is unchanged.
        expect(mockHotel.update).not.toHaveBeenCalled();
      });

      it('allows demoting a regional_manager who owns NO hotel group', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'rm1', role: 'REGIONAL_MANAGER', permissions: [], is_active: true, deleted_at: null,
        });
        mockHotelGroup.findUnique.mockResolvedValue(null);
        mockPrisma.user.update.mockResolvedValue({
          id: 'rm1', email: 'rm@test.com', first_name: 'R', last_name: 'M',
          phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await expect(
          service.updateUserRole('rm1', { role: 'manager' }, 'admin_actor', 'admin')
        ).resolves.toBeDefined();

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'rm1' }, data: expect.objectContaining({ role: 'MANAGER' }) })
        );
      });

      it('does not run the ownership check when the new role is also regional_manager (no-op re-assignment)', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'rm1', role: 'REGIONAL_MANAGER', permissions: [], is_active: true, deleted_at: null,
        });
        mockPrisma.user.update.mockResolvedValue({
          id: 'rm1', email: 'rm@test.com', first_name: 'R', last_name: 'M',
          phone: null, role: 'REGIONAL_MANAGER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await service.updateUserRole('rm1', { role: 'regional_manager' }, 'admin_actor', 'admin');

        expect(mockHotelGroup.findUnique).not.toHaveBeenCalled();
      });

      it('does not run the ownership check for a non-RM target (unaffected roles)', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'w1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
        });
        mockPrisma.user.update.mockResolvedValue({
          id: 'w1', email: 'w@test.com', first_name: 'W', last_name: 'K',
          phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await service.updateUserRole('w1', { role: 'manager' }, 'admin_actor', 'admin');

        expect(mockHotelGroup.findUnique).not.toHaveBeenCalled();
      });

      // Deadlock-avoidance follow-up (post-#339 review): this method locks
      // the target User row FIRST (`SELECT ... FOR UPDATE`), then reads
      // HotelGroup. crm/service.ts#updateHotelGroup (the transfer path) must
      // lock in the SAME order — User before HotelGroup — or the two
      // operations deadlock instead of cleanly serializing under Postgres.
      it('locks the user row before reading HotelGroup ownership (deadlock-avoidance lock order)', async () => {
        const callOrder: string[] = [];
        mockPrisma.$queryRaw.mockImplementation(async () => {
          callOrder.push('user-lock');
          return [];
        });
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'rm1', role: 'REGIONAL_MANAGER', permissions: [], is_active: true, deleted_at: null,
        });
        mockHotelGroup.findUnique.mockImplementation(async () => {
          callOrder.push('hotelgroup-read');
          return null;
        });
        mockPrisma.user.update.mockResolvedValue({
          id: 'rm1', email: 'rm@test.com', first_name: 'R', last_name: 'M',
          phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
        });
        mockPrisma.auditLog.create.mockResolvedValue({});

        await service.updateUserRole('rm1', { role: 'manager' }, 'admin_actor', 'admin');

        expect(callOrder).toEqual(['user-lock', 'hotelgroup-read']);
      });
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

    it('soft-deletes user and bumps token_generation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', deleted_at: null, email: 'u@t.com' });
      mockPrisma.user.update.mockResolvedValue({ id: 'u1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.deleteUser('u1', 'actor', 'admin');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const updateCall = (mockPrisma.user.update as jest.Mock).mock.calls[0] as Array<{ data: { deleted_at: Date; is_active: boolean; token_generation?: unknown } }>;
      expect(updateCall[0]?.data.is_active).toBe(false);
      expect(updateCall[0]?.data.deleted_at).toBeInstanceOf(Date);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ token_generation: { increment: 1 } }) })
      );
    });
  });

  // ── Person-centric assignment redesign (2026-08-07) ────────────────────────
  //
  // updateUserRole() is now the SOLE write path for both role AND
  // manager/RM assignment. crm/service.ts#updateHotel/#updateHotelGroup no
  // longer accept manager_user_id/regional_manager_user_id at all, so the
  // assignment coverage that used to live in hotel.test.ts /
  // hotel-group.test.ts lives here instead -- these tests are that coverage,
  // not additional/optional cases.
  //
  // Root bug this closes: two independent role-write paths existed
  // (PUT /users/:id and PUT /users/:id/role) and only the latter vacated a
  // stale Hotel.manager_user_id / HotelGroup.regional_manager_user_id, so a
  // role change through the wrong endpoint left the person still displayed
  // as a hotel's manager (or a group's RM) forever.
  describe('updateUserRole — person-centric assignment', () => {
    const adminActor = { actorId: 'admin_actor', actorRole: 'admin' };

    beforeEach(() => {
      // no hotels held
      mockHotelGroup.findUnique.mockResolvedValue(null);
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('assigns a manager to a hotel, writing the hotel row and an assignment-history entry', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockHotel.findUnique.mockResolvedValue({ id: 'h1', manager_user_id: null, deleted_at: null });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'm@test.com', first_name: 'M', last_name: 'Gr',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('u1', { role: 'manager', hotel_id: 'h1' }, adminActor.actorId, adminActor.actorRole);

      expect(mockHotel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'h1' },
          data: expect.objectContaining({ manager_user_id: 'u1', manager_vacated_at: null, manager_vacancy_reason: null }),
        })
      );
      expect(mockPrisma.hotelManagerAssignmentHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hotel_id: 'h1', manager_user_id: 'u1' }) })
      );
    });

    it('rejects assigning a manager to a hotel that already has a DIFFERENT manager (one manager per hotel)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockHotel.findUnique.mockResolvedValue({ id: 'h1', manager_user_id: 'someone_else', deleted_at: null });

      await expect(
        service.updateUserRole('u1', { role: 'manager', hotel_id: 'h1' }, adminActor.actorId, adminActor.actorRole)
      ).rejects.toMatchObject({ name: 'ConflictError' });

      expect(mockHotel.update).not.toHaveBeenCalled();
    });

    it('transfers a manager from hotel A to hotel B in ONE transaction: A vacated (TRANSFERRED) and B assigned', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'MANAGER', permissions: [], is_active: true, deleted_at: null,
      });
      hotelRows.set('hA', 'u1');
      mockHotel.findUnique.mockResolvedValue({ id: 'hB', manager_user_id: null, deleted_at: null });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'm@test.com', first_name: 'M', last_name: 'Gr',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('u1', { role: 'manager', hotel_id: 'hB' }, adminActor.actorId, adminActor.actorRole);

      // Old hotel vacated with TRANSFERRED (not DEMOTED — they're still a manager).
      expect(mockHotel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hA' },
          data: expect.objectContaining({ manager_user_id: null, manager_vacancy_reason: 'TRANSFERRED' }),
        })
      );
      // New hotel assigned, same transaction (one $transaction call total).
      expect(mockHotel.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'hB' }, data: expect.objectContaining({ manager_user_id: 'u1' }) })
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('promoting MANAGER -> REGIONAL_MANAGER vacates the old hotel AND assigns the group in one transaction (no dual-role drift)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'MANAGER', permissions: [], is_active: true, deleted_at: null,
      });
      hotelRows.set('hA', 'u1');
      mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: null });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'rm@test.com', first_name: 'R', last_name: 'M',
        phone: null, role: 'REGIONAL_MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('u1', { role: 'regional_manager', hotel_group_id: 'g1' }, adminActor.actorId, adminActor.actorRole);

      // This is the exact drift the redesign exists to prevent: the old hotel
      // manager slot MUST be cleared in the same transaction that grants the
      // RM role, or the user shows as both Hotel Manager and Regional Manager.
      expect(mockHotel.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'hA' }, data: expect.objectContaining({ manager_user_id: null }) })
      );
      expect(mockHotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'g1' }, data: expect.objectContaining({ regional_manager_user_id: 'u1' }) })
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects assigning an RM to a group that already has a DIFFERENT regional manager', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'other_rm' });

      await expect(
        service.updateUserRole('u1', { role: 'regional_manager', hotel_group_id: 'g1' }, adminActor.actorId, adminActor.actorRole)
      ).rejects.toMatchObject({ name: 'ConflictError' });

      expect(mockHotelGroup.update).not.toHaveBeenCalled();
    });

    it('writes hotel_group_id and primary_hotel_id onto a worker\'s EmploymentRecord', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'w1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ id: 'er1' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'w1', email: 'w@test.com', first_name: 'W', last_name: 'Kr',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole(
        'w1', { role: 'worker', hotel_group_id: 'g1', primary_hotel_id: 'h1' },
        adminActor.actorId, adminActor.actorRole
      );

      expect(mockPrisma.employmentRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'er1' },
          data: expect.objectContaining({ hotel_group_id: 'g1', primary_hotel_id: 'h1' }),
        })
      );
    });

    // REQ-EMP-012 (frozen): primary_hotel_id is display/default-selection
    // only. Eligibility stays group-grain -- a worker may work ANY hotel in
    // their group. roster-scope.ts must never read primary_hotel_id; this
    // test documents the boundary at the write side.
    it('does not require primary_hotel_id, and rejects it for non-worker roles', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });

      await expect(
        service.updateUserRole('u1', { role: 'manager', hotel_id: 'h1', primary_hotel_id: 'h2' }, adminActor.actorId, adminActor.actorRole)
      ).rejects.toMatchObject({ name: 'ValidationError' });
    });

    it('allows demoting an RM to plain manager without forcing an immediate hotel posting (vacancy model)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'rm1', role: 'REGIONAL_MANAGER', permissions: [], is_active: true, deleted_at: null,
      });
      mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'rm1', email: 'rm@test.com', first_name: 'R', last_name: 'M',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('rm1', { role: 'manager' }, adminActor.actorId, adminActor.actorRole);

      expect(mockHotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'g1' }, data: expect.objectContaining({ regional_manager_user_id: null }) })
      );
    });
  });
  // ── Single-posting invariant (2026-08-07) ────────────────────────────────
  //
  // Requested at review: make "one user = one organizational posting" an
  // explicit backend guarantee rather than an emergent property of the
  // vacate/assign branches. Asserted on the END STATE inside the transaction,
  // so a violation rolls back instead of committing.
  //
  // These tests bypass the normal branches by seeding a stale row directly --
  // simulating pre-existing bad data or a direct database write, which is
  // exactly what the invariant exists to catch. Hotel.manager_user_id has no
  // unique constraint, so the database cannot enforce this itself.
  describe('updateUserRole — single organizational posting invariant', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'MANAGER', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'REGIONAL_MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('rejects an end state holding BOTH a hotel and a group posting', async () => {
      // ADMIN -> REGIONAL_MANAGER: the MANAGER vacate branch does not fire
      // (the user was not a MANAGER), so a pre-existing hotel posting -- bad
      // data, or a direct database write -- survives into the end state
      // alongside the new group posting. That combination is what the
      // invariant exists to catch.
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'ADMIN', permissions: [], is_active: true, deleted_at: null,
      });
      hotelRows.set('h_stale', 'u1');
      mockHotelGroup.findUnique.mockImplementation(async (args: any) =>
        args?.where?.regional_manager_user_id ? null : { id: 'g1', regional_manager_user_id: null },
      );
      // Assigning the group succeeds; the hotel posting is still there.
      mockHotelGroup.update.mockImplementation(async ({ where, data }: any) => {
        if (data?.regional_manager_user_id) groupRow = { id: where.id, rm: data.regional_manager_user_id };
        return { id: where.id, ...data };
      });

      // Assert the MESSAGE, not just ConflictError: several invariant clauses
      // throw the same error type, so a type-only assertion is satisfied by
      // whichever clause happens to fire first and would not detect this one
      // being removed.
      await expect(
        service.updateUserRole('u1', { role: 'regional_manager', hotel_group_id: 'g1' }, 'admin_actor', 'admin')
      ).rejects.toThrow(/both a Hotel Manager and a Regional Manager/);
    });

    // Pins the group-side role-mismatch clause specifically: a stale GROUP
    // posting surviving onto a role that does not authorize it. Neither
    // vacate branch fires for ADMIN -> WORKER.
    it('rejects a non-RM role left holding a group posting', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'ADMIN', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      groupRow = { id: 'g_stale', rm: 'u1' };

      await expect(
        service.updateUserRole('u1', { role: 'worker' }, 'admin_actor', 'admin')
      ).rejects.toThrow(/cannot hold a Regional Manager posting/);
    });

    it('rejects an end state managing more than one hotel', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      hotelRows.set('h_stale', 'u1');
      mockHotel.findUnique.mockResolvedValue({ id: 'h_new', manager_user_id: null, deleted_at: null });

      await expect(
        service.updateUserRole('u1', { role: 'manager', hotel_id: 'h_new' }, 'admin_actor', 'admin')
      ).rejects.toThrow(/more than one hotel/);
    });

    // A posting must match the role authorizing it: resolveScope() mints the
    // JWT scope claim straight from these columns, so a worker left pointing
    // at a hotel would carry manager scope.
    it('rejects a non-manager role left holding a hotel posting', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'ADMIN', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'WORKER', permissions: [], is_active: true, updated_at: new Date(),
      });
      // ADMIN -> WORKER: neither vacate branch fires (the user was not a
      // MANAGER/RM), so a stale hotel posting survives -- precisely the gap.
      hotelRows.set('h_stale', 'u1');

      await expect(
        service.updateUserRole('u1', { role: 'worker' }, 'admin_actor', 'admin')
      ).rejects.toThrow(/cannot hold a Hotel Manager posting/);
    });

    it('allows a clean single-hotel manager posting', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'WORKER', permissions: [], is_active: true, deleted_at: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ id: 'er1' });
      mockHotel.findUnique.mockResolvedValue({ id: 'h_new', manager_user_id: null, deleted_at: null });

      await expect(
        service.updateUserRole('u1', { role: 'manager', hotel_id: 'h_new' }, 'admin_actor', 'admin')
      ).resolves.toBeDefined();
    });
  });

  // ── Exhaustive role-transition matrix ─────────────────────────────────────
  //
  // Every ordered pair of the 5 roles (20 transitions). The invariant under
  // test is the one the whole redesign exists to enforce: after ANY role
  // change, a prior manager/RM posting the user no longer qualifies for must
  // be vacated in the same transaction -- never left pointing at them.
  //
  // Why exhaustive rather than a few representative cases: the vacate
  // branches are guarded on `newRole !== 'MANAGER'` / `newRole !==
  // 'REGIONAL_MANAGER'`, so which pairs skip a vacate is decided by the
  // branch conditions, not by statement order. A partial matrix would leave
  // exactly those skip conditions untested -- which is where the original
  // bug lived.
  describe('updateUserRole — exhaustive role-transition matrix', () => {
    const ROLES = ['worker', 'checker', 'manager', 'admin', 'regional_manager'] as const;
    type RoleName = (typeof ROLES)[number];
    const upper = (r: RoleName) => r.toUpperCase();

    // Assignment payload required for the destination role, so a transition
    // INTO manager/RM has somewhere to land.
    const payloadFor = (to: RoleName) =>
      to === 'manager'
        ? { hotel_id: 'h_new' }
        : to === 'regional_manager'
          ? { hotel_group_id: 'g_new' }
          : {};

    const pairs: Array<[RoleName, RoleName]> = [];
    for (const from of ROLES) for (const to of ROLES) if (from !== to) pairs.push([from, to]);

    it.each(pairs)('%s -> %s vacates any prior posting and lands on the new role', async (from, to) => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: upper(from), permissions: [], is_active: true, deleted_at: null,
      });
      // The user currently holds whatever posting their OLD role implies.
      if (from === 'manager') hotelRows.set('h_old', 'u1');
      if (from === 'regional_manager') groupRow = { id: 'g_old', rm: 'u1' };
      mockHotelGroup.findUnique.mockImplementation(async (args: any) => {
        // Ownership lookup (by regional_manager_user_id) vs target lookup (by id).
        if (args?.where?.regional_manager_user_id) {
          return from === 'regional_manager' ? { id: 'g_old' } : null;
        }
        return { id: args?.where?.id ?? 'g_new', regional_manager_user_id: null };
      });
      mockHotel.findUnique.mockResolvedValue({ id: 'h_new', manager_user_id: null, deleted_at: null });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue({ id: 'er1' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: upper(to), permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('u1', { role: to, ...payloadFor(to) }, 'admin_actor', 'admin');

      // 1. The role itself always lands.
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ role: upper(to) }) })
      );

      // 2. Leaving MANAGER always vacates the old hotel. (Staying MANAGER is
      //    a transfer, asserted separately -- the old hotel is still vacated,
      //    but with reason TRANSFERRED rather than DEMOTED.)
      if (from === 'manager') {
        expect(mockHotel.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'h_old' },
            data: expect.objectContaining({ manager_user_id: null }),
          })
        );
      }

      // 3. Leaving REGIONAL_MANAGER always vacates the old group.
      if (from === 'regional_manager') {
        expect(mockHotelGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'g_old' },
            data: expect.objectContaining({ regional_manager_user_id: null }),
          })
        );
      }

      // 4. The core invariant, stated directly: the user never ends up
      //    holding a manager posting AND an RM posting at once.
      const assignedHotel = (mockHotel.update as jest.Mock).mock.calls.some(
        (c: any) => c[0]?.data?.manager_user_id === 'u1'
      );
      const assignedGroup = (mockHotelGroup.update as jest.Mock).mock.calls.some(
        (c: any) => c[0]?.data?.regional_manager_user_id === 'u1'
      );
      expect(assignedHotel && assignedGroup).toBe(false);

      // 5. Everything is one atomic unit -- a vacate can never commit
      //    without its paired assignment, or vice versa.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    // The two same-role cases the matrix above excludes (from !== to), both
    // of which are transfers rather than role changes.
    it('manager -> manager transfers hotels, vacating the old one as TRANSFERRED (not DEMOTED)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'MANAGER', permissions: [], is_active: true, deleted_at: null,
      });
      hotelRows.set('h_old', 'u1');
      mockHotel.findUnique.mockResolvedValue({ id: 'h_new', manager_user_id: null, deleted_at: null });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('u1', { role: 'manager', hotel_id: 'h_new' }, 'admin_actor', 'admin');

      expect(mockHotel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'h_old' },
          data: expect.objectContaining({ manager_user_id: null, manager_vacancy_reason: 'TRANSFERRED' }),
        })
      );
      expect(mockHotel.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'h_new' }, data: expect.objectContaining({ manager_user_id: 'u1' }) })
      );
    });

    it('regional_manager -> regional_manager transfers groups, vacating the old one as TRANSFERRED', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', role: 'REGIONAL_MANAGER', permissions: [], is_active: true, deleted_at: null,
      });
      mockHotelGroup.findUnique.mockImplementation(async (args: any) => {
        if (args?.where?.regional_manager_user_id) return { id: 'g_old' };
        return { id: 'g_new', regional_manager_user_id: null };
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', email: 'u@test.com', first_name: 'U', last_name: 'One',
        phone: null, role: 'REGIONAL_MANAGER', permissions: [], is_active: true, updated_at: new Date(),
      });

      await service.updateUserRole('u1', { role: 'regional_manager', hotel_group_id: 'g_new' }, 'admin_actor', 'admin');

      expect(mockHotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'g_old' },
          data: expect.objectContaining({ regional_manager_user_id: null, regional_manager_vacancy_reason: 'TRANSFERRED' }),
        })
      );
      expect(mockHotelGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'g_new' }, data: expect.objectContaining({ regional_manager_user_id: 'u1' }) })
      );
    });
  });
});
