import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for Epic 5 PR 5.8's backfill-status tool
 * (scripts/employment-record-backfill-status.ts). Locks the query shape: it
 * must find every distinct ACTIVE HotelWorker worker_id and check each one
 * against EmploymentRecord.user_id — read-only, no writes.
 */

import { checkEmploymentRecordBackfillStatus } from '../scripts/employment-record-backfill-status.js';

describe('checkEmploymentRecordBackfillStatus', () => {
  it('queries only ACTIVE HotelWorker rows, distinct by worker_id', async () => {
    const hotelWorkerFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    hotelWorkerFindMany.mockResolvedValue([
      { worker_id: 'w1', hotel_id: 'h1' },
      { worker_id: 'w2', hotel_id: 'h2' },
    ]);
    const employmentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    employmentRecordFindUnique.mockResolvedValue({ user_id: 'w1' });

    const prisma = {
      hotelWorker: { findMany: hotelWorkerFindMany },
      employmentRecord: { findUnique: employmentRecordFindUnique },
    } as any;

    await checkEmploymentRecordBackfillStatus(prisma);

    expect(hotelWorkerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE' },
        distinct: ['worker_id'],
      })
    );
  });

  it('reports every distinct ACTIVE worker with and without an EmploymentRecord', async () => {
    const hotelWorkerFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    hotelWorkerFindMany.mockResolvedValue([
      { worker_id: 'w1', hotel_id: 'h1' },
      { worker_id: 'w2', hotel_id: 'h2' },
      { worker_id: 'w3', hotel_id: 'h1' },
    ]);
    const employmentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    employmentRecordFindUnique.mockImplementation(async ({ where }: any) =>
      where.user_id === 'w1' ? { user_id: 'w1' } : null
    );

    const prisma = {
      hotelWorker: { findMany: hotelWorkerFindMany },
      employmentRecord: { findUnique: employmentRecordFindUnique },
    } as any;

    const report = await checkEmploymentRecordBackfillStatus(prisma);

    expect(report.totalActiveRosterWorkers).toBe(3);
    expect(report.withEmploymentRecord).toBe(1);
    expect(report.withoutEmploymentRecord).toBe(2);
    expect(report.missing).toEqual([
      { worker_id: 'w2', hotel_id: 'h2' },
      { worker_id: 'w3', hotel_id: 'h1' },
    ]);
  });

  it('reports zero when no ACTIVE HotelWorker rows exist', async () => {
    const hotelWorkerFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    hotelWorkerFindMany.mockResolvedValue([]);
    const employmentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

    const prisma = {
      hotelWorker: { findMany: hotelWorkerFindMany },
      employmentRecord: { findUnique: employmentRecordFindUnique },
    } as any;

    const report = await checkEmploymentRecordBackfillStatus(prisma);

    expect(report).toEqual({
      totalActiveRosterWorkers: 0,
      withEmploymentRecord: 0,
      withoutEmploymentRecord: 0,
      missing: [],
    });
    expect(employmentRecordFindUnique).not.toHaveBeenCalled();
  });
});
