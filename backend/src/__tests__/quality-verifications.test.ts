import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQualityVerification = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  qualityVerification: mockQualityVerification,
  workerAssignment: mockWorkerAssignment,
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

import { QualityVerificationService } from '../modules/quality-verifications/service.js';

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  hotel_id: 'h1',
  worker_id: 'w1',
  status: 'COMPLETED' as const,
  ...overrides,
});

const makeQv = (overrides: Record<string, unknown> = {}) => ({
  id: 'qv1',
  assignment_id: 'a1',
  hotel_id: 'h1',
  verified_by_id: 'chk1',
  score: 90,
  status: 'PASSED' as const,
  notes: null,
  photo_urls: [],
  rework_required: false,
  rework_notes: null,
  rework_completed_at: null,
  created_at: new Date('2026-06-01T00:00:00Z'),
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

describe('QualityVerificationService', () => {
  let service: QualityVerificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityVerificationService();
  });

  describe('create', () => {
    it('throws NotFoundError when assignment does not exist', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ assignment_id: 'a1', score: 90 }, 'chk1', 'checker')
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('throws ConflictError when assignment is not COMPLETED', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      await expect(
        service.create({ assignment_id: 'a1', score: 90 }, 'chk1', 'checker')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('throws ConflictError when a verification already exists', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockQualityVerification.findUnique.mockResolvedValue(makeQv());
      await expect(
        service.create({ assignment_id: 'a1', score: 90 }, 'chk1', 'checker')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('creates verification, deriving hotel_id and verifier', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockQualityVerification.findUnique.mockResolvedValue(null);
      mockQualityVerification.create.mockResolvedValue(makeQv());
      const dto = await service.create(
        { assignment_id: 'a1', score: 90, status: 'PASSED' },
        'chk1',
        'checker'
      );
      expect(dto.hotel_id).toBe('h1');
      const data = mockQualityVerification.create.mock.calls[0][0].data;
      expect(data.hotel_id).toBe('h1');
      expect(data.verified_by_id).toBe('chk1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('defaults rework_required true for NEEDS_REWORK', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockQualityVerification.findUnique.mockResolvedValue(null);
      mockQualityVerification.create.mockResolvedValue(makeQv({ status: 'NEEDS_REWORK', rework_required: true }));
      await service.create({ assignment_id: 'a1', score: 40, status: 'NEEDS_REWORK' }, 'chk1', 'checker');
      const data = mockQualityVerification.create.mock.calls[0][0].data;
      expect(data.rework_required).toBe(true);
    });
  });

  describe('list', () => {
    it('scopes workers to their own assignments', async () => {
      mockQualityVerification.findMany.mockResolvedValue([]);
      mockQualityVerification.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
      const where = mockQualityVerification.findMany.mock.calls[0][0].where;
      expect(where.assignment).toEqual({ worker_id: 'w1' });
    });

    it('does not scope a manager', async () => {
      mockQualityVerification.findMany.mockResolvedValue([]);
      mockQualityVerification.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'mgr1', role: 'manager' });
      const where = mockQualityVerification.findMany.mock.calls[0][0].where;
      expect(where.assignment).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('throws ForbiddenError when worker views another worker\'s verification', async () => {
      mockQualityVerification.findUnique.mockResolvedValue(
        makeQv({ assignment: { worker_id: 'w2' } })
      );
      await expect(service.getById('qv1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
    });
  });
});
