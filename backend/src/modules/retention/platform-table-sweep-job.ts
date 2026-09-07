import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';

export interface PlatformTableSweepJobConfig {
  intervalMs: number;
  batchSize: number;
  /** Safety bound on batches deleted per table per run, mirroring SessionSweepJob. */
  maxBatchesPerRun?: number;
  notificationRetentionDays: number;
  /** WorkerAssignment and everything cascading from it. Ten years by policy. */
  operationalRetentionDays: number;
}

/**
 * Age-based pruning for `Notification`, on the retention tier `ADR-033`
 * assigns it.
 *
 * WHY THIS EXISTS: nothing deleted from `Notification`. It is written on
 * essentially every user action -- several per worker per day -- so at 500
 * daily workers it grows continuously with no ceiling.
 *
 * RETENTION IS SET BY POLICY, NOT BY CAPACITY. `ADR-033` (ratified
 * 2026-07-28) assigns `Notification` to **Tier 2, the 5-year general
 * personal/profile tier** of CRR §25's framework. The window below is that
 * decision expressed in days; it is not a number chosen to keep the table
 * small, and it must not be shortened for that reason.
 *
 * `AuditLog` IS DELIBERATELY NOT SWEPT HERE, and this file previously got
 * that wrong. It pruned `AuditLog` at 365 days, which directly contradicted
 * `ADR-033`: the audit log is "explicitly excluded from all three tiers and
 * retained indefinitely -- it is the platform's own accountability record
 * (CRR §30's 'every important action is logged' mandate), and deleting audit
 * history on the same clock as the data it describes would defeat its
 * purpose." Notification was likewise pruned at 90 days against a 5-year
 * tier. Both were introduced by treating unbounded growth as a defect to fix
 * without first checking whether a retention policy already existed. It did.
 *
 * No production data was lost -- the oldest row in either table was ~25 days
 * old when this was caught, so nothing had yet become eligible -- but
 * notifications would have begun being deleted around 2026-11-09.
 *
 * The capacity concern for `AuditLog` is real and remains unsolved. It must
 * be solved by something that does not destroy the record: archival to cold
 * storage, or table partitioning. Not deletion.
 *
 * Batched -- select a bounded page of ids, delete exactly those ids, repeat --
 * so a large first run cannot lock the table. `Notification.created_at` is
 * indexed, so the select is an index scan rather than a sequential one.
 */
export class PlatformTableSweepJob implements ScheduledJob {
  readonly name = 'platform-table-sweep';
  readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;
  private readonly notificationRetentionDays: number;
  private readonly operationalRetentionDays: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: PlatformTableSweepJobConfig
  ) {
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
    this.maxBatchesPerRun = config.maxBatchesPerRun ?? 50;
    this.notificationRetentionDays = config.notificationRetentionDays;
    this.operationalRetentionDays = config.operationalRetentionDays;
  }

  async run(): Promise<void> {
    const notificationsDeleted = await this.sweepNotifications();
    const assignmentsDeleted = await this.sweepOperationalRecords();

    logger.info('platform_table_sweep_completed', {
      notifications_deleted: notificationsDeleted,
      notification_retention_days: this.notificationRetentionDays,
      assignments_deleted: assignmentsDeleted,
      operational_retention_days: this.operationalRetentionDays,
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

  /**
   * Operational payroll evidence: `WorkerAssignment` and everything that
   * cascades from it.
   *
   * SWEEPING THE PARENT IS THE ONLY COHERENT DESIGN HERE, and that is a
   * schema fact rather than a preference. `Attendance`, `RoomLog` and
   * `QualityVerification` are all `onDelete: Cascade` on `assignment_id`, so
   * a shift's attendance cannot outlive the shift. Giving those tables
   * shorter windows of their own would be a policy the database cannot
   * express: the cascade would delete them early anyway, on the parent's
   * clock. One window, applied at the parent, is what is actually enforceable.
   *
   * TEN YEARS, per the owner decision of 2026-09-08. These rows are what a
   * wage dispute or a tax audit is settled from, and German commercial and
   * tax law commonly requires ten years for payroll-relevant records.
   * `OD-RETENTION-01` (tax-advisor sign-off) is still open; ten years is the
   * conservative side of that question, because keeping records too long is a
   * storage-limitation finding while deleting them too early is an
   * unanswerable audit.
   *
   * Filtered on `day`, the shift's own calendar date, not `created_at`: a row
   * entered late still describes the day it describes, and retention is about
   * the event, not the paperwork.
   */
  private async sweepOperationalRecords(): Promise<number> {
    const cutoff = this.cutoff(this.operationalRetentionDays);
    let total = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const stale = await this.prisma.workerAssignment.findMany({
        where: { day: { lt: cutoff } },
        select: { id: true },
        take: this.batchSize,
      });
      if (stale.length === 0) break;

      const { count } = await this.prisma.workerAssignment.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      total += count;

      if (stale.length < this.batchSize) break;
    }

    return total;
  }
}
