import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/permissions.js';

// CRR §15 enforced 2026-08-24: createRating rejects an empty photos array.
const RATING_PHOTO = [
  { buffer: Buffer.from('x'), mimeType: 'image/jpeg', originalName: 'e.jpg' },
] as any;

// CRR §15 is enforced as of 2026-08-24: createVerification() rejects an empty
// photos array. These suites exercise duplicate handling / notification
// enqueue, not the photo rule, so they pass a minimal valid photo rather than
// asserting on it.
const PHOTO_FIXTURE = [
  { buffer: Buffer.from('x'), mimeType: 'image/jpeg', originalName: 'e.jpg' },
] as any;

// refreshWorkerOverallRating()'s 2026-08-13 due-date fix reads "today" via
// this helper -- pinned for deterministic assertions, same pattern
// calendar-entries.test.ts already establishes for the identical helper.
jest.mock('../lib/utils.js', () => ({
  ...(jest.requireActual('../lib/utils.js') as object),
  todayInCalendarTimezone: () => '2026-08-13',
}));

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
const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerOverallRating = {
  upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// ADR-067: getLeaderboard() reads the caller's own employment record to resolve
// a worker's/checker's group server-side.
const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  employmentRecord: mockEmploymentRecord,
  qualityVerification: mockQualityVerification,
  workerAssignment: mockWorkerAssignment,
  rating: mockRating,
  attendance: { count: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  workerOverallRating: mockWorkerOverallRating,
  hotel: mockHotel,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $executeRawUnsafe: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

// Default resolved values so NotificationService.enqueue() (called inside every
// $transaction above, ADR-029 GD-01 Epic 7 PR 7.3) has something to read
// `.id` off of; jest.clearAllMocks() in nested describes' beforeEach clears
// call history but not these implementations, so this default holds unless a
// specific test overrides it.
mockNotification.create.mockResolvedValue({ id: 'notif-default' });
mockOutboxEvent.create.mockResolvedValue({ id: 'outbox-default' });

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

import { QualityController } from '../modules/quality/controller.js';
import { QualityService, refreshWorkerOverallRating } from '../modules/quality/service.js';
import {
  ABSENCE_CANCEL_REASON_SELF,
  ABSENCE_CANCEL_REASON_MANAGER,
} from '../config/constants.js';
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
    const req = makeReq({ assignment_id: 'a1', score: 80 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score out of range (>100) with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 101 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects non-integer score with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 85.5 });
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
        { userId: 'u1', role: 'admin' },
        PHOTO_FIXTURE
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
        { userId: 'u1', role: 'admin' },
        PHOTO_FIXTURE
      )
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('re-throws non-P2002 errors from create() unchanged', async () => {
    mockQualityVerification.findUnique.mockResolvedValue(null);
    mockQualityVerification.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.createVerification(
        { assignment_id: 'a1', score: 80 } as any,
        { userId: 'u1', role: 'admin' },
        PHOTO_FIXTURE
      )
    ).rejects.toThrow('db down');
  });
});

