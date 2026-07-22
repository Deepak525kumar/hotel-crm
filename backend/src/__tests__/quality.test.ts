import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/permissions.js';

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockQualityVerification = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockRating = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerOverallRating = {
  upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  qualityVerification: mockQualityVerification,
  workerAssignment: mockWorkerAssignment,
  rating: mockRating,
  attendance: { count: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  workerOverallRating: mockWorkerOverallRating,
  hotel: mockHotel,
  notification: mockNotification,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

// Epic 5 PR 5.7 (ADR-024 D1/D2/D4, site #9): roster cutover flag for
// getLeaderboard()'s hotel_id filter. Defaults OFF so the existing
// characterization tests below stay untouched.
let rosterCutoverEnabled = false;
jest.mock('../config/feature-flags.js', () => ({
  isScopeAuthzEnabled: () => false,
  isRosterCutoverEnabled: () => rosterCutoverEnabled,
}));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { QualityController } from '../modules/quality/controller.js';
import { QualityService } from '../modules/quality/service.js';
import { CreateRatingSchema } from '../modules/quality/types.js';
import { Prisma } from '@prisma/client';

function makeReq(
  body: Record<string, unknown> = {},
  auth: Partial<{ userId: string; role: string; permissions: string[] }> = {}
): Request {
  return {
    auth: { userId: 'u1', role: 'manager', permissions: [], ...auth },
    params: {},
    query: {},
    body,
    requestId: 'req_test',
  } as unknown as Request;
}

function makeRes(): { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('Quality RBAC — requirePermission middleware (B4)', () => {
  function makeAuthReq(permissions: string[]): Request {
    return makeReq({}, { userId: 'u1', role: 'worker', permissions });
  }

  it('denies GET /leaderboard when quality:read permission is absent', () => {
    const req = makeAuthReq([]);
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('quality:read')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('denies POST /verifications when quality:write permission is absent', () => {
    const req = makeAuthReq(['quality:read']);
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('quality:write')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('allows GET /leaderboard when quality:read permission is present', () => {
    const req = makeAuthReq(['quality:read']);
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('quality:read')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('Quality Zod validation — createVerification (B3)', () => {
  let controller: QualityController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QualityController();
  });

  it('rejects missing assignment_id with ValidationError', async () => {
    const req = makeReq({ score: 80 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createVerification(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score > 100 with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', score: 101 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createVerification(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects non-integer score with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', score: 85.5 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createVerification(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('Quality Zod validation — createRating (P2-03)', () => {
  let controller: QualityController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QualityController();
  });

  it('rejects missing worker_id with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', score: 4 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score out of range (>5) with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 6 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects non-integer score with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 3.5 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('Quality createVerification — concurrent duplicate handling (P2-04)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
    });
  });

  it('returns ConflictError when the pre-check finds an existing verification', async () => {
    mockQualityVerification.findUnique.mockResolvedValue({ id: 'qv1' });

    await expect(
      service.createVerification(
        { assignment_id: 'a1', score: 80 } as any,
        { userId: 'u1', role: 'manager' }
      )
    ).rejects.toMatchObject({ name: 'ConflictError' });

    expect(mockQualityVerification.create).not.toHaveBeenCalled();
  });

  it('maps a P2002 race on create() to ConflictError (409) instead of 500', async () => {
    mockQualityVerification.findUnique.mockResolvedValue(null);

    mockQualityVerification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(
      service.createVerification(
        { assignment_id: 'a1', score: 80 } as any,
        { userId: 'u1', role: 'manager' }
      )
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('re-throws non-P2002 errors from create() unchanged', async () => {
    mockQualityVerification.findUnique.mockResolvedValue(null);
    mockQualityVerification.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.createVerification(
        { assignment_id: 'a1', score: 80 } as any,
        { userId: 'u1', role: 'manager' }
      )
    ).rejects.toThrow('db down');
  });
});

describe('Quality Zod validation — createRating (P2-03)', () => {
  let controller: QualityController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QualityController();
  });

  it('rejects missing worker_id with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', score: 4 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score out of range (>5) with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 6 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects non-integer score with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 3.5 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score below range (boundary score = 0) at the schema level', () => {
    const result = CreateRatingSchema.safeParse({
      assignment_id: 'a1',
      worker_id: 'w1',
      score: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe('Quality createRating — duplicate rating handling (P1-02)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
    });
  });

  it('maps a Prisma P2002 from rating.create() to a ConflictError', async () => {
    mockRating.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(
      service.createRating(
        { assignment_id: 'a1', worker_id: 'w1', score: 4 } as any,
        { userId: 'u1', role: 'manager' }
      )
    ).rejects.toMatchObject({
      name: 'ConflictError',
      message: 'Rating already exists for this assignment',
    });
  });
});

describe('Quality createRating — RATING_RECEIVED notification (GAP-1)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
    });
    mockWorkerAssignment.count.mockResolvedValue(1);
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockAttendance_count();
    mockRating.create.mockResolvedValue({ id: 'r1' });
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 4 }, _count: 1 });
    mockPrisma.workerOverallRating.upsert.mockResolvedValue({});
    mockNotification.create.mockResolvedValue({ id: 'n1' });
  });

  function mockAttendance_count() {
    (mockPrisma.attendance.count as jest.Mock).mockResolvedValue(1 as never);
  }

  it('emits RATING_RECEIVED to the rated worker after a successful rating', async () => {
    await service.createRating(
      { assignment_id: 'a1', worker_id: 'w1', score: 4 } as any,
      { userId: 'u1', role: 'manager' }
    );

    // allow the fire-and-forget notification microtask to settle
    await new Promise((r) => setImmediate(r));

    expect(mockNotification.create).toHaveBeenCalledTimes(1);
    const payload = mockNotification.create.mock.calls[0][0].data;
    expect(payload.user_id).toBe('w1');
    expect(payload.type).toBe('RATING_RECEIVED');
  });
});

describe('Quality getLeaderboard — hotel_id filter (Epic 5 PR 5.7, site #9)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    rosterCutoverEnabled = false;
    service = new QualityService();
    mockWorkerOverallRating.findMany.mockResolvedValue([]);
  });

  it('filters via the HotelWorker relation when hotelId is given (flag OFF, characterization)', async () => {
    await service.getLeaderboard('h1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ worker: { hotel_workers: { some: { hotel_id: 'h1', status: 'ACTIVE' } } } });
    expect(mockHotel.findUnique).not.toHaveBeenCalled();
  });

  it('applies no filter when hotelId is empty (flag OFF, characterization)', async () => {
    await service.getLeaderboard('');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  describe('roster cutover (flag ON, site #9)', () => {
    beforeEach(() => {
      rosterCutoverEnabled = true;
    });

    it('filters via the employment_record relation at the resolved hotel group', async () => {
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await service.getLeaderboard('h1');
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        worker: { employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' } },
      });
    });

    it('filters out every worker when the hotel has no hotel_group_id (deny-by-default)', async () => {
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });
      await service.getLeaderboard('h1');
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        worker: { employment_record: { hotel_group_id: '__none__', status: 'ACTIVE' } },
      });
    });
  });
});
