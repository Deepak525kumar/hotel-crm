import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Unit tests for the roster cutover seam (Epic 5 PR 5.7, ADR-022/023/024).
 *
 * `lib/roster-scope.ts` is the single centralized mapping from a worker's
 * PR 5.6 EmploymentRecord to the group-grain "is this worker eligible at this
 * hotel?" / "which hotels/workers are eligible?" questions that
 * `HotelWorker` ACTIVE-membership rows answered pre-cutover. These tests pin
 * the deny-by-default posture (no record / non-ACTIVE / ungrouped record all
 * deny, exactly like `resolveScope()`'s existing null-scope precedent) and
 * the group-grain matching formula from ADR-023 (`worker.hotel_group_id ==
 * target_hotel.hotel_group_id`).
 */

const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  employmentRecord: mockEmploymentRecord,
  hotel: mockHotel,
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

import {
  resolveWorkerGroupScope,
  isWorkerEligibleForHotel,
  listEligibleHotelIds,
  listEligibleWorkerIds,
} from '../lib/roster-scope.js';

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  hotel_group_id: 'g1',
  ...overrides,
});

describe('resolveWorkerGroupScope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the worker has no EmploymentRecord (deny-by-default)', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(null);
    const scope = await resolveWorkerGroupScope('u1');
    expect(scope).toBeNull();
  });

  it('returns null when the record is not ACTIVE', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(makeRecord({ status: 'UNDER_REVIEW' }));
    const scope = await resolveWorkerGroupScope('u1');
    expect(scope).toBeNull();
  });

  it('returns null when the record has no hotel_group_id (ungrouped)', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(makeRecord({ hotel_group_id: null }));
    const scope = await resolveWorkerGroupScope('u1');
    expect(scope).toBeNull();
  });

  it('returns a hotel_group scope for an ACTIVE, grouped record', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(makeRecord());
    const scope = await resolveWorkerGroupScope('u1');
    expect(scope).toEqual({ type: 'hotel_group', hotel_group_id: 'g1' });
  });
});

describe('isWorkerEligibleForHotel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denies when the worker has no scope', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(null);
    await expect(isWorkerEligibleForHotel('u1', 'h1')).resolves.toBe(false);
  });

  it('allows when the target hotel is in the worker group', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(makeRecord({ hotel_group_id: 'g1' }));
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    await expect(isWorkerEligibleForHotel('u1', 'h1')).resolves.toBe(true);
  });

  it('denies when the target hotel is in a different group', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(makeRecord({ hotel_group_id: 'g1' }));
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g2' });
    await expect(isWorkerEligibleForHotel('u1', 'h1')).resolves.toBe(false);
  });
});

describe('listEligibleHotelIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns [] when the worker has no scope', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(null);
    await expect(listEligibleHotelIds('u1')).resolves.toEqual([]);
    expect(mockHotel.findMany).not.toHaveBeenCalled();
  });

  it('returns every hotel id in the worker group', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(makeRecord({ hotel_group_id: 'g1' }));
    mockHotel.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
    await expect(listEligibleHotelIds('u1')).resolves.toEqual(['h1', 'h2']);
    expect(mockHotel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotel_group_id: 'g1' } })
    );
  });
});

describe('listEligibleWorkerIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns [] when the hotel has no hotel_group_id (ungrouped)', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });
    await expect(listEligibleWorkerIds('h1')).resolves.toEqual([]);
    expect(mockEmploymentRecord.findMany).not.toHaveBeenCalled();
  });

  it('returns [] when the hotel does not exist', async () => {
    mockHotel.findUnique.mockResolvedValue(null);
    await expect(listEligibleWorkerIds('h1')).resolves.toEqual([]);
  });

  it('returns every ACTIVE employee user_id in the hotel group', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }]);
    await expect(listEligibleWorkerIds('h1')).resolves.toEqual(['u1', 'u2']);
    expect(mockEmploymentRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotel_group_id: 'g1', status: 'ACTIVE' } })
    );
  });
});
