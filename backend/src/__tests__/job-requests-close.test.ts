import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Manual close + 6h auto-close service logic for Epic 9 PR 9.10
 * (TREQ-006/TRULE-005, MIG-GAP-09).
 *
 * manualClose() lets a manager close an unfilled OPEN broadcast early,
 * transitioning it to EXPIRED (the same terminal status the scheduled
 * auto-close job produces) and notifying the raising manager. This
 * transition is intentionally NOT added to the shared ALLOWED_TRANSITIONS
 * table used by update() (that table also governs the marketplace
 * create()/update() flow, which has no EXPIRED-via-manual-action concept);
 * manualClose() validates the OPEN + is-a-broadcast precondition itself.
 *
 * closeExpiredBroadcasts() (called by JobRequestAutoCloseJob.run(),
 * auto-close-job.ts, tested separately in job-requests-auto-close.test.ts)
 * is the batched scheduled-job half: closes every broadcast JobRequest
 * still OPEN more than 6 hours after creation, notifying each one's raising
 * manager. Both paths share the same private enqueueJobRequestClosed()
 * notification helper.
 *
 * Out of this PR's scope, not asserted here: any change to raise/
 * eligibility/notification/arbitration logic from PRs 9.7-9.9.
 */

const mockJobRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  jobRequest: mockJobRequest,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

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

import { JobRequestService } from '../modules/job-requests/service.js';

const makeSkillSlotRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'slot1',
  job_request_id: 'jr1',
  skill: 'CLEANER' as const,
  headcount: 2,
  confirmed_count: 0,
  created_at: new Date('2026-07-29T00:00:00Z'),
  updated_at: new Date('2026-07-29T00:00:00Z'),
  ...overrides,
});

const makeJobRequestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'jr1',
  hotel_id: 'h1',
  created_by_id: 'mgr1',
  position: '2x CLEANER',
  workers_needed: 2,
  workers_confirmed: 0,
  version: 0,
  shift_date: new Date('2026-08-01T00:00:00.000Z'),
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  hourly_rate: null,
  currency: 'EUR',
  description: null,
  requirements: null,
  status: 'OPEN' as const,
  published_at: new Date('2026-07-29T00:00:00Z'),
  expires_at: null,
  filled_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: new Date('2026-07-29T00:00:00Z'),
  updated_at: new Date('2026-07-29T00:00:00Z'),
  skill_slots: [makeSkillSlotRow()],
  ...overrides,
});

describe('JobRequestService.manualClose', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobRequestService();
  });

  it('throws NotFoundError when the job request does not exist', async () => {
    mockJobRequest.findUnique.mockResolvedValue(null);
    await expect(
      service.manualClose('missing', { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('throws ConflictError when the job request has no skill slots (not a broadcast)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ skill_slots: [] }));
    await expect(
      service.manualClose('jr1', { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('throws ConflictError when the broadcast is not OPEN', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ status: 'EXPIRED' }));
    await expect(
      service.manualClose('jr1', { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('manager out of scope is rejected (ForbiddenError)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    await expect(
      service.manualClose('jr1', {
        userId: 'mgr1',
        role: 'manager',
        scope: { type: 'hotel', hotel_id: 'h2' },
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockJobRequest.update).not.toHaveBeenCalled();
  });

  it('transitions OPEN to EXPIRED and notifies the raising manager', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockJobRequest.update.mockResolvedValue(makeJobRequestRow({ status: 'EXPIRED' }));

    const dto = await service.manualClose('jr1', { userId: 'admin1', role: 'admin' });

    expect(dto.status).toBe('EXPIRED');
    expect(mockJobRequest.update).toHaveBeenCalledWith({
      where: { id: 'jr1' },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    });
    expect(mockNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'mgr1', // the broadcast's created_by_id, not the closing actor
          type: 'JOB_REQUEST_CLOSED',
        }),
      })
    );
  });

  it('logs an audit entry citing MANUAL_CLOSE', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockJobRequest.update.mockResolvedValue(makeJobRequestRow({ status: 'EXPIRED' }));

    await service.manualClose('jr1', { userId: 'admin1', role: 'admin' });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MANUAL_CLOSE' }),
      })
    );
  });
});

describe('JobRequestService.closeExpiredBroadcasts', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobRequestService();
  });

  it('closes a JobRequest created more than 6h ago and still OPEN, notifying its manager', async () => {
    // 1 row < batchSize(100) -- the loop's own short-circuit stops after this
    // single page, so only one findMany() call is ever made.
    mockJobRequest.findMany.mockResolvedValueOnce([makeJobRequestRow()]);
    mockJobRequest.update.mockResolvedValue(makeJobRequestRow({ status: 'EXPIRED' }));

    const cutoff = new Date('2026-08-01T06:00:00.000Z');
    const closed = await service.closeExpiredBroadcasts(cutoff, 100);

    expect(closed).toBe(1);
    expect(mockJobRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'OPEN',
          created_at: { lt: cutoff },
          skill_slots: { some: {} },
        }),
      })
    );
    expect(mockJobRequest.update).toHaveBeenCalledWith({
      where: { id: 'jr1' },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    });
    expect(mockNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'mgr1', type: 'JOB_REQUEST_CLOSED' }),
      })
    );
  });

  it('leaves a JobRequest created less than 6h ago untouched', async () => {
    mockJobRequest.findMany.mockResolvedValueOnce([]);

    const cutoff = new Date('2026-08-01T06:00:00.000Z');
    const closed = await service.closeExpiredBroadcasts(cutoff, 100);

    expect(closed).toBe(0);
    expect(mockJobRequest.update).not.toHaveBeenCalled();
    expect(mockNotification.create).not.toHaveBeenCalled();
  });

  it('batches across multiple pages when the backlog exceeds one batch', async () => {
    // Two full pages of 2 (batchSize), so the loop cannot short-circuit
    // after either -- it queries a third, empty page to confirm the
    // backlog is exhausted (mirrors SessionSweepJob's identical
    // full-page-then-empty-page shape).
    mockJobRequest.findMany
      .mockResolvedValueOnce([makeJobRequestRow({ id: 'jr1' }), makeJobRequestRow({ id: 'jr2' })])
      .mockResolvedValueOnce([makeJobRequestRow({ id: 'jr3' }), makeJobRequestRow({ id: 'jr4' })])
      .mockResolvedValueOnce([]);
    mockJobRequest.update.mockResolvedValue(makeJobRequestRow({ status: 'EXPIRED' }));

    const closed = await service.closeExpiredBroadcasts(new Date(), 2);

    expect(closed).toBe(4);
    expect(mockJobRequest.findMany).toHaveBeenCalledTimes(3);
    expect(mockJobRequest.update).toHaveBeenCalledTimes(4);
  });

  it('a short page (fewer rows than batchSize) stops the loop without an extra query', async () => {
    mockJobRequest.findMany.mockResolvedValueOnce([makeJobRequestRow()]); // 1 < batchSize(2)
    mockJobRequest.update.mockResolvedValue(makeJobRequestRow({ status: 'EXPIRED' }));

    await service.closeExpiredBroadcasts(new Date(), 2);

    expect(mockJobRequest.findMany).toHaveBeenCalledTimes(1);
  });

  it('only selects broadcast JobRequests (skill_slots present), excluding the marketplace flow', async () => {
    mockJobRequest.findMany.mockResolvedValueOnce([]);

    await service.closeExpiredBroadcasts(new Date(), 100);

    const where = mockJobRequest.findMany.mock.calls[0][0].where;
    expect(where.skill_slots).toEqual({ some: {} });
  });
});
