import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockRating = {
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerOverallRating = {
  upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockAttendance = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockJobRequestSkillSlot = {
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerAssignment: mockWorkerAssignment,
  employmentRecord: mockEmploymentRecord,
  hotel: mockHotel,
  rating: mockRating,
  attendance: mockAttendance,
  workerOverallRating: mockWorkerOverallRating,
  jobRequestSkillSlot: mockJobRequestSkillSlot,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
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

import { AssignmentService } from '../modules/assignments/service.js';

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_request_id: 'wr1',
  worker_id: 'w1',
  hotel_id: 'h1',
  assigned_by_id: 'mgr1',
  status: 'CONFIRMED' as const,
  confirmed_at: new Date('2026-06-01T00:00:00Z'),
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  previous_assignment_id: null,
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

describe('AssignmentService', () => {
  let service: AssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssignmentService();
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 0 }, _count: 0 });
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockAttendance.count.mockResolvedValue(0 as never);
    mockWorkerOverallRating.upsert.mockResolvedValue({});
    mockJobRequestSkillSlot.update.mockResolvedValue({});
    mockNotification.create.mockResolvedValue({ id: 'notif-default' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'outbox-default' });
  });

  describe('update', () => {
    it('throws NotFoundError for unknown assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(service.update('a1', { status: 'IN_PROGRESS' }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('rejects illegal transition COMPLETED -> IN_PROGRESS', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));
      await expect(
        service.update('a1', { status: 'IN_PROGRESS' }, 'mgr1', 'manager', { type: 'global' })
      ).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('transitions CONFIRMED -> IN_PROGRESS and sets started_at', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS', started_at: new Date() }));
      await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker');
      const data = mockWorkerAssignment.update.mock.calls[0][0].data;
      expect(data.status).toBe('IN_PROGRESS');
      expect(data.started_at).toBeInstanceOf(Date);
    });

    it('transitions IN_PROGRESS -> COMPLETED and sets completed_at', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED', completed_at: new Date() }));
      await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker');
      const data = mockWorkerAssignment.update.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      expect(data.completed_at).toBeInstanceOf(Date);
    });

    it('cancels with reason and sets cancelled_at', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(
        makeAssignment({ status: 'CANCELLED', cancellation_reason: 'sick' })
      );
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      const data = mockWorkerAssignment.update.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelled_at).toBeInstanceOf(Date);
      expect(data.cancellation_reason).toBe('sick');
    });

    // Audit-trail fix (2026-08-05): cancellation_reason was saved to the row
    // but never surfaced in the audit log's details.
    it('includes cancellation_reason in the audit log details when cancelling', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(
        makeAssignment({ status: 'CANCELLED', cancellation_reason: 'sick' })
      );
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_ASSIGNMENT',
            details: expect.objectContaining({ cancellation_reason: 'sick' }),
          }),
        })
      );
    });

    it('does not include a cancellation_reason key in the audit log details for a non-cancelling transition', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker');
      const call = mockPrisma.auditLog.create.mock.calls.find(
        (c: any) => c[0].data.action === 'UPDATE_ASSIGNMENT'
      );
      expect(call?.[0].data.details).not.toHaveProperty('cancellation_reason');
    });

    // Job-dispatch lifecycle audit fix (2026-08-05): cancelling a
    // broadcast-accept assignment must free up the slot it claimed, or a
    // headcount-N slot gets stuck permanently "full" after a cancellation.
    it('decrements JobRequestSkillSlot.confirmed_count when cancelling a broadcast-accept assignment (skill_slot_id set)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ skill_slot_id: 'slot1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED', skill_slot_id: 'slot1' }));
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockJobRequestSkillSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot1' },
        data: { confirmed_count: { decrement: 1 } },
      });
    });

    it('does not touch JobRequestSkillSlot when cancelling a calendar-placed assignment (skill_slot_id null)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ skill_slot_id: null }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
    });

    it('does not decrement JobRequestSkillSlot.confirmed_count on completion, only on cancellation', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(
        makeAssignment({ status: 'IN_PROGRESS', skill_slot_id: 'slot1' })
      );
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED', skill_slot_id: 'slot1' }));
      await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker');
      expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
    });

    // Job-dispatch lifecycle notification fix (2026-08-05): a cancelled
    // assignment previously notified nobody at all.
    describe('cancellation notifications', () => {
      it('notifies the worker when a manager cancels their assignment', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', assigned_by_id: 'mgr1' })
        );
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ status: 'CANCELLED', cancellation_reason: 'sick' })
        );
        await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
          type: 'global',
        });
        expect(mockNotification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ user_id: 'w1', type: 'ASSIGNMENT_CANCELLED' }),
          })
        );
      });

      it('notifies the assigning manager (not the worker) when the worker cancels their own assignment', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', assigned_by_id: 'mgr1' })
        );
        mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
        await service.update('a1', { status: 'CANCELLED' }, 'w1', 'worker');
        expect(mockNotification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ user_id: 'mgr1', type: 'ASSIGNMENT_CANCELLED' }),
          })
        );
        expect(mockNotification.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ user_id: 'w1' }) })
        );
      });

      it('sends no cancellation notification for a non-cancelling transition', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
        mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
        await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker');
        expect(mockNotification.create).not.toHaveBeenCalled();
      });
    });

    // GD-04: this endpoint mutates the fields WorkerOverallRating derives
    // from, so it must recompute the aggregate itself (see SIR-QUAL-005).
    it('refreshes WorkerOverallRating when a transition completes the assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));
      await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    });

    it('refreshes WorkerOverallRating when a transition cancels the assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CONFIRMED', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    });

    it('does not refresh WorkerOverallRating for a transition that does not affect the aggregate (CONFIRMED -> IN_PROGRESS)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CONFIRMED', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker');
      expect(mockWorkerOverallRating.upsert).not.toHaveBeenCalled();
    });

    // Pins SPEC-JOB-DISPATCH-001's RULE-008/REQ-040 terminal-state rule —
    // see SIR-JOBD-007 for why this makes the GD-04 recompute condition safe.
    it('rejects a same-status update, so completed_at cannot change without also recomputing the aggregate', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'COMPLETED', worker_id: 'w1' }));
      await expect(
        service.update('a1', { status: 'COMPLETED' }, 'mgr1', 'manager', { type: 'global' })
      ).rejects.toMatchObject({
        name: 'ConflictError',
      });
      expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
    });
  });

  // Job-dispatch lifecycle feature (2026-08-05): atomic reassign.
  describe('reassign', () => {
    beforeEach(() => {
      // Defaults: new worker eligible at the hotel (ACTIVE EmploymentRecord,
      // matching hotel_group) and free that day.
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockWorkerAssignment.findFirst.mockResolvedValue(null);
      mockWorkerAssignment.create.mockImplementation(async ({ data }: any) => ({
        id: 'a2',
        ...data,
        confirmed_at: new Date('2026-08-05T00:00:00Z'),
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        updated_at: new Date('2026-08-05T00:00:00Z'),
      }));
    });

    it('throws NotFoundError for an unknown assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('rejects reassigning a COMPLETED assignment (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects reassigning an already-CANCELLED assignment (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('rejects reassigning to the same worker already on the assignment (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      await expect(
        service.reassign('a1', { worker_id: 'w1' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('rejects a new worker who is not roster-eligible at the hotel (ForbiddenError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockEmploymentRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects a new worker who already has an assignment that day (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    it('a manager in scope succeeds', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ hotel_id: 'h9' }));
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const result = await service.reassign(
        'a1',
        { worker_id: 'w2' },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } }
      );
      expect(result.new_assignment.worker_id).toBe('w2');
    });

    it('a manager out of scope is denied (ForbiddenError), before touching the transaction', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ hotel_id: 'h9' }));
      await expect(
        service.reassign(
          'a1',
          { worker_id: 'w2' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('sets the old assignment to REASSIGNED and creates a new CONFIRMED one chained via previous_assignment_id', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));

      const result = await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });

      expect(mockWorkerAssignment.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: 'REASSIGNED' },
      });
      expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          worker_id: 'w2',
          assigned_by_id: 'mgr1',
          status: 'CONFIRMED',
          previous_assignment_id: 'a1',
        }),
      });
      expect(result.old_assignment.status).toBe('REASSIGNED');
      expect(result.new_assignment.worker_id).toBe('w2');
    });

    it('inherits hotel_id, day, job_request_id, work_request_id, and skill_slot_id from the old assignment unchanged', async () => {
      // The service reads these from tx.workerAssignment.update()'s RETURN
      // VALUE (oldAssignment), not from the earlier findUnique() lookup --
      // both mocks must agree, but update()'s is what the create() call
      // actually inherits from.
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ hotel_id: 'h1' }));
      mockWorkerAssignment.update.mockResolvedValue(
        makeAssignment({
          status: 'REASSIGNED',
          hotel_id: 'h1',
          day: new Date('2026-08-10T00:00:00.000Z'),
          job_request_id: 'jr1',
          work_request_id: null,
          skill_slot_id: 'slot1',
        })
      );

      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });

      expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          hotel_id: 'h1',
          day: expect.any(Date),
          job_request_id: 'jr1',
          work_request_id: null,
          skill_slot_id: 'slot1',
        }),
      });
      // Reassignment does NOT free the slot -- it changes who fills it, not
      // whether it's filled (contrast with Bug 3's cancel-path decrement).
      expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
    });

    it('recomputes WorkerOverallRating for the OLD worker (their completion rate must reflect the terminal outcome)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'REASSIGNED' }));
      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    });

    it('logs REASSIGN_ASSIGNMENT with both worker ids and the previous assignment id', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));
      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REASSIGN_ASSIGNMENT',
            resource_type: 'WORKER_ASSIGNMENT',
            details: expect.objectContaining({
              previous_assignment_id: 'a1',
              previous_worker_id: 'w1',
              new_worker_id: 'w2',
            }),
          }),
        })
      );
    });

    it('translates a P2002 (new worker double-booked, lost the race) into ConflictError', async () => {
      const { Prisma } = await import('@prisma/client');
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        })
      );
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    // Job-dispatch lifecycle notification fix (2026-08-05): both affected
    // workers were previously left uninformed.
    it('notifies the old worker (shift reassigned away) and the new worker (shift assigned to them)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));
      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 'w1', type: 'ASSIGNMENT_CANCELLED' }),
        })
      );
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 'w2', type: 'ASSIGNMENT_CONFIRMED' }),
        })
      );
    });
  });

  describe('list', () => {
    it('scopes worker to own assignments', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([makeAssignment()]);
      mockWorkerAssignment.count.mockResolvedValue(1);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
      const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBe('w1');
    });

    it('does not scope admin', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([]);
      mockWorkerAssignment.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });
      const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('throws NotFoundError for missing assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(service.getById('a1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('allows worker to view own assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      const dto = await service.getById('a1', { userId: 'w1', role: 'worker' });
      expect(dto.id).toBe('a1');
    });

    // Worker roster access (Epic 5 PR 5.7/5.8, site #2): reads the
    // EmploymentRecord group scope, deny-by-default.
    describe('worker roster access', () => {
      it('allows a worker whose EmploymentRecord group matches the assignment hotel group', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        const dto = await service.getById('a1', { userId: 'w1', role: 'worker' });
        expect(dto.id).toBe('a1');
      });

      it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        await expect(service.getById('a1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });

      it('denies a worker whose EmploymentRecord group does not match the assignment hotel group', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g2' });
        await expect(service.getById('a1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });
    });
  });

  // Worker roster access (Epic 5 PR 5.7/5.8, site #3): mirrors site #2 for
  // update()'s worker-branch membership check.
  describe('update — worker roster access', () => {
    it('allows a worker whose EmploymentRecord group matches the assignment hotel group', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: 'CONFIRMED' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: 'IN_PROGRESS' }));
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const dto = await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker');
      expect(dto.status).toBe('IN_PROGRESS');
    });

    it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: 'CONFIRMED' }));
      mockEmploymentRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });
  });

  // Epic 9 PR 9.3 (TREQ-012): WorkerAssignment gains a nullable job_request_id
  // FK, repointing it off the removed application_id (PR 9.2). No creation
  // path writes this column yet (PR 9.9 is the first writer); this pins the
  // schema-level fact so a future change can't silently drop or tighten it
  // ahead of that landing. Mirrors user-permissions-column-dropped.test.ts's
  // file-parsing convention for schema-shape assertions.
  describe('Epic 9 PR 9.3: WorkerAssignment.job_request_id', () => {
    it('the Prisma schema declares job_request_id as a nullable field on WorkerAssignment', () => {
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      const modelMatch = schema.match(/model WorkerAssignment \{([\s\S]*?)\n\}/);
      expect(modelMatch).not.toBeNull();

      const modelBody = modelMatch![1];
      expect(modelBody).toMatch(/^\s*job_request_id\s+String\?\s*$/m);
    });

    it('no longer declares an application_id field on WorkerAssignment (PR 9.2)', () => {
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      const modelMatch = schema.match(/model WorkerAssignment \{([\s\S]*?)\n\}/);
      expect(modelMatch).not.toBeNull();

      const modelBody = modelMatch![1];
      expect(modelBody).not.toMatch(/^\s*application_id\b/m);
    });

    it('a migration exists that adds the job_request_id column to WorkerAssignment', () => {
      const migrationsDir = path.join(__dirname, '../../prisma/migrations');
      const migrationDirs = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

      const addMigration = migrationDirs.find((dir) => {
        const sqlPath = path.join(migrationsDir, dir.name, 'migration.sql');
        if (!fs.existsSync(sqlPath)) return false;
        const sql = fs.readFileSync(sqlPath, 'utf8');
        return /ADD COLUMN\s+"job_request_id"/i.test(sql);
      });

      expect(addMigration).toBeDefined();
    });
  });

  // Epic 9 PR 9.5 (MIG-GAP-03 correction): WorkerAssignment.work_request_id is
  // relaxed from mandatory to nullable in this PR's own migration (paired
  // with the CalendarEntry add). Regression guard for the null-safety pass
  // this made necessary in toDto()'s existing DTO mapping — a calendar-placed
  // (or, later, broadcast-accept) row with a null work_request_id must map
  // cleanly through list()/getById() without throwing or coercing null to a
  // string.
  describe('Epic 9 PR 9.5: work_request_id null-safety regression guard', () => {
    it('the Prisma schema declares work_request_id as nullable on WorkerAssignment', () => {
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      const modelMatch = schema.match(/model WorkerAssignment \{([\s\S]*?)\n\}/);
      expect(modelMatch).not.toBeNull();

      const modelBody = modelMatch![1];
      expect(modelBody).toMatch(/^\s*work_request_id\s+String\?\s*$/m);
    });

    it('a migration exists that relaxes work_request_id to nullable', () => {
      const migrationsDir = path.join(__dirname, '../../prisma/migrations');
      const migrationDirs = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

      const relaxMigration = migrationDirs.find((dir) => {
        const sqlPath = path.join(migrationsDir, dir.name, 'migration.sql');
        if (!fs.existsSync(sqlPath)) return false;
        const sql = fs.readFileSync(sqlPath, 'utf8');
        return /ALTER COLUMN\s+"work_request_id"\s+DROP NOT NULL/i.test(sql);
      });

      expect(relaxMigration).toBeDefined();
    });

    it('getById maps a work_request_id: null row through toDto without error', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ work_request_id: null }));
      const dto = await service.getById('a1', { userId: 'a1', role: 'admin' });
      expect(dto.work_request_id).toBeNull();
    });

    it('list maps a mix of null and non-null work_request_id rows through toDto', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([
        makeAssignment({ id: 'a1', work_request_id: null }),
        makeAssignment({ id: 'a2', work_request_id: 'wr1' }),
      ]);
      mockWorkerAssignment.count.mockResolvedValue(2);
      const { data } = await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });
      expect(data[0].work_request_id).toBeNull();
      expect(data[1].work_request_id).toBe('wr1');
    });
  });
});
