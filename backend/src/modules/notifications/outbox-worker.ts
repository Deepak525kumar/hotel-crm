import { OutboxEvent } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { Scheduler } from '../../lib/scheduler.js';
import { OutboxRepository } from './outbox-repository.js';
import { TransportRegistry } from './outbox-transport.js';

export interface OutboxWorkerConfig {
  pollIntervalMs: number;
  claimBatchSize: number;
  backoffScheduleMs: readonly number[];
  processingTimeoutMs: number;
  /** Safety bound on batches drained per tick, so a large backlog can't starve the scheduler. */
  maxBatchesPerTick?: number;
}

/**
 * The Platform Worker (ADR-029 §3): the canonical asynchronous execution runtime
 * for the modular monolith. On each poll tick it drains due OutboxEvent rows
 * (claim → dispatch via the transport handler → terminal/retry transition) and
 * runs any due scheduled jobs. It is a separate process over the same codebase
 * (see worker.ts entrypoint); it delivers, it never enqueues.
 *
 * PR 7.2 scope: the runtime, claim/lifecycle, backoff, dispatch interface, and
 * scheduler mechanism. Real EMAIL/PUSH handlers (PR 7.4/7.5) are registered by
 * the caller; the first domain scheduled job (the ADR-031 D-5 session sweep)
 * is registered in worker.ts.
 */
export class OutboxWorker {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private readonly maxBatchesPerTick: number;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly transports: TransportRegistry,
    private readonly scheduler: Scheduler,
    private readonly config: OutboxWorkerConfig,
    private readonly sleepFn: (ms: number) => Promise<void> = defaultSleep
  ) {
    this.maxBatchesPerTick = config.maxBatchesPerTick ?? 50;
  }

  /** Start the poll loop. Returns immediately; the loop runs until stop(). */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('Platform Worker started', {
      poll_interval_ms: this.config.pollIntervalMs,
      claim_batch_size: this.config.claimBatchSize,
      registered_transports: this.transports.registeredTransports(),
      scheduled_jobs: this.scheduler.registeredJobNames(),
    });
    this.loopPromise = this.loop();
  }

  /** Signal the loop to stop and await the in-flight tick to finish. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) await this.loopPromise;
    logger.info('Platform Worker stopped');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch (error) {
        // A tick-level failure (e.g. the claim query threw) must not kill the
        // loop — log and continue on the next interval.
        logger.error('Platform Worker tick failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      if (this.running) await this.sleepFn(this.config.pollIntervalMs);
    }
  }

  /** One tick: drain the outbox until empty (bounded), then run due jobs. Exposed for tests. */
  async runOnce(): Promise<void> {
    await this.drain();
    await this.scheduler.tick();
  }

  private async drain(): Promise<void> {
    const registeredTransports = this.transports.registeredTransports();
    if (registeredTransports.length === 0) return;

    for (let batch = 0; batch < this.maxBatchesPerTick; batch++) {
      const claimed = await this.repository.claimBatch({
        registeredTransports,
        batchSize: this.config.claimBatchSize,
        processingTimeoutMs: this.config.processingTimeoutMs,
      });
      if (claimed.length === 0) return;

      for (const row of claimed) {
        await this.dispatch(row);
      }

      // A short batch means the queue is drained; stop until the next tick.
      if (claimed.length < this.config.claimBatchSize) return;
    }
  }

  private async dispatch(row: OutboxEvent): Promise<void> {
    const handler = this.transports.get(row.transport);
    if (!handler) {
      // The claim only returns registered transports; this is a defensive guard
      // against a handler being deregistered mid-tick. Leave the row for a later
      // claim rather than failing it.
      return;
    }
    try {
      await handler.deliver(row);
      await this.repository.markDelivered(row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = await this.repository.recordFailure({
        row,
        scheduleMs: this.config.backoffScheduleMs,
        error: message,
      });
      logger.warn('Platform Worker: delivery failed', {
        transport: row.transport,
        event_id: row.event_id,
        attempts: row.attempts + 1,
        outcome: status,
        error: message,
      });
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