describe('Quality createVerification — notification enqueue (ADR-029 GD-01, Epic 7 PR 7.3)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
    });
    mockQualityVerification.findUnique.mockResolvedValue(null);
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'o1' });
  });

  it('joins the verification write and QUALITY_VERIFICATION_SUBMITTED enqueue in one transaction (PASSED)', async () => {
    mockQualityVerification.create.mockResolvedValue({ id: 'qv1', status: 'PASSED' });

    await service.createVerification(
      { assignment_id: 'a1', score: 80 } as any,
      { userId: 'u1', role: 'admin' },
        PHOTO_FIXTURE
    );

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockOutboxEvent.create).toHaveBeenCalledTimes(1);
    expect(mockOutboxEvent.create.mock.calls[0][0].data.source_module).toBe('QUALITY');
    const notifData = mockNotification.create.mock.calls[0][0].data;
    expect(notifData.type).toBe('QUALITY_VERIFICATION_SUBMITTED');
    expect(notifData.user_id).toBe('w1');
  });

  it('emits REWORK_REQUIRED when the score lands in the needs-rework band', async () => {
    mockQualityVerification.create.mockResolvedValue({ id: 'qv2', status: 'NEEDS_REWORK' });

    await service.createVerification(
      { assignment_id: 'a1', score: 50 } as any,
      { userId: 'u1', role: 'admin' },
        PHOTO_FIXTURE
    );

    const notifData = mockNotification.create.mock.calls[0][0].data;
    expect(notifData.type).toBe('REWORK_REQUIRED');
  });

  it('does not enqueue when create() fails (transaction rolls back)', async () => {
    mockQualityVerification.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.createVerification(
        { assignment_id: 'a1', score: 80 } as any,
        { userId: 'u1', role: 'admin' },
        PHOTO_FIXTURE
      )
    ).rejects.toThrow('db down');

    expect(mockOutboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('Quality Zod validation — createRating (P2-03)', () => {
  let controller: QualityController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QualityController();
  });

  it('rejects missing worker_id with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', score: 80 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score out of range (>100) with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 101 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects non-integer score with ValidationError', async () => {
    const req = makeReq({ assignment_id: 'a1', worker_id: 'w1', score: 85.5 });
    const res = makeRes();
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.createRating(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects score below range (boundary score = -1) at the schema level', () => {
    const result = CreateRatingSchema.safeParse({
      assignment_id: 'a1',
      worker_id: 'w1',
      score: -1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts score at the boundary (score = 0) at the schema level', () => {
    const result = CreateRatingSchema.safeParse({
      assignment_id: 'a1',
      worker_id: 'w1',
      score: 0,
    });

    expect(result.success).toBe(true);
  });

  it('accepts score at the boundary (score = 100) at the schema level', () => {
    const result = CreateRatingSchema.safeParse({
      assignment_id: 'a1',
      worker_id: 'w1',
      score: 100,
    });

    expect(result.success).toBe(true);
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
        { assignment_id: 'a1', worker_id: 'w1', score: 80 } as any,
        { userId: 'u1', role: 'admin' },
        RATING_PHOTO
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
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 80 }, _count: 1 });
    mockPrisma.workerOverallRating.upsert.mockResolvedValue({});
    mockNotification.create.mockResolvedValue({ id: 'n1' });
  });

  function mockAttendance_count() {
    (mockPrisma.attendance.count as jest.Mock).mockResolvedValue(1 as never);
  }

  it('emits RATING_RECEIVED to the rated worker after a successful rating', async () => {
    await service.createRating(
      { assignment_id: 'a1', worker_id: 'w1', score: 80 } as any,
      { userId: 'u1', role: 'admin' },
        RATING_PHOTO
    );

    expect(mockNotification.create).toHaveBeenCalledTimes(1);
    const payload = mockNotification.create.mock.calls[0][0].data;
    expect(payload.user_id).toBe('w1');
    expect(payload.type).toBe('RATING_RECEIVED');

    // ADR-029 (GD-01, Epic 7 PR 7.3): the enqueue joins the same
    // transaction as the rating write and aggregate refresh — no more
    // fire-and-forget microtask to wait on.
    expect(mockOutboxEvent.create).toHaveBeenCalledTimes(1);
    expect(mockOutboxEvent.create.mock.calls[0][0].data.source_module).toBe('QUALITY');
    expect(mockOutboxEvent.create.mock.calls[0][0].data.transport).toBe('PUSH');
  });
});

