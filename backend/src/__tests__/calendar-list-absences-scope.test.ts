import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * New (calendar grid view): CalendarService.listAbsences() scope regression.
 * View-only read of absences across a manager/regional_manager's scoped
 * team, admin unrestricted — REQ-CAL-T03's self-service-only marking is
 * unchanged; this adds no write path.
 */

const mockCalendarAbsenceFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

const mockPrisma = {
  calendarAbsence: { findMany: mockCalendarAbsenceFindMany },
  hotel: { findUnique: mockHotelFindUnique },
};

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));
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

import { CalendarService } from '../modules/calendar/service.js';

describe('CalendarService.listAbsences (calendar grid view, view-only)', () => {
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService();
    mockCalendarAbsenceFindMany.mockReset();
    mockCalendarAbsenceFindMany.mockResolvedValue([]);
    mockHotelFindUnique.mockReset();
  });

  it('admin sees the full date range with no scope filter', async () => {
    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07' },
      { userId: 'a1', role: 'admin' }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where).not.toHaveProperty('worker');
    expect(arg.where).not.toHaveProperty('worker_id');
    expect(arg.where.day.gte).toBeInstanceOf(Date);
  });

  it('scopes a hotel-group manager to their group via a nested EmploymentRecord filter', async () => {
    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07' },
      { userId: 'm1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where.worker).toEqual({ employment_record: { hotel_group_id: 'g1' } });
  });

  it('resolves a hotel-scoped manager to that hotel\'s group', async () => {
    mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });

    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07' },
      { userId: 'm1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where.worker).toEqual({ employment_record: { hotel_group_id: 'g2' } });
  });

  it('scopes a regional_manager to their hotel group, same as manager (ADR-030 D-5)', async () => {
    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07' },
      { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g3' } }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where.worker).toEqual({ employment_record: { hotel_group_id: 'g3' } });
  });

  it('denies (empty-in matches no rows) a manager with no scope claim, never falling back to global', async () => {
    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07' },
      { userId: 'm1', role: 'manager', scope: null }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where.worker_id).toEqual({ in: [] });
  });

  it('an explicit worker_id narrows within the resolved group scope, combined via AND, not instead of it', async () => {
    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07', worker_id: 'w1' },
      { userId: 'm1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where.worker_id).toBe('w1');
    expect(arg.where.worker).toEqual({ employment_record: { hotel_group_id: 'g1' } });
  });

  it('an explicit worker_id cannot bypass a denied (no-scope) manager — the deny still wins', async () => {
    await service.listAbsences(
      { from: '2026-08-01', to: '2026-08-07', worker_id: 'w1' },
      { userId: 'm1', role: 'manager', scope: null }
    );

    const arg = mockCalendarAbsenceFindMany.mock.calls[0]?.[0] as any;
    expect(arg.where.worker_id).toEqual({ in: [] });
  });
});
