import { loadEnv, getEnv } from './config/env.js';
import { createApp } from './app.js';
import { connectDb, disconnectDb } from './lib/db.js';
import { logger } from './lib/logger.js';
import { captureException } from './lib/error-tracker.js';

async function main() {
  try {
    // Load environment
    loadEnv();
    const env = getEnv();

    // Verify database connectivity BEFORE the server starts listening so the
    // process fails fast (and the orchestrator restarts it) instead of
    // accepting requests against an unconfirmed connection.
    await connectDb();

    // Create app
    const app = createApp();

    // Start server
    const server = app.listen(env.PORT, () => {
      logger.info(`Server started`, {
        port: env.PORT,
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
      });
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully...');
      server.close(async () => {
        await disconnectDb();
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    });

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      server.close(async () => {
        await disconnectDb();
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {
        message: error.message,
        stack: error.stack,
      });
      captureException(error, { source: 'uncaughtException' });
      process.exit(1);
    });

    // Handle unhandled promise rejections.
    //
    // P2-06 policy: log loudly but do NOT crash the process.
    //
    // Reasoning: an unhandledRejection does not imply corrupted global state
    // the way an uncaughtException does. Crashing the entire process on a
    // single stray rejection (e.g. a fire-and-forget notification that
    // rejected) takes down every in-flight request and amplifies a localized
    // bug into a full outage. We preserve observability by logging the full
    // reason + stack at error level so monitoring/alerting still surfaces it
    // and nothing fails silently — but we keep serving healthy traffic.
    // Genuinely fatal conditions are still handled by uncaughtException above,
    // which retains the fail-fast exit.
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: String(promise),
      });
      captureException(reason, { source: 'unhandledRejection' });
    });
  } catch (error) {
    // Startup failure path: report directly to stderr instead of through the
    // logger. The logger initializes lazily via getEnv(), so if startup failed
    // because the environment never loaded (e.g. loadEnv() threw), logging here
    // would throw a second 'Environment not loaded' error and mask the original
    // exception. Direct stderr output has no dependency on env/logger init and
    // surfaces the real error, including its stack and any validation messages.
    process.stderr.write('Failed to start server\n');
    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exit(1);
  }
}

main();
