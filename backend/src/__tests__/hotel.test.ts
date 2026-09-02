import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  hotel: {
    // Asserted NEVER to be called: delete is soft, and a hard delete belongs
    // in a separate PURGE operation.
    delete: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotelGroup: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotelWorker: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // updateHotel()'s manager-assignment path validates the target user
  // (assertHotelManagerExists) and, on an actual manager change, bumps
  // token_generation for the outgoing/incoming manager inside a transaction.
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  // Vacancy-history model (2026-08-06): updateHotel() records manager
  // assign/unassign transitions in this table.
  hotelManagerAssignmentHistory: {
    create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
    updateMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 1 }),
  },
  // Cascade-cancel fix (2026-08-08): deactivateHotel()/deleteHotel() now
  // delegate to jobRequestService/assignmentService (real singletons, not
  // mocked -- they call getPrisma() internally, hitting this same mock).
  // No active rows in any lifecycle test fixture here, so an empty result
  // makes the cascade a no-op by default; unless a specific test opts in.
  jobRequest: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  workerAssignment: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(0),
  },
  // AssignmentService.update() (invoked by the cascade above) also touches
  // these on any CANCELLED transition (refreshWorkerOverallRating,
  // notification enqueue) -- defaulted to empty/no-op so the cascade tests
  // don't need to know AssignmentService's own internals.
  // refreshWorkerOverallRating() reads QualityVerification for the quality
  // half of the rating (2026-08-29). Neutral fixture: no checks recorded.
  qualityVerification: { aggregate: async () => ({ _avg: { score: null }, _count: 0 }), findMany: async () => [] },
  rating: {
    aggregate: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({
      _avg: { score: 0 },
      _count: 0,
    }),
  },
  attendance: {
    count: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(0),
    updateMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 0 }),
  },
  workerOverallRating: {
    upsert: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
  },
  jobRequestSkillSlot: {
    update: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}),
  },
  notification: {
    create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ id: 'notif-1' }),
  },
  outboxEvent: {
    create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ id: 'outbox-1' }),
  },
  employmentRecord: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  },
  // updateHotel()'s manager-change path takes a row lock on the affected
  // user(s) before writing, mirroring updateHotelGroup's RM-transfer fix.
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

// C-05 fix (2026-08-05): listHotels() roster-scopes a `worker`'s results via
// lib/roster-scope.js#listEligibleHotelIds, which is not reachable through
// `this.prisma` (it calls getPrisma() internally) — mocked directly.
const mockListEligibleHotelIds = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
jest.mock('../lib/roster-scope.js', () => ({
  listEligibleHotelIds: (...args: unknown[]) => mockListEligibleHotelIds(...args),
}));

import { CrmService } from '../modules/crm/service.js';