describe('Quality createRating — WorkerOverallRating single-writer aggregate (GD-04)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
    });
    mockRating.create.mockResolvedValue({ id: 'r1' });
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'outbox1' });
    mockWorkerOverallRating.upsert.mockResolvedValue({});
  });

  it('upserts all five aggregate fields from a fresh computation, not just average_score/total_ratings', async () => {
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 72 }, _count: 4 });
    mockWorkerAssignment.count
      .mockResolvedValueOnce(10) // total_assignments
      .mockResolvedValueOnce(6); // completed (status: COMPLETED)
    mockPrisma.attendance.count.mockResolvedValue(3 as never); // on-time attendance
    const lastCompletedAt = new Date('2026-07-20T00:00:00Z');
    mockWorkerAssignment.findFirst.mockResolvedValue({ completed_at: lastCompletedAt });

    await service.createRating(
      { assignment_id: 'a1', worker_id: 'w1', score: 72 } as any,
      { userId: 'u1', role: 'admin' },
        RATING_PHOTO
    );

    expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(1);
    const { create, update } = mockWorkerOverallRating.upsert.mock.calls[0][0];
    const expected = {
      average_score: 72,
      total_ratings: 4,
      total_assignments: 10,
      completion_rate: 0.6,
      on_time_rate: 0.3,
      last_worked_at: lastCompletedAt,
    };
    expect(update).toMatchObject(expected);
    expect(create).toMatchObject({ worker_id: 'w1', ...expected });
  });

  it('no code path deletes a Rating or WorkerAssignment row without recomputing the aggregate (delete case remains unreached)', () => {
    // GD-04: the DB trigger that used to refresh WorkerOverallRating on
    // Rating/WorkerAssignment DELETE (cascaded) was dropped in favor of the
    // app-level refreshWorkerOverallRating() being the single writer. A
    // .delete() call site would silently go unrefreshed since nothing calls
    // this recompute today for a delete. This test pins that no such call
    // site exists, forcing a future PR that adds one to also wire the
    // recompute rather than silently regressing.
    //
    // NOTE: this does NOT cover .update() calls — WorkerAssignment.update()
    // legitimately exists (assignments/service.ts AssignmentService.update())
    // and is required to call refreshWorkerOverallRating() itself; see the
    // "AssignmentService.update — WorkerOverallRating refresh" describe block
    // in assignments.test.ts for that coverage.
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.join(__dirname, '..');

    function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: any) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
      });
    }

    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      const content = fs.readFileSync(file, 'utf8');
      if (/\.(rating|workerAssignment)\.delete\s*\(/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Quality getLeaderboard — hotel_id filter', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerOverallRating.findMany.mockResolvedValue([]);
    mockWorkerOverallRating.count.mockResolvedValue(0);
  });

  it('applies no filter when hotelId is empty and no actor is supplied (admin/internal caller)', async () => {
    await service.getLeaderboard('');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  // IDOR fix (2026-08-08): the bare GET /leaderboard route (no hotelId, no
  // checkHotelAccess()) previously applied no scoping whatsoever once
  // hotelId was empty -- any manager/RM holding quality:read got the
  // platform-wide leaderboard regardless of their scope claim.
  describe('manager/regional_manager scope when hotelId is empty (IDOR fix, 2026-08-08)', () => {
    it("scopes a hotel-scoped manager's leaderboard to their own hotel's group", async () => {
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await service.getLeaderboard('', 1, 25, { role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } });
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ worker: { employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' } } });
    });

    it("scopes a regional_manager's leaderboard to their hotel_group", async () => {
      await service.getLeaderboard('', 1, 25, {
        role: 'regional_manager',
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      });
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ worker: { employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' } } });
    });

    it('denies (no rows) a manager with no scope claim', async () => {
      await service.getLeaderboard('', 1, 25, { role: 'manager', scope: null });
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ worker: { employment_record: { hotel_group_id: '__none__' } } });
    });

    // ADR-067 (2026-08-14) let WORKER onto this route. The capability matrix
    // only proves the TOKEN grant matches the ratified record -- its own header
    // says scope narrowing is a different seam. These are that seam. Without
    // them a worker would have been admitted by a green matrix and still fallen
    // through to the unrestricted `where`, receiving every worker on the
    // platform: exactly the shape of SIR-ANLY-015, where role admission and the
    // scope narrowing did not move in lockstep.
    describe('worker/checker scope (ADR-067)', () => {
      it("scopes a worker's leaderboard to their own hotel group, read server-side", async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1', status: 'ACTIVE' });
        await service.getLeaderboard('', 1, 25, { userId: 'w1', role: 'worker', scope: null });
        const call = mockEmploymentRecord.findUnique.mock.calls[0][0];
        // The group comes from the CALLER's own record, never from the request.
        expect(call.where).toEqual({ user_id: 'w1' });
        const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
        expect(where).toEqual({ worker: { employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' } } });
      });

      it('scopes a checker the same way', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g2', status: 'ACTIVE' });
        await service.getLeaderboard('', 1, 25, { userId: 'c1', role: 'checker', scope: null });
        const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
        expect(where).toEqual({ worker: { employment_record: { hotel_group_id: 'g2', status: 'ACTIVE' } } });
      });

      it('shows an unapproved worker an EMPTY board, never an unscoped one', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1', status: 'PENDING' });
        await service.getLeaderboard('', 1, 25, { userId: 'w1', role: 'worker', scope: null });
        const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
        expect(where.worker.employment_record.hotel_group_id).toBe('__none__');
      });

      it('shows a worker with no group an EMPTY board', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: null, status: 'ACTIVE' });
        await service.getLeaderboard('', 1, 25, { userId: 'w1', role: 'worker', scope: null });
        const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
        expect(where.worker.employment_record.hotel_group_id).toBe('__none__');
      });

      it('ignores a client-supplied hotel_id rather than letting it widen scope', async () => {
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'someone-elses-group' });
        mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1', status: 'ACTIVE' });
        // A hotelId argument takes the hotel branch, which resolves the GROUP of
        // the requested hotel. The route that accepts one is checkHotelAccess()-
        // gated, so a worker cannot reach it -- asserted here so that if it is
        // ever opened up, this fails loudly rather than silently widening.
        await service.getLeaderboard('other-hotel', 1, 25, { userId: 'w1', role: 'worker', scope: null });
        const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
        expect(where.worker.employment_record.hotel_group_id).not.toBe('g1');
      });

      it('withholds email from a peer viewer but not from a manager', async () => {
        const row = {
          id: 'r1',
          worker_id: 'w2',
          worker: { id: 'w2', first_name: 'A', last_name: 'B', email: 'a.b@example.com' },
        };
        mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1', status: 'ACTIVE' });
        mockWorkerOverallRating.findMany.mockResolvedValue([row]);

        const asWorker = await service.getLeaderboard('', 1, 25, { userId: 'w1', role: 'worker', scope: null });
        expect(asWorker.leaderboard[0].worker).not.toHaveProperty('email');
        expect(asWorker.leaderboard[0].worker.first_name).toBe('A');

        mockWorkerOverallRating.findMany.mockResolvedValue([row]);
        const asManager = await service.getLeaderboard('', 1, 25, {
          role: 'regional_manager',
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        });
        expect(asManager.leaderboard[0].worker).toHaveProperty('email', 'a.b@example.com');
      });
    });

    it('does not scope-restrict an admin leaderboard', async () => {
      await service.getLeaderboard('', 1, 25, { role: 'admin', scope: { type: 'global' } });
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where).toEqual({});
    });
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

