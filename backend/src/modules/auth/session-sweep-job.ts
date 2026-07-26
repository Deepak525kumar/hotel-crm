import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';

export interface SessionSweepJobConfig {
  intervalMs: number;
  batchSize: number;
  /** Safety bound on batches deleted per run, mirroring OutboxWorker.drain(). */
  maxBatchesPerRun?: number;
}

/**
 * ADR-031 D-5 (PR-6): deletes expired `Session` rows (closes `SIR-AUTH-014`)
 * and expired/used `PasswordResetToken` rows (the second half of
 * `SIR-AUTH-018`) on the Platform Worker. Both tables are already indexed
 * on `expires_at` (schema.prisma).
 *
 * Deletion is batched — select a bounded page of stale IDs, delete exactly
 * those IDs, repeat — so a large first run (or a backlog after downtime)
 * cannot lock either table, mirroring `OutboxWorker.drain()`'s bounded-loop
 * shape. Each run logs a count via the Platform Worker's existing
 * observability surface (structured logging, ADR-029 §9's minimum metric
 * surface) rather than introducing a new metrics backend.
 *
 * Retention note (D-5, recorded not resolved): this is a deletion policy,
 * not a GDPR retention decision — `Session`/`PasswordResetToken` still need
 * a retention tier under `SIR-NOTIF-002`/GD-09 before G8.
 */
export class SessionSweepJob implements ScheduledJob {
  readonly name = 'session-sweep';
  readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: SessionSweepJobConfig
  ) {
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
    this.maxBatchesPerRun = config.maxBatchesPerRun ?? 50;
  }

  async run(): Promise<void> {
    const sessionsDeleted = await this.sweepSessions();
    const resetTokensDeleted = await this.sweepPasswordResetTokens();

    logger.info('Session sweep completed', {
      sessions_deleted: sessionsDeleted,
      password_reset_tokens_deleted: resetTokensDeleted,
    });
  }

  private async sweepSessions(): Promise<number> {
    const now = new Date();
    let total = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const stale = await this.prisma.session.findMany({
        where: { expires_at: { lt: now } },
        select: { id: true },
        take: this.batchSize,
      });
      if (stale.length === 0) break;

      const { count } = await this.prisma.session.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      total += count;

      if (stale.length < this.batchSize) break;
    }

    return total;
  }

  private async sweepPasswordResetTokens(): Promise<number> {
    const now = new Date();
    let total = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const stale = await this.prisma.passwordResetToken.findMany({
        where: { OR: [{ expires_at: { lt: now } }, { used_at: { not: null } }] },
        select: { id: true },
        take: this.batchSize,
      });
      if (stale.length === 0) break;

      const { count } = await this.prisma.passwordResetToken.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      total += count;

      if (stale.length < this.batchSize) break;
    }

    return total;
  }
}