describe('CrmService - Hotels', () => {
  let service: CrmService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CrmService();
  });

  describe('listHotels', () => {
    it('returns paginated hotels for admin', async () => {
      const fakeHotels = [
        { id: 'h1', name: 'Grand Hotel', city: 'Berlin', country: 'Germany', address: 'Street 1', timezone: 'Europe/Berlin', is_active: true, created_at: new Date(), updated_at: new Date(), _count: { rooms: 10 } },
      ];
      mockPrisma.hotel.findMany.mockResolvedValue(fakeHotels);
      mockPrisma.hotel.count.mockResolvedValue(1);

      const result = await service.listHotels({ page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined }, 'admin');

      expect(result.hotels).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
    });

    it('returns exclusively deleted hotels for admin when only_deleted is passed', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);

      await service.listHotels({ page: 1, limit: 20, only_deleted: 'true' }, 'admin');

      const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { deleted_at?: unknown } }>;
      expect(findManyCall[0]?.where.deleted_at).toEqual({ not: null });
    });

    it('only shows active hotels for workers', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);
      mockListEligibleHotelIds.mockResolvedValue(['h1']);

      await service.listHotels({ page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined }, 'worker', 'w1');

      const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { is_active?: boolean } }>;
      expect(findManyCall[0]?.where.is_active).toBe(true);
    });

    // C-05 fix (2026-08-05): ADR-030 §3 grants `worker` C-05 ("View hotels")
    // ✓ᶜ, and the sibling detail route (GET /hotels/:hotel_id) already
    // roster-scopes a worker via isWorkerEligibleForHotel(). Widening the
    // LIST route's role gate to admit `worker` without also roster-scoping
    // its results would have leaked every active hotel on the platform to
    // every worker — a strictly worse outcome than the 403 it replaced. This
    // pins that the list is scoped identically to the detail route.
    it('scopes a worker\'s hotel list to their roster-eligible hotels (C-05)', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);
      mockListEligibleHotelIds.mockResolvedValue(['h1', 'h2']);

      await service.listHotels({ page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined }, 'worker', 'w1');

      expect(mockListEligibleHotelIds).toHaveBeenCalledWith('w1');
      const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: { in: string[] } } }>;
      expect(findManyCall[0]?.where.id).toEqual({ in: ['h1', 'h2'] });
    });

    it('denies (empty-in) a worker\'s hotel list when the roster resolves to zero hotels', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);
      mockListEligibleHotelIds.mockResolvedValue([]);

      await service.listHotels({ page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined }, 'worker', 'w_orphan');

      const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: { in: string[] } } }>;
      expect(findManyCall[0]?.where.id).toEqual({ in: [] });
    });

    // Matches resolveHotelAccess()'s documented cross-hotel bypass for
    // checker on the DETAIL route (PATCH-04 §4c) — the list must not be
    // roster-scoped for checker, or it would be narrower than the detail
    // route it's supposed to match.
    it('does NOT roster-scope a checker\'s hotel list (matches the detail-route cross-hotel bypass)', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);

      await service.listHotels({ page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined }, 'checker', 'c1');

      expect(mockListEligibleHotelIds).not.toHaveBeenCalled();
      const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: unknown } }>;
      expect(findManyCall[0]?.where.id).toBeUndefined();
    });

    // IDOR fix (2026-08-08): a manager/regional_manager previously got NO
    // scope filtering here at all -- only the is_active override, which
    // narrows the default filter, not which hotels are visible. Any manager
    // could list every hotel platform-wide.
    describe('manager/regional_manager scope (IDOR fix, 2026-08-08)', () => {
      it("scopes a hotel-scoped manager's list to their own hotel only", async () => {
        mockPrisma.hotel.findMany.mockResolvedValue([]);
        mockPrisma.hotel.count.mockResolvedValue(0);

        await service.listHotels(
          { page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined },
          'manager',
          'mgr_1',
          { type: 'hotel', hotel_id: 'h1' }
        );

        const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: unknown } }>;
        expect(findManyCall[0]?.where.id).toBe('h1');
      });

      it("scopes a regional_manager's list to their hotel_group only", async () => {
        mockPrisma.hotel.findMany.mockResolvedValue([]);
        mockPrisma.hotel.count.mockResolvedValue(0);

        await service.listHotels(
          { page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined },
          'regional_manager',
          'rm_1',
          { type: 'hotel_group', hotel_group_id: 'g1' }
        );

        const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{
          where: { hotel_group_id?: unknown };
        }>;
        expect(findManyCall[0]?.where.hotel_group_id).toBe('g1');
      });

      it('denies (no rows) a manager with no scope claim', async () => {
        mockPrisma.hotel.findMany.mockResolvedValue([]);
        mockPrisma.hotel.count.mockResolvedValue(0);

        await service.listHotels(
          { page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined },
          'manager',
          'mgr_1',
          null
        );

        const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: unknown } }>;
        expect(findManyCall[0]?.where.id).toBe('__none__');
      });

      it("denies (no rows) a hotel-scoped manager who passes a different hotel_group_id filter", async () => {
        mockPrisma.hotel.findMany.mockResolvedValue([]);
        mockPrisma.hotel.count.mockResolvedValue(0);

        await service.listHotels(
          { page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined, hotel_group_id: 'g_other' },
          'manager',
          'mgr_1',
          { type: 'hotel', hotel_id: 'h1' }
        );

        const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: unknown } }>;
        expect(findManyCall[0]?.where.id).toBe('h1');
      });

      it('does not scope-restrict an admin list', async () => {
        mockPrisma.hotel.findMany.mockResolvedValue([]);
        mockPrisma.hotel.count.mockResolvedValue(0);

        await service.listHotels(
          { page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined },
          'admin',
          'adm_1',
          { type: 'global' }
        );

        const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { id?: unknown } }>;
        expect(findManyCall[0]?.where.id).toBeUndefined();
      });
    });
  });

  describe('createHotel', () => {
    it('creates and returns a hotel', async () => {
      const fake = { id: 'h1', name: 'Test Hotel', city: 'Munich', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, created_at: new Date(), updated_at: new Date() };
      mockPrisma.hotel.create.mockResolvedValue(fake);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createHotel({ name: 'Test Hotel', city: 'Munich', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin' }, 'actor_1', 'admin');

      expect(result.name).toBe('Test Hotel');
      expect(mockPrisma.hotel.create).toHaveBeenCalledTimes(1);
    });

    it('GD-14/OD-GEO-001/004: persists latitude/longitude when provided on create', async () => {
      const fake = { id: 'h1', name: 'Test Hotel', city: 'Munich', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, latitude: 52.52, longitude: 13.405, created_at: new Date(), updated_at: new Date() };
      mockPrisma.hotel.create.mockResolvedValue(fake);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createHotel(
        { name: 'Test Hotel', city: 'Munich', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', latitude: 52.52, longitude: 13.405 },
        'actor_1',
        'admin',
      );

      expect(result.latitude).toBe(52.52);
      expect(result.longitude).toBe(13.405);
      const createCall = (mockPrisma.hotel.create as jest.Mock).mock.calls[0] as Array<{ data: { latitude: number; longitude: number } }>;
      expect(createCall[0]?.data.latitude).toBe(52.52);
      expect(createCall[0]?.data.longitude).toBe(13.405);
    });
  });

  describe('updateHotel', () => {
    it('assigns hotel_group_id when it references an existing hotel group (Epic 5 PR 5.3)', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', city: 'Hamburg', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, hotel_group_id: null };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'hg_1', name: 'Berlin Group' });
      mockPrisma.hotel.update.mockResolvedValue({ ...hotel, hotel_group_id: 'hg_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateHotel('h1', { hotel_group_id: 'hg_1' }, 'admin_1', 'admin');

      expect(result.hotel_group_id).toBe('hg_1');
      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { hotel_group_id: string } }>;
      expect(updateCall[0]?.data.hotel_group_id).toBe('hg_1');
    });

    it('rejects assignment to a nonexistent hotel group without writing', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', name: 'Hotel X', hotel_group_id: null });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.updateHotel('h1', { hotel_group_id: 'nonexistent' }, 'admin_1', 'admin')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.hotel.update).not.toHaveBeenCalled();
    });

    it('leaves hotel_group_id unchanged when not provided in the update', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', city: 'Hamburg', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, hotel_group_id: 'hg_existing' };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotel.update.mockResolvedValue(hotel);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotel('h1', { name: 'Renamed Hotel' }, 'admin_1', 'admin');

      expect(mockPrisma.hotelGroup.findUnique).not.toHaveBeenCalled();
      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { hotel_group_id: string } }>;
      expect(updateCall[0]?.data.hotel_group_id).toBe('hg_existing');
    });

    it('GD-05: toggles accepting_jobs when provided', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', city: 'Hamburg', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, accepting_jobs: true, hotel_group_id: null };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotel.update.mockResolvedValue({ ...hotel, accepting_jobs: false });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateHotel('h1', { accepting_jobs: false }, 'admin_1', 'admin');

      expect(result.accepting_jobs).toBe(false);
      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { accepting_jobs: boolean } }>;
      expect(updateCall[0]?.data.accepting_jobs).toBe(false);
    });

    it('GD-05: leaves accepting_jobs unchanged when not provided in the update', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', city: 'Hamburg', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, accepting_jobs: false, hotel_group_id: null };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotel.update.mockResolvedValue(hotel);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotel('h1', { name: 'Renamed Hotel' }, 'admin_1', 'admin');

      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { accepting_jobs: boolean } }>;
      expect(updateCall[0]?.data.accepting_jobs).toBe(false);
    });

    it('GD-14/OD-GEO-001/004: sets latitude/longitude when provided', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', city: 'Hamburg', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, accepting_jobs: true, hotel_group_id: null, latitude: null, longitude: null };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotel.update.mockResolvedValue({ ...hotel, latitude: 52.52, longitude: 13.405 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.updateHotel('h1', { latitude: 52.52, longitude: 13.405 }, 'admin_1', 'admin');

      expect(result.latitude).toBe(52.52);
      expect(result.longitude).toBe(13.405);
      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { latitude: number; longitude: number } }>;
      expect(updateCall[0]?.data.latitude).toBe(52.52);
      expect(updateCall[0]?.data.longitude).toBe(13.405);
    });

    it('GD-14: leaves latitude/longitude unchanged when not provided in the update', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', city: 'Hamburg', country: 'Germany', address: 'Addr', timezone: 'Europe/Berlin', is_active: true, accepting_jobs: true, hotel_group_id: null, latitude: 52.52, longitude: 13.405 };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotel.update.mockResolvedValue(hotel);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotel('h1', { name: 'Renamed Hotel' }, 'admin_1', 'admin');

      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { latitude: number; longitude: number } }>;
      expect(updateCall[0]?.data.latitude).toBe(52.52);
      expect(updateCall[0]?.data.longitude).toBe(13.405);
    });

    it('clears hotel_group_id when explicitly set to null', async () => {
      const hotel = { id: 'h1', name: 'Hotel X', hotel_group_id: 'hg_existing', manager_user_id: null };
      mockPrisma.hotel.findUnique.mockResolvedValue(hotel);
      mockPrisma.hotel.update.mockResolvedValue({ ...hotel, hotel_group_id: null });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotel('h1', { hotel_group_id: null }, 'admin_1', 'admin');

      expect(mockPrisma.hotelGroup.findUnique).not.toHaveBeenCalled();
      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { hotel_group_id: string | null } }>;
      expect(updateCall[0]?.data.hotel_group_id).toBeNull();
    });

    // ADR-025: Hotel.manager_user_id is the sole source of a Hotel Manager's
    // JWT scope claim (auth/service.ts#resolveScope) — these lock the write
    // path plus the token-generation bump that invalidates any live token
    // minted under the pre-change scope.
    // Person-centric assignment redesign (2026-08-07): updateHotel no longer
    // accepts manager_user_id (or manager_assigned_at/vacated_at/
    // vacancy_reason). Manager assignment moved to
    // users/service.ts#updateUserRole -- the single authoritative role+
    // assignment write path -- so the ADR-025 assignment/validation/TOCTOU/
    // lock-order/token-bump coverage that lived in this describe now lives
    // in users.test.ts's "updateUserRole - person-centric assignment" block.
    it('never writes manager_user_id, even indirectly', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', name: 'Old', manager_user_id: 'mgr_1' });
      mockPrisma.hotel.update.mockResolvedValue({ id: 'h1', name: 'New' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.updateHotel('h1', { name: 'New' }, 'admin_1', 'admin');

      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: Record<string, unknown> }>;
      expect(updateCall[0]?.data).not.toHaveProperty('manager_user_id');
      // No token bump either: this path can no longer change anyone's scope.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getHotel', () => {
    it('returns hotel when found', async () => {
      const fake = { id: 'h1', name: 'Hotel X', city: 'Hamburg', _count: { rooms: 5 } };
      mockPrisma.hotel.findUnique.mockResolvedValue(fake);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.getHotel('h1', 'actor_1', 'manager');
      expect(result.id).toBe('h1');
    });

    it('throws NotFoundError when hotel not found', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(null);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await expect(service.getHotel('nonexistent', 'actor', 'admin')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });
  });

  // Entity lifecycle (2026-08-07). DEACTIVATED and DELETED are distinct in
  // kind, not degree: deactivation is a reversible operational pause;
  // deletion removes the hotel from operations entirely and returns only
  // through an explicit admin restore.
  describe('lifecycle', () => {
    const active = { id: 'h1', name: 'Grand', is_active: true, deleted_at: null };
    const deactivated = { id: 'h1', name: 'Grand', is_active: false, deleted_at: null };
    const deleted = { id: 'h1', name: 'Grand', is_active: false, deleted_at: new Date('2026-08-01') };

    beforeEach(() => {
      mockPrisma.hotel.update.mockResolvedValue({ id: 'h1' });
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('deactivate touches is_active only, never deleted_at', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(active);
      await service.deactivateHotel('h1', 'a1', 'admin');
      expect(mockPrisma.hotel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: false } })
      );
    });

    it('reactivate returns a deactivated hotel to active', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(deactivated);
      await service.reactivateHotel('h1', 'a1', 'admin');
      expect(mockPrisma.hotel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: true } })
      );
    });

    it('delete sets deleted_at AND is_active=false, so the columns cannot disagree', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(active);
      await service.deleteHotel('h1', 'a1', 'admin');
      const data = (mockPrisma.hotel.update as jest.Mock).mock.calls[0][0] as { data: { is_active: boolean; deleted_at: Date } };
      expect(data.data.is_active).toBe(false);
      expect(data.data.deleted_at).toBeInstanceOf(Date);
    });

    // Mirror of the hotel-group case reported live: an archived group kept
    // holding its Regional Manager, and because that column is unique the
    // person could not be posted anywhere else -- while their own profile
    // read as unassigned, since the thing holding them was archived out of
    // every list. Hotel.manager_user_id has the same shape, so it had the
    // same defect.
    //
    // Deliberately NOT reversed by restoreHotel: months on, whoever ran the
    // hotel may be gone or posted elsewhere, so the slot comes back open.
    it('delete releases the manager so they can be posted elsewhere', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ ...active, manager_user_id: 'mgr_1' });

      await service.deleteHotel('h1', 'a1', 'admin');

      const [{ data }] = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data.manager_user_id).toBeNull();
      expect(data.manager_vacated_at).toBeInstanceOf(Date);
      expect(data.manager_vacancy_reason).toBe('TERMINATED');

      expect(mockPrisma.hotelManagerAssignmentHistory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            hotel_id: 'h1',
            manager_user_id: 'mgr_1',
            unassigned_at: null,
          }),
        })
      );

      // resolveScope derives a manager's scope from this pointer, and
      // authMiddleware reads `scope` off the JWT -- so the token must be
      // invalidated with the change (ADR-031 D-4) or they keep the old scope
      // until it expires.
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mgr_1' },
          data: { token_generation: { increment: 1 } },
        })
      );
    });

    it('archives a vacant hotel without touching assignment history', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ ...active, manager_user_id: null });

      await service.deleteHotel('h1', 'a1', 'admin');

      expect(mockPrisma.hotelManagerAssignmentHistory.updateMany).not.toHaveBeenCalled();
      // Nobody lost a posting, so nobody is signed out.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('delete never removes the row (PURGE is a separate operation)', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(active);
      await service.deleteHotel('h1', 'a1', 'admin');
      expect(mockPrisma.hotel.delete).not.toHaveBeenCalled();
    });

    it('restore clears both columns together', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(deleted);
      await service.restoreHotel('h1', 'a1', 'admin');
      expect(mockPrisma.hotel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: true, deleted_at: null } })
      );
    });

    // Deactivate/reactivate are for the temporary pause only. A deleted hotel
    // must be restored first -- otherwise "reactivate" would half-resurrect it
    // (is_active true, deleted_at still set), which is the exact broken state
    // this lifecycle exists to eliminate.
    it.each([
      ['deactivateHotel'],
      ['reactivateHotel'],
    ])('%s refuses to operate on a deleted hotel', async (method) => {
      mockPrisma.hotel.findUnique.mockResolvedValue(deleted);
      await expect(
        (service as never as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!('h1', 'a1', 'admin')
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockPrisma.hotel.update).not.toHaveBeenCalled();
    });

    // Cascade-cancel fix (2026-08-08): deactivate/delete previously only
    // touched the Hotel row; active JobRequests and WorkerAssignments at
    // that hotel stayed OPEN/CONFIRMED indefinitely.
    describe('cascade-cancel hotel work (2026-08-08 fix)', () => {
      it('deactivateHotel cancels active job requests and assignments at the hotel', async () => {
        mockPrisma.hotel.findUnique.mockResolvedValue(active);
        mockPrisma.jobRequest.findMany.mockResolvedValue([{ id: 'jr1' }]);
        const jrBase = {
          id: 'jr1',
          hotel_id: 'h1',
          created_by_id: 'admin_1',
          position: 'cleaner',
          workers_needed: 2,
          workers_confirmed: 0,
          shift_date: new Date('2026-07-01T00:00:00Z'),
          shift_start_time: '08:00',
          shift_end_time: '16:00',
          hourly_rate: null,
          currency: 'EUR',
          description: null,
          requirements: null,
          published_at: null,
          expires_at: null,
          filled_at: null,
          cancelled_at: null,
          cancellation_reason: null,
          created_at: new Date('2026-06-01T00:00:00Z'),
          updated_at: new Date('2026-06-01T00:00:00Z'),
        };
        mockPrisma.jobRequest.findUnique.mockResolvedValue({ ...jrBase, status: 'OPEN' });
        mockPrisma.jobRequest.update.mockResolvedValue({
          ...jrBase,
          status: 'CANCELLED',
          cancellation_reason: 'The hotel was deactivated or deleted',
        });
        mockPrisma.workerAssignment.findMany.mockResolvedValue([{ id: 'a1' }]);
        mockPrisma.workerAssignment.findUnique.mockResolvedValue({
          id: 'a1',
          hotel_id: 'h1',
          worker_id: 'w1',
          assigned_by_id: 'admin_1',
          status: 'CONFIRMED',
          confirmed_at: new Date('2026-06-01T00:00:00Z'),
          started_at: null,
          completed_at: null,
          cancelled_at: null,
          cancellation_reason: null,
          updated_at: new Date('2026-06-01T00:00:00Z'),
          work_request_id: null,
          job_request_id: null,
          skill_slot_id: null,
        });
        mockPrisma.workerAssignment.update.mockResolvedValue({
          id: 'a1',
          hotel_id: 'h1',
          worker_id: 'w1',
          assigned_by_id: 'admin_1',
          status: 'CANCELLED',
          confirmed_at: new Date('2026-06-01T00:00:00Z'),
          started_at: null,
          completed_at: null,
          cancelled_at: new Date(),
          cancellation_reason: 'The hotel was deactivated or deleted',
          updated_at: new Date(),
        });

        await service.deactivateHotel('h1', 'admin_1', 'admin');

        expect(mockPrisma.jobRequest.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'jr1' },
            data: expect.objectContaining({ status: 'CANCELLED' }),
          })
        );
        expect(mockPrisma.workerAssignment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'a1' },
            data: expect.objectContaining({ status: 'CANCELLED' }),
          })
        );
      });

      it('deleteHotel cancels active job requests and assignments at the hotel', async () => {
        mockPrisma.hotel.findUnique.mockResolvedValue(active);
        mockPrisma.jobRequest.findMany.mockResolvedValue([]);
        mockPrisma.workerAssignment.findMany.mockResolvedValue([{ id: 'a2' }]);
        mockPrisma.workerAssignment.findUnique.mockResolvedValue({
          id: 'a2',
          hotel_id: 'h1',
          worker_id: 'w2',
          assigned_by_id: 'admin_1',
          status: 'IN_PROGRESS',
          confirmed_at: new Date('2026-06-01T00:00:00Z'),
          started_at: new Date('2026-06-01T08:00:00Z'),
          completed_at: null,
          cancelled_at: null,
          cancellation_reason: null,
          updated_at: new Date('2026-06-01T00:00:00Z'),
          work_request_id: null,
          job_request_id: null,
          skill_slot_id: null,
        });
        mockPrisma.workerAssignment.update.mockResolvedValue({
          id: 'a2',
          hotel_id: 'h1',
          worker_id: 'w2',
          assigned_by_id: 'admin_1',
          status: 'CANCELLED',
          confirmed_at: new Date('2026-06-01T00:00:00Z'),
          started_at: new Date('2026-06-01T08:00:00Z'),
          completed_at: null,
          cancelled_at: new Date(),
          cancellation_reason: 'The hotel was deactivated or deleted',
          updated_at: new Date(),
        });

        await service.deleteHotel('h1', 'admin_1', 'admin');

        expect(mockPrisma.workerAssignment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'a2' },
            data: expect.objectContaining({ status: 'CANCELLED' }),
          })
        );
      });

      it('does not touch job requests or assignments when none are active at the hotel', async () => {
        mockPrisma.hotel.findUnique.mockResolvedValue(active);
        mockPrisma.jobRequest.findMany.mockResolvedValue([]);
        mockPrisma.workerAssignment.findMany.mockResolvedValue([]);

        await service.deactivateHotel('h1', 'admin_1', 'admin');

        expect(mockPrisma.jobRequest.update).not.toHaveBeenCalled();
        expect(mockPrisma.workerAssignment.update).not.toHaveBeenCalled();
      });
    });

    it('rejects double-delete and restore-of-a-live-hotel', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(deleted);
      await expect(service.deleteHotel('h1', 'a1', 'admin')).rejects.toMatchObject({ name: 'ConflictError' });
      mockPrisma.hotel.findUnique.mockResolvedValue(active);
      await expect(service.restoreHotel('h1', 'a1', 'admin')).rejects.toMatchObject({ name: 'ConflictError' });
    });
  });

  // The point of the whole change: a deleted entity must not appear in normal
  // operational reads. Asserting the WHERE clause, not just the result -- the
  // mock returns whatever it is told, so a result-only test passes against the
  // unfiltered query.
  describe('deleted entities are invisible to operational reads', () => {
  // mock.calls entries are `unknown`; one narrowing helper beats casting at
  // every assertion.
  const findManyWhere = () =>
    ((mockPrisma.hotel.findMany as jest.Mock).mock.calls[0]![0] as {
      where: Record<string, unknown>;
    }).where;

    it('listHotels excludes deleted by default', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);
      await service.listHotels({ page: 1, limit: 20 } as never, 'admin');
      expect(findManyWhere().deleted_at).toBeNull();
    });

    it('listHotels admits deleted only for an admin passing include_deleted', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);
      await service.listHotels({ page: 1, limit: 20, include_deleted: 'true' } as never, 'admin');
      expect(findManyWhere().deleted_at).toBeUndefined();
    });

    // A non-admin cannot widen their own visibility by passing the flag.
    it('listHotels ignores include_deleted for a non-admin', async () => {
      mockPrisma.hotel.findMany.mockResolvedValue([]);
      mockPrisma.hotel.count.mockResolvedValue(0);
      await service.listHotels({ page: 1, limit: 20, include_deleted: 'true' } as never, 'manager');
      expect(findManyWhere().deleted_at).toBeNull();
    });

    // 404 rather than 403: a caller who should not see the hotel should not
    // learn that it exists.
    it('getHotel reports a deleted hotel as not found', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({
        id: 'h1', name: 'Grand', is_active: false, deleted_at: new Date(),
      });
      await expect(service.getHotel('h1', 'a1', 'admin')).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('getHotel surfaces a deleted hotel to an admin viewing the archive', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({
        id: 'h1', name: 'Grand', is_active: false, deleted_at: new Date(),
      });
      mockPrisma.auditLog.create.mockResolvedValue({});
      await expect(service.getHotel('h1', 'a1', 'admin', undefined, true)).resolves.toBeDefined();
    });
  });

  describe('deleteHotel', () => {
    it('soft-deletes by deactivating', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', name: 'Hotel', is_active: true });
      mockPrisma.hotel.update.mockResolvedValue({ id: 'h1', is_active: false });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.deleteHotel('h1', 'admin_1', 'admin');

      const updateCall = (mockPrisma.hotel.update as jest.Mock).mock.calls[0] as Array<{ data: { is_active: boolean } }>;
      expect(updateCall[0]?.data.is_active).toBe(false);
    });
  });
});
