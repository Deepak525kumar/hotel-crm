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

      await service.listHotels({ page: 1, limit: 20, country: undefined, search: undefined, is_active: undefined }, 'worker');

      const findManyCall = (mockPrisma.hotel.findMany as jest.Mock).mock.calls[0] as Array<{ where: { is_active?: boolean } }>;
      expect(findManyCall[0]?.where.is_active).toBe(true);
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
