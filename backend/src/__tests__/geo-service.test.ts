import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-GEO-001 @0.1.2 FROZEN, GD-14 Decided 2026-07-27: GeoService unit tests.
 * Covers TREQ-GEO-001/003/004/006, RULE-GEO-001/003/004, OD-GEO-003
 * (fail-closed), OD-GEO-005 (distance/pass-fail only, never raw
 * coordinates), OD-GEO-007 (audit logging).
 */

const mockWorkerGeoCheckinCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockWorkerGeoCheckinFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockWorkerGeoCheckinFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockWorkerGeoCheckinCount = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerGeoCheckin: {
      create: mockWorkerGeoCheckinCreate,
      findMany: mockWorkerGeoCheckinFindMany,
      findUnique: mockWorkerGeoCheckinFindUnique,
      count: mockWorkerGeoCheckinCount,
    },
    hotel: { findUnique: mockHotelFindUnique, findMany: mockHotelFindMany },
    auditLog: { create: mockAuditLogCreate },
  }),
}));

jest.mock('../middleware/permissions.js', () => ({
  isHotelInScope: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { GeoService } from '../modules/geo/service.js';
import { isHotelInScope } from '../middleware/permissions.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';

const mockIsHotelInScope = isHotelInScope as jest.MockedFunction<typeof isHotelInScope>;

describe('GeoService (SPEC-GEO-001, GD-14)', () => {
  let service: GeoService;

  beforeEach(() => {
    service = new GeoService();
    mockWorkerGeoCheckinCreate.mockReset();
    mockWorkerGeoCheckinFindMany.mockReset();
    mockWorkerGeoCheckinFindUnique.mockReset();
    mockWorkerGeoCheckinCount.mockReset();
    mockHotelFindUnique.mockReset();
    mockHotelFindMany.mockReset();
    mockAuditLogCreate.mockReset();
    mockIsHotelInScope.mockReset();
  });

  describe('checkIn — RULE-GEO-001/OD-GEO-003 fail-closed', () => {
    it('rejects with NotFoundError when the hotel has no coordinates configured', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: null, longitude: null });

      await expect(
        service.checkIn('w1', { hotel_id: 'h1', latitude: 52.52, longitude: 13.405 }, 'worker')
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockWorkerGeoCheckinCreate).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundError when the hotel does not exist', async () => {
      mockHotelFindUnique.mockResolvedValue(null);

      await expect(
        service.checkIn('w1', { hotel_id: 'missing', latitude: 52.52, longitude: 13.405 }, 'worker')
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(mockWorkerGeoCheckinCreate).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundError when only latitude is set (partial coordinates)', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: 52.52, longitude: null });

      await expect(
        service.checkIn('w1', { hotel_id: 'h1', latitude: 52.52, longitude: 13.405 }, 'worker')
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('checkIn — TREQ-GEO-001/004, RULE-GEO-001', () => {
    beforeEach(() => {
      mockHotelFindUnique.mockResolvedValue({ latitude: 52.52, longitude: 13.405 });
    });

    it('marks inside_radius=true when within 100m and persists the raw coordinates', async () => {
      mockWorkerGeoCheckinCreate.mockResolvedValue({
        id: 'c1',
        worker_id: 'w1',
        hotel_id: 'h1',
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });

      const result = await service.checkIn(
        'w1',
        { hotel_id: 'h1', latitude: 52.52001, longitude: 13.405 },
        'worker'
      );

      expect(result.inside_radius).toBe(true);
      expect(mockWorkerGeoCheckinCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            worker_id: 'w1',
            hotel_id: 'h1',
            latitude: 52.52001,
            longitude: 13.405,
            inside_radius: true,
          }),
        })
      );
    });

    it('marks inside_radius=false when outside 100m, but still records the check-in (TREQ-GEO-004)', async () => {
      mockWorkerGeoCheckinCreate.mockResolvedValue({
        id: 'c2',
        worker_id: 'w1',
        hotel_id: 'h1',
        distance_meters: 5000,
        inside_radius: false,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });

      const result = await service.checkIn(
        'w1',
        { hotel_id: 'h1', latitude: 52.57, longitude: 13.405 },
        'worker'
      );

      expect(result.inside_radius).toBe(false);
      expect(mockWorkerGeoCheckinCreate).toHaveBeenCalled();
    });

    it('never returns latitude/longitude in the DTO (OD-GEO-005/RULE-GEO-003)', async () => {
      mockWorkerGeoCheckinCreate.mockResolvedValue({
        id: 'c1',
        worker_id: 'w1',
        hotel_id: 'h1',
        latitude: 52.52001,
        longitude: 13.405,
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });

      const result = await service.checkIn(
        'w1',
        { hotel_id: 'h1', latitude: 52.52001, longitude: 13.405 },
        'worker'
      );

      expect(result).not.toHaveProperty('latitude');
      expect(result).not.toHaveProperty('longitude');
      expect(result).toEqual(
        expect.objectContaining({ distance_meters: 5, inside_radius: true })
      );
    });

    it('audit-logs the check-in without leaking raw coordinates (OD-GEO-007)', async () => {
      mockWorkerGeoCheckinCreate.mockResolvedValue({
        id: 'c1',
        worker_id: 'w1',
        hotel_id: 'h1',
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });

      await service.checkIn('w1', { hotel_id: 'h1', latitude: 52.52001, longitude: 13.405 }, 'worker');

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const auditCall = mockAuditLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(auditCall.data.action).toBe('GEOFENCE_CHECK');
      expect(auditCall.data.resource_type).toBe('WORKER_GEO_CHECKIN');
      const details = auditCall.data.details as Record<string, unknown>;
      expect(details).not.toHaveProperty('latitude');
      expect(details).not.toHaveProperty('longitude');
      // The audit details reflect the actually-computed distance (not the
      // mocked create() return value) -- a small offset from the hotel's
      // coordinates is well within the 100m radius.
      expect(typeof details.distance_meters).toBe('number');
      expect(details.distance_meters as number).toBeLessThan(100);
      expect(details.inside_radius).toBe(true);
    });
  });

  describe('isGeofenceConfigured — GD-14 lets Attendance require location upfront', () => {
    it('returns false when the hotel has no coordinates', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: null, longitude: null });
      await expect(service.isGeofenceConfigured('h1')).resolves.toBe(false);
    });

    it('returns false when the hotel does not exist', async () => {
      mockHotelFindUnique.mockResolvedValue(null);
      await expect(service.isGeofenceConfigured('missing')).resolves.toBe(false);
    });

    it('returns true when both coordinates are set', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: 52.52, longitude: 13.405 });
      await expect(service.isGeofenceConfigured('h1')).resolves.toBe(true);
    });
  });

  describe('verifyGeofence — GD-14 shared interface for Attendance', () => {
    it('returns not_configured instead of throwing when hotel coordinates are missing', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: null, longitude: null });

      const result = await service.verifyGeofence(
        'w1',
        { hotel_id: 'h1', latitude: 52.52, longitude: 13.405 },
        'worker'
      );

      expect(result).toEqual({ status: 'not_configured' });
      expect(mockWorkerGeoCheckinCreate).not.toHaveBeenCalled();
    });

    it('returns verified with insideRadius=true and persists/audits the same as checkIn()', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: 52.52, longitude: 13.405 });
      mockWorkerGeoCheckinCreate.mockResolvedValue({
        id: 'c1',
        worker_id: 'w1',
        hotel_id: 'h1',
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });

      const result = await service.verifyGeofence(
        'w1',
        { hotel_id: 'h1', latitude: 52.52001, longitude: 13.405 },
        'worker'
      );

      expect(result.status).toBe('verified');
      if (result.status === 'verified') {
        expect(result.insideRadius).toBe(true);
        expect(result.checkin.id).toBe('c1');
      }
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    });

    it('returns verified with insideRadius=false when outside the radius, still persisting the check-in', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: 52.52, longitude: 13.405 });
      mockWorkerGeoCheckinCreate.mockResolvedValue({
        id: 'c2',
        worker_id: 'w1',
        hotel_id: 'h1',
        distance_meters: 5000,
        inside_radius: false,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });

      const result = await service.verifyGeofence(
        'w1',
        { hotel_id: 'h1', latitude: 52.57, longitude: 13.405 },
        'worker'
      );

      expect(result.status).toBe('verified');
      if (result.status === 'verified') {
        expect(result.insideRadius).toBe(false);
      }
      expect(mockWorkerGeoCheckinCreate).toHaveBeenCalled();
    });
  });

  describe('checkIn — still delegates to verifyGeofence with unchanged fail-closed contract', () => {
    it('still throws NotFoundError (not the not_configured discriminant) for its own endpoint', async () => {
      mockHotelFindUnique.mockResolvedValue({ latitude: null, longitude: null });

      await expect(
        service.checkIn('w1', { hotel_id: 'h1', latitude: 52.52, longitude: 13.405 }, 'worker')
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listCheckins — OD-GEO-005 access scoping', () => {
    beforeEach(() => {
      mockWorkerGeoCheckinFindMany.mockResolvedValue([]);
      mockWorkerGeoCheckinCount.mockResolvedValue(0);
    });

    it('scopes a worker to only their own check-ins', async () => {
      await service.listCheckins(
        { page: 1, per_page: 20 },
        { userId: 'w1', role: 'worker' }
      );

      expect(mockWorkerGeoCheckinFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w1' }) })
      );
    });

    it('denies a manager with no scope claim entirely (empty-in matches no rows)', async () => {
      await service.listCheckins(
        { page: 1, per_page: 20 },
        { userId: 'm1', role: 'manager', scope: null }
      );

      expect(mockWorkerGeoCheckinFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ hotel_id: { in: [] } }) })
      );
    });

    it('scopes a hotel-group manager to hotels in their group', async () => {
      mockHotelFindMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);

      await service.listCheckins(
        { page: 1, per_page: 20 },
        { userId: 'm1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      );

      expect(mockWorkerGeoCheckinFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ hotel_id: { in: ['h1', 'h2'] } }) })
      );
    });

    it('admin sees all check-ins with no added restriction', async () => {
      await service.listCheckins({ page: 1, per_page: 20 }, { userId: 'a1', role: 'admin' });

      expect(mockWorkerGeoCheckinFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
    });
  });

  describe('getCheckin — RBAC + FIND-SEC-GEO-01-equivalent ownership binding', () => {
    it('throws NotFoundError when the check-in does not exist', async () => {
      mockWorkerGeoCheckinFindUnique.mockResolvedValue(null);
      await expect(
        service.getCheckin('missing', { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('denies a worker fetching a check-in that is not their own', async () => {
      mockWorkerGeoCheckinFindUnique.mockResolvedValue({
        id: 'c1',
        worker_id: 'w2',
        hotel_id: 'h1',
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date(),
      });
      await expect(
        service.getCheckin('c1', { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('denies a manager outside their hotel scope', async () => {
      mockWorkerGeoCheckinFindUnique.mockResolvedValue({
        id: 'c1',
        worker_id: 'w1',
        hotel_id: 'h1',
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date(),
      });
      mockIsHotelInScope.mockResolvedValue(false);

      await expect(
        service.getCheckin('c1', { userId: 'm1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h2' } })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows a manager within their hotel scope, returning distance/pass-fail only', async () => {
      mockWorkerGeoCheckinFindUnique.mockResolvedValue({
        id: 'c1',
        worker_id: 'w1',
        hotel_id: 'h1',
        latitude: 52.52,
        longitude: 13.405,
        distance_meters: 5,
        inside_radius: true,
        checked_at: new Date('2026-07-28T00:00:00.000Z'),
      });
      mockIsHotelInScope.mockResolvedValue(true);

      const result = await service.getCheckin('c1', {
        userId: 'm1',
        role: 'manager',
        scope: { type: 'hotel', hotel_id: 'h1' },
      });

      expect(result).not.toHaveProperty('latitude');
      expect(result.distance_meters).toBe(5);
    });
  });
});
