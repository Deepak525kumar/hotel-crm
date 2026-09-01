import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { OutboxWorker, OutboxWorkerConfig, defaultSleep } from '../modules/notifications/outbox-worker.js';

const CONFIG: OutboxWorkerConfig = {
  pollIntervalMs: 5000,
  claimBatchSize: 2,
  backoffScheduleMs: [1000, 2000],
  processingTimeoutMs: 300_000,
};

const makeRow = (id: string, transport = 'EMAIL') =>
  ({ id, event_id: `evt-${id}`, transport, attempts: 0, status: 'PROCESSING' }) as any;

function makeDeps() {
  const repository = {
    claimBatch: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    markDelivered: jest.fn(async () => {}) as jest.MockedFunction<(...a: any[]) => any>,
    recordFailure: jest.fn(async () => 'FAILED') as jest.MockedFunction<(...a: any[]) => any>,
  };
  const handler = { transport: 'EMAIL', deliver: jest.fn(async () => {}) as jest.MockedFunction<(...a: any[]) => any> };
  const transports = {
    get: jest.fn(() => handler) as jest.MockedFunction<(...a: any[]) => any>,
    registeredTransports: jest.fn(() => ['EMAIL', 'PUSH']) as jest.MockedFunction<() => string[]>,
  };
  const scheduler = {
    tick: jest.fn(async () => {}) as jest.MockedFunction<(...a: any[]) => any>,
    registeredJobNames: jest.fn(() => []) as jest.MockedFunction<() => string[]>,
  };
  return { repository, handler, transports, scheduler };
}

describe('OutboxWorker (ADR-029 §3 Platform Worker)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('claims, dispatches via the handler, and marks each row delivered', async () => {
    const { repository, handler, transports, scheduler } = makeDeps();
    repository.claimBatch.mockResolvedValueOnce([makeRow('a')]).mockResolvedValue([]);

    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG);
    await worker.runOnce();

    expect(handler.deliver).toHaveBeenCalledTimes(1);
    expect(repository.markDelivered).toHaveBeenCalledWith('a');
    expect(repository.recordFailure).not.toHaveBeenCalled();
    expect(scheduler.tick).toHaveBeenCalledTimes(1);
  });

  it('records a failure (not delivered) when the handler throws', async () => {
    const { repository, handler, transports, scheduler } = makeDeps();
    handler.deliver.mockRejectedValueOnce(new Error('provider down'));
    repository.claimBatch.mockResolvedValueOnce([makeRow('a')]).mockResolvedValue([]);

    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG);
    await worker.runOnce();

    expect(repository.markDelivered).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledTimes(1);
    const arg = repository.recordFailure.mock.calls[0][0] as any;
    expect(arg.error).toBe('provider down');
    expect(arg.scheduleMs).toEqual([1000, 2000]);
  });

  it('drains until a short batch, then stops (multiple claims per tick)', async () => {
    const { repository, transports, scheduler } = makeDeps();
    repository.claimBatch
      .mockResolvedValueOnce([makeRow('a'), makeRow('b')]) // full batch → keep draining
      .mockResolvedValueOnce([makeRow('c')]) // short batch → stop
      .mockResolvedValue([]);

    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG);
    await worker.runOnce();

    expect(repository.claimBatch).toHaveBeenCalledTimes(2);
  });

  it('does not claim when no transport is registered', async () => {
    const { repository, transports, scheduler } = makeDeps();
    transports.registeredTransports.mockReturnValue([]);

    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG);
    await worker.runOnce();

    expect(repository.claimBatch).not.toHaveBeenCalled();
    expect(scheduler.tick).toHaveBeenCalledTimes(1); // scheduler still ticks
  });

  it('passes the registered transports and batch size into the claim', async () => {
    const { repository, transports, scheduler } = makeDeps();
    repository.claimBatch.mockResolvedValue([]);

    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG);
    await worker.runOnce();

    const arg = repository.claimBatch.mock.calls[0][0] as any;
    expect(arg.registeredTransports).toEqual(['EMAIL', 'PUSH']);
    expect(arg.batchSize).toBe(2);
    expect(arg.processingTimeoutMs).toBe(300_000);
  });

  it('start/stop runs at least one tick and stops cleanly', async () => {
    const { repository, transports, scheduler } = makeDeps();
    repository.claimBatch.mockResolvedValue([]);
    let resolveSleep: () => void;
    const sleep = jest.fn(
      () => new Promise<void>((r) => { resolveSleep = r; })
    ) as unknown as (ms: number) => Promise<void>;

    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG, sleep);
    worker.start();
    // Let the first tick run and reach the sleep.
    await new Promise((r) => setImmediate(r));
    expect(scheduler.tick).toHaveBeenCalled();

    const stopped = worker.stop();
    resolveSleep!(); // release the pending sleep so the loop can observe running=false
    await stopped;
    expect(mockLogger.info).toHaveBeenCalledWith('Platform Worker stopped');
  });

  it('is idempotent on double start', () => {
    const { repository, transports, scheduler } = makeDeps();
    repository.claimBatch.mockResolvedValue([]);
    const sleep = (() => new Promise<void>(() => {})) as (ms: number) => Promise<void>;
    const worker = new OutboxWorker(repository as any, transports as any, scheduler as any, CONFIG, sleep);
    worker.start();
    worker.start(); // no throw, no second loop
    const startLogs = mockLogger.info.mock.calls.filter((c) => c[0] === 'Platform Worker started');
    expect(startLogs).toHaveLength(1);
  });

  // Regression: the loop's only thing keeping the Platform Worker process
  // alive between ticks is the pending sleep timer -- an idle PrismaClient
  // connection does NOT hold the event loop open on its own (verified live:
  // production ran the process into a ~3-second PM2 restart loop, thousands
  // of restarts within hours, once this timer was unref'd). Asserted via a
  // real (unfaked) timer, since a fake-timer .unref() call is a no-op that
  // would pass either way and prove nothing.
  it('defaultSleep never unrefs its timer', async () => {
    const realSetTimeout = global.setTimeout;
    const unref = jest.fn(() => timer);
    let timer: ReturnType<typeof setTimeout>;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      timer = realSetTimeout(fn, ms);
      timer.unref = unref;
      return timer;
    }) as typeof setTimeout);

    await defaultSleep(1);

    expect(unref).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
