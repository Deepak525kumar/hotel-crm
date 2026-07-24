import { OutboxTransport } from '@prisma/client';
import { loadEnv, getEnv } from './config/env.js';
import { connectDb, disconnectDb, getPrisma } from './lib/db.js';
import { logger } from './lib/logger.js';
import { captureException } from './lib/error-tracker.js';
import { Scheduler } from './lib/scheduler.js';
import { OutboxRepository } from './modules/notifications/outbox-repository.js';
import { OutboxWorker } from './modules/notifications/outbox-worker.js';
import {
  LoggingNoopTransportHandler,
  TransportRegistry,
} from './modules/notifications/outbox-transport.js';

/**
 * Platform Worker process entrypoint (ADR-029 §3). A second Node entrypoint over
 * the same modular-monolith codebase and Prisma client as the API server
 * (server.ts), deployed as a separate OS process (see ecosystem.config.js). It
 * drains the transactional outbox and hosts scheduled jobs; it never serves HTTP.
 *
 * PR 7.2 wiring: EMAIL and PUSH are registered with the no-op/log handler (real
 * handlers land in PR 7.4/7.5); WEBHOOK and SMS are intentionally left
 * unregistered (reserved, ADR-029 §4) so their rows are never claimed. No
 * scheduled job is registered yet.
 */
async function main() {
  try {
    loadEnv();
    const env = getEnv();

    await connectDb();

    const transports = new TransportRegistry()
      .register(new LoggingNoopTransportHandler(OutboxTransport.EMAIL))
      .register(new LoggingNoopTransportHandler(OutboxTransport.PUSH));

    const worker = new OutboxWorker(
      new OutboxRepository(getPrisma()),
      transports,
      new Scheduler(),
      {
        pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
        claimBatchSize: env.OUTBOX_CLAIM_BATCH_SIZE,
        backoffScheduleMs: env.OUTBOX_BACKOFF_SCHEDULE_MS,
        processingTimeoutMs: env.OUTBOX_PROCESSING_TIMEOUT_MS,
      }
    );

    worker.start();

    const shutdown = (signal: string) => {
      logger.info(`${signal} received, stopping Platform Worker gracefully...`);
      let forced = false;
      const force = setTimeout(() => {
        forced = true;
        logger.error('Forced Platform Worker shutdown after timeout');
        process.exit(1);
      }, 10000);

      worker
        .stop()
        .then(() => disconnectDb())
        .then(() => {
          if (forced) return;
          clearTimeout(force);
          process.exit(0);
        })
        .catch((error) => {
          clearTimeout(force);
          logger.error('Error during Platform Worker shutdown', {
            error: error instanceof Error ? error.message : String(error),
          });
          process.exit(1);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception in Platform Worker', {
        message: error.message,
        stack: error.stack,
      });
      captureException(error, { source: 'worker:uncaughtException' });
      process.exit(1);
    });

    // Mirror server.ts: log unhandled rejections loudly but do not crash the
    // worker over a single stray rejection.
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection in Platform Worker', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: String(promise),
      });
      captureException(reason, { source: 'worker:unhandledRejection' });
    });
  } catch (error) {
    process.stderr.write('Failed to start Platform Worker\n');
    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exit(1);
  }
}

main();
