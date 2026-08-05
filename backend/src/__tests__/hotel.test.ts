import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  hotel: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotelGroup: {
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
