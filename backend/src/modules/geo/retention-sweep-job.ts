import { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';
import { RETENTION_MONTHS } from './types.js';

export interface GeoRetentionSweepJobConfig {
  intervalMs: number;
  batchSize: number;
  /** Safety bound on batches deleted per run, mirroring SessionSweepJob. */
  maxBatchesPerRun?: number;
}

/**
 * GD-14/OD-GEO-002 (SPEC-GEO-001 TREQ-GEO-005, RULE-GEO-004): hard-deletes
 * WorkerGeoCheckin rows older than exactly 6 months (GDPR Tier 1, CRR §25
 * line 333). backend-geo owns this sweep, not backend-attendance
 * (deliberately, per GD-14's OD-GEO-002 disposition).
 *
 * Deletion is batched -- select a bounded page of stale IDs, delete exactly
 * those IDs, repeat -- mirroring SessionSweepJob's identical bounded-loop
 * shape, so a large backlog cannot lock the table.
 */
export class GeoRetentionSweepJob implements ScheduledJob {
  readonly name = 'geo-retention-sweep';
  readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: GeoRetentionSweepJobConfig
  ) {
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
    this.maxBatchesPerRun = config.maxBatchesPerRun ?? 50;
  }

  async run(): Promise<void> {
    const deleted = await this.sweep();
    logger.info('Geo retention sweep completed', { checkins_deleted: deleted });
  }

  private async sweep(): Promise<number> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

    let total = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const stale = await this.prisma.workerGeoCheckin.findMany({
        where: { checked_at: { lt: cutoff } },
        select: { id: true },
        take: this.batchSize,
      });
      if (stale.length === 0) break;

      // Hard delete, not soft (TREQ-GEO-005: "deletion is hard, not soft").
      const { count } = await this.prisma.workerGeoCheckin.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      total += count;

      if (stale.length < this.batchSize) break;
    }

    return total;
  }
}
