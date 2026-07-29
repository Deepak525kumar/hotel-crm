import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';
import { jobRequestService } from './service.js';

export interface JobRequestAutoCloseJobConfig {
  intervalMs: number;
  /** How long an OPEN broadcast may remain unfilled before auto-closing (TREQ-006: 6 hours). */
  autoCloseAfterMs: number;
  batchSize: number;
}

/**
 * Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): closes any broadcast
 * JobRequest still OPEN more than 6 hours after creation, notifying the
 * raising manager — the scheduled-job half of auto-close. Mirrors
 * SessionSweepJob's/GeoRetentionSweepJob's exact shape (constructor-injected
 * PrismaClient + config, name/intervalMs/run()), confirming ADR-057's
 * Platform-Worker-not-BullMQ decision in code: no new job runtime is
 * introduced, this job registers on the same Scheduler those two already
 * use.
 *
 * Unlike those two sweep jobs (bulk delete, no side effects), closing a
 * JobRequest must also notify its own manager per row — the actual
 * close-and-notify transaction logic lives in
 * JobRequestService.closeExpiredBroadcasts() (job-requests/service.ts),
 * reused here rather than duplicated, so this class is a thin scheduling
 * wrapper only. No constructor-injected PrismaClient is needed (unlike
 * SessionSweepJob/GeoRetentionSweepJob, which own their query/delete logic
 * directly): jobRequestService (the module's exported singleton) already
 * resolves the shared Prisma client itself via BaseService's getPrisma(),
 * the same client every request-path caller uses.
 */
export class JobRequestAutoCloseJob implements ScheduledJob {
  readonly name = 'job-request-auto-close';
  readonly intervalMs: number;
  private readonly autoCloseAfterMs: number;
  private readonly batchSize: number;

  constructor(config: JobRequestAutoCloseJobConfig) {
    this.intervalMs = config.intervalMs;
    this.autoCloseAfterMs = config.autoCloseAfterMs;
    this.batchSize = config.batchSize;
  }

  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - this.autoCloseAfterMs);
    const closed = await jobRequestService.closeExpiredBroadcasts(cutoff, this.batchSize);
    logger.info('Job request auto-close completed', { job_requests_closed: closed });
  }
}
