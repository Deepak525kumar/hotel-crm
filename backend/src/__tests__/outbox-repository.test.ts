import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { OutboxRepository } from '../modules/notifications/outbox-repository.js';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'row1',
  event_id: 'evt1',
  correlation_id: 'corr1',
  transport: 'EMAIL',
  status: 'PROCESSING',
  attempts: 0,
  ...overrides,
});

const SCHEDULE = [60_000, 300_000];
const NOW = new Date('2026-07-24T00:00:00.000Z');

describe('OutboxRepository', () => {
  let mockTx: any;
  let mockPrisma: any;
  let repo: OutboxRepository;

  beforeEach(() => {
    mockTx = {
      $queryRaw: jest.fn(),
      outboxEvent: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    mockPrisma = {
      $transaction: jest.fn((cb: any) => cb(mockTx)),
      $queryRaw: jest.fn(),
      outboxEvent: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    repo = new OutboxRepository(mockPrisma);
  });

  describe('claimBatch', () => {
    it('returns [] without touching the DB when no transports are registered', async () => {
      const result = await repo.claimBatch({
        registeredTransports: [],
        batchSize: 10,
        processingTimeoutMs: 300_000,
      });
      expect(result).toEqual([]);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('claims due rows, marks them PROCESSING, and returns them in claim order', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      mockTx.outboxEvent.updateMany.mockResolvedValue({ count: 2 });
      // findMany may return in any order; repository must restore claim order.
      mockTx.outboxEvent.findMany.mockResolvedValue([makeRow({ id: 'b' }), makeRow({ id: 'a' })]);

      const result = await repo.claimBatch({
        registeredTransports: ['EMAIL', 'PUSH'] as any,
        batchSize: 10,
        processingTimeoutMs: 300_000,
      });

      expect(result.map((r) => r.id)).toEqual(['a', 'b']);
      const updateArgs = mockTx.outboxEvent.updateMany.mock.calls[0][0] as any;
      expect(updateArgs.where).toEqual({ id: { in: ['a', 'b'] } });
      expect(updateArgs.data.status).toBe('PROCESSING');
    });

    it('short-circuits the mark/return when the claim finds nothing', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);
      const result = await repo.claimBatch({
        registeredTransports: ['EMAIL'] as any,
        batchSize: 10,
        processingTimeoutMs: 300_000,
      });
      expect(result).toEqual([]);
      expect(mockTx.outboxEvent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markDelivered', () => {
    it('sets DELIVERED + processed_at, guarded on PROCESSING', async () => {
      mockPrisma.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
      await repo.markDelivered('row1', NOW);
      const args = mockPrisma.outboxEvent.updateMany.mock.calls[0][0] as any;
      expect(args.where).toEqual({ id: 'row1', status: 'PROCESSING' });
      expect(args.data.status).toBe('DELIVERED');
      expect(args.data.processed_at).toBe(NOW);
      expect(args.data.last_error).toBeNull();
    });
  });

  describe('recordFailure', () => {
    it('schedules a retry (FAILED) with next_attempt_at while the schedule has slots', async () => {
      mockPrisma.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
      const status = await repo.recordFailure({
        row: makeRow({ attempts: 0 }) as any,
        scheduleMs: SCHEDULE,
        error: 'smtp timeout',
        now: NOW,
      });
      expect(status).toBe('FAILED');
      const args = mockPrisma.outboxEvent.updateMany.mock.calls[0][0] as any;
      expect(args.where).toEqual({ id: 'row1', status: 'PROCESSING' });
      expect(args.data.status).toBe('FAILED');
      expect(args.data.attempts).toBe(1);
      expect(args.data.next_attempt_at).toEqual(new Date(NOW.getTime() + 60_000));
      expect(args.data.last_error).toBe('smtp timeout');
    });

    it('dead-letters once the schedule is exhausted', async () => {
      mockPrisma.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
      const status = await repo.recordFailure({
        row: makeRow({ attempts: 2 }) as any, // next attempt = 3 > schedule length 2
        scheduleMs: SCHEDULE,
        error: 'still failing',
        now: NOW,
      });
      expect(status).toBe('DEAD_LETTER');
      const args = mockPrisma.outboxEvent.updateMany.mock.calls[0][0] as any;
      expect(args.data.status).toBe('DEAD_LETTER');
      expect(args.data.attempts).toBe(3);
      expect(args.data.processed_at).toBe(NOW);
      expect(args.data.last_error).toBe('still failing');
    });
  });

  // Epic 7 PR 7.6 (ADR-029 §9): observability + dead-letter operability.

  describe('getStatusCounts', () => {
    it('zero-fills every status not present in the groupBy result', async () => {
      mockPrisma.outboxEvent.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: { _all: 3 } },
        { status: 'DEAD_LETTER', _count: { _all: 1 } },
      ]);

      const counts = await repo.getStatusCounts();

      expect(counts).toEqual({
        PENDING: 3,
        PROCESSING: 0,
        DELIVERED: 0,
        FAILED: 0,
        DEAD_LETTER: 1,
      });
    });
  });

  describe('getBacklog', () => {
    it('counts non-terminal rows and reports the age of the oldest', async () => {
      mockPrisma.outboxEvent.aggregate.mockResolvedValue({
        _count: { _all: 7 },
        _min: { created_at: new Date(NOW.getTime() - 90_000) },
      });

      const result = await repo.getBacklog(NOW);

      expect(result).toEqual({ backlogCount: 7, oldestPendingAgeMs: 90_000 });
      const args = mockPrisma.outboxEvent.aggregate.mock.calls[0][0] as any;
      // DELIVERED and DEAD_LETTER are terminal — they are not backlog.
      expect(args.where.status.in.sort()).toEqual(['FAILED', 'PENDING', 'PROCESSING']);
    });

    it('reports a null age (not 0) when the backlog is empty', async () => {
      mockPrisma.outboxEvent.aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _min: { created_at: null },
      });

      expect(await repo.getBacklog(NOW)).toEqual({ backlogCount: 0, oldestPendingAgeMs: null });
    });
  });

  describe('getDeliveryLatency', () => {
    it('returns the average and coerces the bigint sample size to a number', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ avg_ms: 1234.5, sample_size: BigInt(42) }]);

      expect(await repo.getDeliveryLatency()).toEqual({ averageMs: 1234.5, sampleSize: 42 });
    });

    it('handles the no-delivered-rows case (SQL AVG returns null)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ avg_ms: null, sample_size: BigInt(0) }]);

      expect(await repo.getDeliveryLatency()).toEqual({ averageMs: null, sampleSize: 0 });
    });
  });

  describe('listDeadLetters', () => {
    it('filters to DEAD_LETTER, paginates, and returns the total', async () => {
      mockPrisma.outboxEvent.findMany.mockResolvedValue([makeRow({ status: 'DEAD_LETTER' })]);
      mockPrisma.outboxEvent.count.mockResolvedValue(9);

      const result = await repo.listDeadLetters({ skip: 20, take: 10 });

      expect(result.total).toBe(9);
      expect(result.rows).toHaveLength(1);
      const args = mockPrisma.outboxEvent.findMany.mock.calls[0][0] as any;
      expect(args.where).toEqual({ status: 'DEAD_LETTER' });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
  });

  describe('requeue', () => {
    it('moves DEAD_LETTER back to PENDING due now, preserving attempts and last_error', async () => {
      const row = makeRow({ status: 'DEAD_LETTER', attempts: 4, last_error: 'apns 503' });
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(row);
      mockPrisma.outboxEvent.updateMany.mockResolvedValue({ count: 1 });

      const result = await repo.requeue('row1', NOW);

      expect(result).toBe(row);
      const args = mockPrisma.outboxEvent.updateMany.mock.calls[0][0] as any;
      expect(args.where).toEqual({ id: 'row1', status: 'DEAD_LETTER' });
      expect(args.data.status).toBe('PENDING');
      expect(args.data.next_attempt_at).toBe(NOW);
      expect(args.data.processed_at).toBeNull();
      // The failure history is the whole point of the audit trail — never reset.
      expect(args.data).not.toHaveProperty('attempts');
      expect(args.data).not.toHaveProperty('last_error');
    });

    it('returns null for a missing row, without writing', async () => {
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(null);

      expect(await repo.requeue('nope')).toBeNull();
      expect(mockPrisma.outboxEvent.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to requeue a row that is not dead-lettered', async () => {
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(makeRow({ status: 'PENDING' }));

      expect(await repo.requeue('row1')).toBeNull();
      expect(mockPrisma.outboxEvent.updateMany).not.toHaveBeenCalled();
    });

    it('returns null when a concurrent requeue won the race (guarded update matched 0 rows)', async () => {
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(makeRow({ status: 'DEAD_LETTER' }));
      mockPrisma.outboxEvent.updateMany.mockResolvedValue({ count: 0 });

      expect(await repo.requeue('row1')).toBeNull();
    });
  });

  describe('discard', () => {
    it('deletes a dead-lettered row and returns its pre-delete snapshot', async () => {
      const row = makeRow({ status: 'DEAD_LETTER', attempts: 4 });
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(row);
      mockPrisma.outboxEvent.deleteMany.mockResolvedValue({ count: 1 });

      const result = await repo.discard('row1');

      expect(result).toBe(row);
      expect(mockPrisma.outboxEvent.deleteMany).toHaveBeenCalledWith({
        where: { id: 'row1', status: 'DEAD_LETTER' },
      });
    });

    it('refuses to discard a row still in flight', async () => {
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(makeRow({ status: 'PROCESSING' }));

      expect(await repo.discard('row1')).toBeNull();
      expect(mockPrisma.outboxEvent.deleteMany).not.toHaveBeenCalled();
    });

    it('returns null when a concurrent discard won the race', async () => {
      mockPrisma.outboxEvent.findUnique.mockResolvedValue(makeRow({ status: 'DEAD_LETTER' }));
      mockPrisma.outboxEvent.deleteMany.mockResolvedValue({ count: 0 });

      expect(await repo.discard('row1')).toBeNull();
    });
  });
});
