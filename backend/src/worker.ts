import './instrument.js';
import { loadEnv, getEnv } from './config/env.js';
import { connectDb, disconnectDb, getPrisma } from './lib/db.js';
import { logger } from './lib/logger.js';
import { captureException } from './lib/error-tracker.js';
import { Scheduler } from './lib/scheduler.js';
import { ReworkEscalationJob } from './modules/quality/rework-escalation-job.js';
import { InspectionDigestJob } from './modules/quality/inspection-digest-job.js';
import { ReworkExpiryJob } from './modules/quality/rework-expiry-job.js';
import { OutboxRepository } from './modules/notifications/outbox-repository.js';
import { OutboxWorker } from './modules/notifications/outbox-worker.js';
import {
  resolveEmailTransportHandler,
  resolvePushTransportHandler,
  TransportRegistry,
} from './modules/notifications/outbox-transport.js';
import { SessionSweepJob } from './modules/auth/session-sweep-job.js';
import { GeoRetentionSweepJob } from './modules/geo/retention-sweep-job.js';
import { RetentionSweepJob } from './modules/retention/sweep-job.js';
import { PlatformTableSweepJob } from './modules/retention/platform-table-sweep-job.js';
import { JobRequestAutoCloseJob } from './modules/job-requests/auto-close-job.js';
import { HrContractExpiryReminderJob } from './modules/hr/expiry-reminder-job.js';
import { AssignmentNoShowJob } from './modules/assignments/no-show-job.js';
import { ShiftReminderJob } from './modules/assignments/shift-reminder-job.js';

/**
 * Platform Worker process entrypoint (ADR-029 §3). A second Node entrypoint over
 * the same modular-monolith codebase and Prisma client as the API server
 * (server.ts), deployed as a separate OS process (see ecosystem.config.js). It
 * drains the transactional outbox and hosts scheduled jobs; it never serves HTTP.
 *
 * PR 7.4/7.5 wiring: EMAIL registers a real handler (SendGrid/Resend, selected
 * by EMAIL_SERVICE) once configured, falling back to the PR-7.2 no-op/log
 * handler otherwise (resolveEmailTransportHandler). PUSH registers a real
 * handler (APNs/FCM, each configured independently) once at least one
 * platform is configured, falling back to the same no-op handler otherwise
 * (resolvePushTransportHandler). WEBHOOK and SMS are intentionally left
 * unregistered (reserved, ADR-029 §4) so their rows are never claimed.
 *
 * ADR-031 D-5 (PR-6): the session/reset-token sweep is the first scheduled
 * job registered on the Scheduler — expired Session rows (SIR-AUTH-014)
 * and expired/used PasswordResetToken rows (SIR-AUTH-018), on a
 * configuration-driven interval (default hourly).
 *
 * GD-14/OD-GEO-002 (SPEC-GEO-001): the geo retention sweep hard-deletes
 * WorkerGeoCheckin rows older than 6 months (GDPR Tier 1), on a
 * configuration-driven interval (default daily).
 *
 * SPEC-RETENTION-001 PR 3: the generic retention sweep hard-deletes
 * RetentionLog rows once their registered category's tier window elapses,
 * writing a RetentionAuditEntry per deletion, on a configuration-driven
 * interval (default daily). Scope boundary disclosed in the job's own
 * header comment (retention/sweep-job.ts).
 *
 * Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): the job-request
 * auto-close job closes any broadcast JobRequest still OPEN more than 6
 * hours after creation, notifying the raising manager, on a
 * configuration-driven interval (default every 15 minutes). Confirms
 * ADR-057's Platform-Worker-not-BullMQ decision in code.
 *
 * HR implementation PR 5 (IF-HR-ContractExpiryReminder, RULE-HR-07): the
 * contract expiry reminder job notifies the responsible manager as a
 * contract approaches its 1yr/2yr mark, on a configuration-driven interval
 * (default daily). ADR-041's payslip-request escalation job is NOT
 * registered here -- deferred, see hr/service.ts's own header comment: its
 * Admin-fallback notification mechanism has no product/architecture
 * decision behind it yet.
 */