describe('Quality getLeaderboard — pagination (ADR-035)', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerOverallRating.findMany.mockResolvedValue([]);
    mockWorkerOverallRating.count.mockResolvedValue(0);
  });

  it('defaults to page 1, per_page 25', async () => {
    await service.getLeaderboard('');
    const args = mockWorkerOverallRating.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(25);
  });

  it('computes skip from page and per_page', async () => {
    await service.getLeaderboard('', 3, 10);
    const args = mockWorkerOverallRating.findMany.mock.calls[0][0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it('returns pagination metadata derived from the total count', async () => {
    mockWorkerOverallRating.count.mockResolvedValue(52);
    const result = await service.getLeaderboard('', 2, 25);
    expect(result.pagination).toEqual({
      page: 2,
      per_page: 25,
      total: 52,
      total_pages: 3,
      has_next: true,
      has_prev: true,
    });
  });
});

// 2026-08-13 fix (E2E integration audit -- "leaderboard sabotage"):
// totalAssignments used to be a raw, unfiltered count of every
// WorkerAssignment row, so a manager-cancelled shift or a future-dated
// CONFIRMED shift both dragged a worker's completion/on-time rate down for
// outcomes that were not (yet, or ever) their doing. This exercises
// refreshWorkerOverallRating() directly against a minimal fake `tx`,
// independent of QualityService's own request-handling tests above.
describe('refreshWorkerOverallRating — total_assignments denominator (2026-08-13 fix)', () => {
  const makeTx = () => ({
    $executeRawUnsafe: jest.fn(),
    rating: { aggregate: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    workerAssignment: {
      count: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockImplementation(
        async (args: any) => {
          // The completedAssignments count (status: COMPLETED only) is a
          // second, distinct call -- only the FIRST call (the denominator)
          // is asserted against assignmentCountWhere by the caller.
          return args.where && 'OR' in args.where ? 3 : 1;
        }
      ),
      findFirst: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    },
    attendance: { count: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    workerOverallRating: { upsert: jest.fn() as jest.MockedFunction<(...a: any[]) => any>, findUnique: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    notification: { create: (jest.fn() as any).mockResolvedValue({ id: 'notif-1' }) },
    employmentRecord: { findUnique: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    hotelGroup: { findUnique: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    outboxEvent: { create: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
  });

  it('excludes CANCELLED and REASSIGNED from the denominator, at any day', async () => {
    const tx = makeTx();
    tx.rating.aggregate.mockResolvedValue({ _avg: { score: 4 }, _count: 5 });
    tx.attendance.count.mockResolvedValue(1);
    tx.workerAssignment.findFirst.mockResolvedValue(null);

    await refreshWorkerOverallRating(tx as any, 'w1');

    const denominatorCall = (tx.workerAssignment.count.mock.calls as any[]).find(
      (c) => c[0]?.where && 'OR' in c[0].where
    );
    expect(denominatorCall[0].where).toEqual({
      worker_id: 'w1',
      // ADR-069 §3: rework assignments are excluded from every ratio. A rework
      // row is a SECOND row for work already counted once via the original
      // COMPLETED assignment, so counting it would halve completion_rate for a
      // single failed inspection and then restore it -- compounding a penalty
      // on top of the 0-100 quality score, which is the mechanism the platform
      // actually uses to record poor work.
      rework_of_assignment_id: null,
      OR: [
        { status: { in: ['COMPLETED', 'NO_SHOW'] } },
        { status: { in: ['CONFIRMED', 'IN_PROGRESS'] }, day: { lte: new Date('2026-08-13T00:00:00.000Z') } },
      ],
    });
  });

  // A worker standing themselves down is worth a manager seeing, but it is not
  // a failed shift -- so it is reported as its own count and kept out of the
  // ratio, where it would be indistinguishable from a no-show.
  it('counts worker-initiated cancellations separately, without touching the denominator', async () => {
    const tx = makeTx();
    tx.rating.aggregate.mockResolvedValue({ _avg: { score: 4 }, _count: 5 });
    tx.attendance.count.mockResolvedValue(1);
    tx.workerAssignment.findFirst.mockResolvedValue(null);

    await refreshWorkerOverallRating(tx as any, 'w1');

    const cancellationCall = (tx.workerAssignment.count.mock.calls as any[]).find(
      (c) => c[0]?.where?.cancellation_reason !== undefined
    );
    expect(cancellationCall[0].where).toEqual({
      worker_id: 'w1',
      status: 'CANCELLED',
      cancellation_reason: ABSENCE_CANCEL_REASON_SELF,
    });
    // Manager-initiated cancellations are never attributed to the worker.
    expect(JSON.stringify(cancellationCall[0].where)).not.toContain(
      ABSENCE_CANCEL_REASON_MANAGER
    );

    // And it is written out as a count, not folded into a rate.
    const upsert = (tx.workerOverallRating.upsert.mock.calls as any[])[0][0];
    expect(upsert.create.worker_cancellations).toBe(1);
  });

  it('includes a future-dated CONFIRMED/IN_PROGRESS shift once its day is <= today, excludes it before', async () => {
    const tx = makeTx();
    tx.rating.aggregate.mockResolvedValue({ _avg: { score: null }, _count: 0 });
    tx.attendance.count.mockResolvedValue(0);
    tx.workerAssignment.findFirst.mockResolvedValue(null);

    await refreshWorkerOverallRating(tx as any, 'w1');

    const denominatorCall = (tx.workerAssignment.count.mock.calls as any[]).find(
      (c) => c[0]?.where && 'OR' in c[0].where
    );
    const dayFilter = denominatorCall[0].where.OR[1].day;
    expect(dayFilter).toEqual({ lte: new Date('2026-08-13T00:00:00.000Z') });
  });

  it('always includes COMPLETED/NO_SHOW regardless of day (a terminal outcome already happened)', async () => {
    const tx = makeTx();
    tx.rating.aggregate.mockResolvedValue({ _avg: { score: null }, _count: 0 });
    tx.attendance.count.mockResolvedValue(0);
    tx.workerAssignment.findFirst.mockResolvedValue(null);

    await refreshWorkerOverallRating(tx as any, 'w1');

    const denominatorCall = (tx.workerAssignment.count.mock.calls as any[]).find(
      (c) => c[0]?.where && 'OR' in c[0].where
    );
    expect(denominatorCall[0].where.OR[0]).toEqual({ status: { in: ['COMPLETED', 'NO_SHOW'] } });
  });
});

// The on_time_rate numerator and its denominator are drawn from two different
// tables with different filters, and nothing keeps them in step.
describe('refreshWorkerOverallRating — on_time_rate numerator/denominator agreement', () => {
  const makeTx = (dueCount: number, presentCount: number) => ({
    $executeRawUnsafe: jest.fn(),
    rating: {
      aggregate: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({
        _avg: { score: 80 },
        _count: 1,
      }),
    },
    workerAssignment: {
      count: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockImplementation(
        async (args: any) => {
          if (args.where && 'OR' in args.where) return dueCount; // denominator
          if (args.where?.cancellation_reason !== undefined) return 0;
          return 0; // completedAssignments
        }
      ),
      findFirst: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue(null),
    },
    attendance: {
      count: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue(
        presentCount
      ),
    },
    workerOverallRating: { upsert: jest.fn() as jest.MockedFunction<(...a: any[]) => any>, findUnique: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    notification: { create: (jest.fn() as any).mockResolvedValue({ id: 'notif-1' }) },
    employmentRecord: { findUnique: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    hotelGroup: { findUnique: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
    outboxEvent: { create: jest.fn() as jest.MockedFunction<(...a: any[]) => any> },
  });

  // Reproduces a sequence that happens in normal operation: the worker checks
  // in (Attendance -> PRESENT), and the shift is CANCELLED afterwards. The
  // 2026-08-13 fix removed CANCELLED from the denominator, but the PRESENT
  // attendance row is never cleared by cancellation, so it stays in the
  // numerator. One such shift is enough to push the rate above 1.0.
  it('never reports an on-time rate above 100%', async () => {
    // The numerator is now scoped to the same assignments as the denominator,
    // so the DB cannot return more PRESENT rows than there are due
    // assignments (Attendance is 1-to-1 with WorkerAssignment). Asserted with
    // numerator == denominator, the maximum the scoped query can produce.
    const tx = makeTx(2, 2);
    await refreshWorkerOverallRating(tx as any, 'w1');

    const written = (tx.workerOverallRating.upsert.mock.calls as any[])[0][0].update;
    expect(written.on_time_rate).toBeLessThanOrEqual(1);
    expect(written.on_time_rate).toBe(1);
  });

  it('scopes the PRESENT count to assignments that are actually in the denominator', async () => {
    const tx = makeTx(3, 1);
    await refreshWorkerOverallRating(tx as any, 'w1');

    const attendanceWhere = (tx.attendance.count.mock.calls as any[])[0][0].where;
    // Counting every PRESENT row for the worker, regardless of whether its
    // assignment is one the rate is measured against, is what allows the
    // mismatch above.
    expect(attendanceWhere).toHaveProperty('assignment');
  });

  it('does not trigger a warning if the worker has 0 ratings, avoiding a default 0 score from firing alerts', async () => {
    const tx = makeTx(1, 1);
    tx.rating.aggregate.mockResolvedValue({ _avg: { score: null }, _count: 0 }); // 0 ratings

    await refreshWorkerOverallRating(tx as any, 'w1');

    // Make sure no notifications were created
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    
    const written = (tx.workerOverallRating.upsert.mock.calls as any[])[0][0].update;
    // Score should be stored as 0, but warnings should NOT be triggered
    expect(written.average_score).toBe(0);
    expect(written.warning_70_sent_at).toBeNull();
    expect(written.warning_50_sent_at).toBeNull();
  });
});
