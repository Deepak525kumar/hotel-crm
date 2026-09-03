import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';

export interface PlatformTableSweepJobConfig {
  intervalMs: number;
  batchSize: number;
  /** Safety bound on batches deleted per table per run, mirroring SessionSweepJob. */
  maxBatchesPerRun?: number;
  notificationRetentionDays: number;
  auditLogRetentionDays: number;
}

/**
 * Age-based pruning for the two platform tables that grew without bound.
 *
 * WHY THIS EXISTS: nothing deleted from `Notification` or `AuditLog`. Both
 * are written on essentially every user action -- several notifications per
 * worker per day, and an audit row from every `logAudit()` call in every
 * module -- so at 500 daily workers they were the two fastest-growing tables
 * in the database, with no ceiling. `OutboxEvent` already had its own
 * `deleteMany` path (outbox-repository.ts) and `Session`/`PasswordResetToken`
 * have SessionSweepJob; these two had nothing.
 *
 * WHAT THIS IS NOT: this is deliberately NOT the deferred cross-module
 * delegation mechanism (`OD-RETENTION-10`), and does not depend on it. That
 * open decision is about the central sweep being *authorized* to delete
 * another module's business records through a registered mechanism -- a real
 * architecture question that is still open, and which `SPEC-RETENTION-001`
 * (@0.2.0, REVIEW, not FROZEN) cannot be implemented against.
 *
 * This job sidesteps it entirely by following the precedent already set by
 * `auth/session-sweep-job.ts` and `geo/retention-sweep-job.ts`: a fixed,
 * code-declared policy over specific named tables, with no registration
 * mechanism, no dynamic dispatch, and no authorization surface. Adding a
 * table here is a code change and a code review, not a runtime grant.
 *
 * WHY BOTH TABLES IN ONE JOB: `Notification` is owned by the notifications
 * module, but `AuditLog` has no owning business module at all -- it is
 * written from `BaseService.logAudit()` by every module. Splitting them
 * would double the config surface and the scheduler registrations for no
 * behavioural difference, since they share an identical policy shape
 * (age out by a single timestamp column) and interval. Retention is the
 * module that owns data-lifecycle policy, so it hosts both.
 *
 * RETENTION WINDOWS are configurable and deliberately different:
 *   - notifications: short. They are a UI convenience; once read (or long
 *     unread) they have no evidential value.
 *   - audit log: much longer. This is the evidential trail for employment
 *     and payroll-adjacent actions, so it outlives operational data. It is
 *     still bounded -- an unbounded audit table is an availability risk, not
 *     a compliance win.
 *
 * Both sweeps are batched -- select a bounded page of ids, delete exactly
 * those ids, repeat -- so a large first run over a table that has never been
 * pruned cannot lock it. Both target columns are already indexed
 * (`Notification.created_at`, `AuditLog.timestamp`), so the selects are
 * index scans rather than sequential ones.
 */
export class PlatformTableSweepJob implements ScheduledJob {
  readonly name = 'platform-table-sweep';
  readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;
  private readonly notificationRetentionDays: number;
  private readonly auditLogRetentionDays: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: PlatformTableSweepJobConfig
  ) {
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
    this.maxBatchesPerRun = config.maxBatchesPerRun ?? 50;
    this.notificationRetentionDays = config.notificationRetentionDays;
    this.auditLogRetentionDays = config.auditLogRetentionDays;
  }

  async run(): Promise<void> {
    const notificationsDeleted = await this.sweepNotifications();
    const auditLogsDeleted = await this.sweepAuditLogs();

    logger.info('platform_table_sweep_completed', {
      notifications_deleted: notificationsDeleted,
      audit_logs_deleted: auditLogsDeleted,
      notification_retention_days: this.notificationRetentionDays,
      audit_log_retention_days: this.auditLogRetentionDays,
    });
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private async sweepNotifications(): Promise<number> {
    const cutoff = this.cutoff(this.notificationRetentionDays);
    let total = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const stale = await this.prisma.notification.findMany({
        where: { created_at: { lt: cutoff } },
        select: { id: true },
        take: this.batchSize,
      });
      if (stale.length === 0) break;

      const { count } = await this.prisma.notification.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      total += count;

      if (stale.length < this.batchSize) break;
    }

    return total;
  }

  private async sweepAuditLogs(): Promise<number> {
    const cutoff = this.cutoff(this.auditLogRetentionDays);
    let total = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const stale = await this.prisma.auditLog.findMany({
        where: { timestamp: { lt: cutoff } },
        select: { id: true },
        take: this.batchSize,
      });
      if (stale.length === 0) break;

      const { count } = await this.prisma.auditLog.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      total += count;

      if (stale.length < this.batchSize) break;
    }

    return total;
  }
}
