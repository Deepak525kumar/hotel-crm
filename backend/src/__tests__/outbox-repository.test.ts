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
      outboxEvent: { updateMany: jest.fn() },
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
});