async function main() {
  try {
    loadEnv();
    const env = getEnv();

    await connectDb();
    const prisma = getPrisma();

    const transports = new TransportRegistry()
      .register(
        resolveEmailTransportHandler(prisma, {
          emailService: env.EMAIL_SERVICE,
          sendgridApiKey: env.SENDGRID_API_KEY,
          resendApiKey: env.RESEND_API_KEY,
          fromAddress: env.EMAIL_FROM_ADDRESS,
        })
      )
      .register(
        resolvePushTransportHandler(prisma, {
          apnsPrivateKeyBase64: env.APNS_PRIVATE_KEY_BASE64,
          apnsKeyId: env.APNS_KEY_ID,
          apnsTeamId: env.APNS_TEAM_ID,
          apnsBundleIdWorker: env.APNS_BUNDLE_ID_WORKER,
          apnsBundleIdChecker: env.APNS_BUNDLE_ID_CHECKER,
          firebaseProjectId: env.FIREBASE_PROJECT_ID,
          firebaseServiceAccountKeyBase64: env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64,
        })
      );

    const scheduler = new Scheduler()
      .register(
        new SessionSweepJob(prisma, {
          intervalMs: env.SESSION_SWEEP_INTERVAL_MS,
          batchSize: env.SESSION_SWEEP_BATCH_SIZE,
          maxBatchesPerRun: env.SESSION_SWEEP_MAX_BATCHES_PER_RUN,
        })
      )
      .register(
        new ReworkEscalationJob(prisma, {
          intervalMs: env.REWORK_ESCALATION_INTERVAL_MS,
          batchSize: env.REWORK_ESCALATION_BATCH_SIZE,
        })
      )
      .register(
        new InspectionDigestJob(prisma, {
          intervalMs: env.INSPECTION_DIGEST_INTERVAL_MS,
          batchSize: env.INSPECTION_DIGEST_BATCH_SIZE,
        })
      )
      .register(
        new ReworkExpiryJob(prisma, {
          intervalMs: env.REWORK_EXPIRY_INTERVAL_MS,
          batchSize: env.REWORK_EXPIRY_BATCH_SIZE,
        })
      )
      .register(
        new GeoRetentionSweepJob(prisma, {
          intervalMs: env.GEO_RETENTION_SWEEP_INTERVAL_MS,
          batchSize: env.GEO_RETENTION_SWEEP_BATCH_SIZE,
          maxBatchesPerRun: env.GEO_RETENTION_SWEEP_MAX_BATCHES_PER_RUN,
        })
      )
      .register(
        new RetentionSweepJob(prisma, {
          intervalMs: env.RETENTION_SWEEP_INTERVAL_MS,
          batchSize: env.RETENTION_SWEEP_BATCH_SIZE,
          maxBatchesPerRun: env.RETENTION_SWEEP_MAX_BATCHES_PER_RUN,
        })
      )
      .register(
        new PlatformTableSweepJob(prisma, {
          intervalMs: env.PLATFORM_TABLE_SWEEP_INTERVAL_MS,
          batchSize: env.PLATFORM_TABLE_SWEEP_BATCH_SIZE,
          maxBatchesPerRun: env.PLATFORM_TABLE_SWEEP_MAX_BATCHES_PER_RUN,
          notificationRetentionDays: env.PLATFORM_NOTIFICATION_RETENTION_DAYS,
          operationalRetentionDays: env.PLATFORM_OPERATIONAL_RETENTION_DAYS,
        })
      )
      .register(
        new JobRequestAutoCloseJob({
          intervalMs: env.JOB_REQUEST_AUTO_CLOSE_INTERVAL_MS,
          autoCloseAfterMs: env.JOB_REQUEST_AUTO_CLOSE_AFTER_MS,
          batchSize: env.JOB_REQUEST_AUTO_CLOSE_BATCH_SIZE,
        })
      )
      .register(
        new HrContractExpiryReminderJob({
          intervalMs: env.HR_CONTRACT_EXPIRY_REMINDER_INTERVAL_MS,
          batchSize: env.HR_CONTRACT_EXPIRY_REMINDER_BATCH_SIZE,
        })
      )
      .register(
        new AssignmentNoShowJob({
          intervalMs: env.ASSIGNMENT_NO_SHOW_INTERVAL_MS,
          gracePeriodMs: env.ASSIGNMENT_NO_SHOW_GRACE_PERIOD_MS,
        })
      )
      .register(
        new ShiftReminderJob({
          intervalMs: env.SHIFT_REMINDER_INTERVAL_MS,
        })
      );

    const worker = new OutboxWorker(
      new OutboxRepository(prisma),
      transports,
      scheduler,
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
