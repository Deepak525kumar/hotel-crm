import { PrismaClient, RetentionTier } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { ScheduledJob } from '../../lib/scheduler.js';
import { RETENTION_TIER_WINDOWS } from './types.js';

export interface RetentionSweepJobConfig {
  intervalMs: number;
  batchSize: number;
  /** Safety bound on batches deleted per category per run, mirroring SessionSweepJob/GeoRetentionSweepJob. */
  maxBatchesPerRun?: number;
}

// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN). PR 3 of 5: the daily sweep
// (REQ-RETENTION-016/017/018, RULE-RETENTION-04/05/06) against RetentionLog
// rows this module already owns -- the tagged-record eligibility/deletion
// half of the lifecycle. Mirrors SessionSweepJob/GeoRetentionSweepJob's
// exact batched-delete-loop shape and worker.ts registration convention.
//
// Scope boundary (human decision): Ownership and Boundaries' "Permitted
// writes" clause already contemplates the sweep deleting from a consuming
// module's own data store -- "a delegated execution permission, explicitly
// granted by the act of registration (RULE-RETENTION-02), not a general
// write permission into another module's domain state." What remains
// genuinely open is narrower: OD-RETENTION-10, "this module's own internal
// authorization to call into each consuming module's delete mechanism," is
// unspecified -- no interface exists anywhere for a consuming module to
// register HOW to delete its own records (no callback, no delegate, no
// table reference), so there is no mechanism for this job to invoke even
// though the spec already permits the intent. This job therefore sweeps
// only RETENTION'S OWN state: it hard-deletes RetentionLog rows once
// eligible (RULE-RETENTION-05) and writes the corresponding
// RetentionAuditEntry (RULE-RETENTION-06). It does NOT reach into any
// other module's data store -- the cross-module delegated-execution
// mechanism itself remains OD-RETENTION-10's own reserved human/
// architecture decision, deferred to a future PR once that decision lands.
// No consuming module has registered a real category yet (PR 1/2), so
// there is nothing live this scope boundary defers today.
//
// Per-category cutoff (not one fixed window, unlike SessionSweepJob/
// GeoRetentionSweepJob): each RetentionLog row's eligibility depends on
// its RetentionCategory's own tier (RETENTION_TIER_WINDOWS), so the sweep
// iterates registered categories and computes each one's own cutoff,
// rather than a single platform-wide cutoff.
export class RetentionSweepJob implements ScheduledJob {
  readonly name = 'retention-sweep';
  readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: RetentionSweepJobConfig
  ) {
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
    this.maxBatchesPerRun = config.maxBatchesPerRun ?? 50;
  }

  async run(): Promise<void> {
    // OD-RETENTION-11: per-category, not a full-table rescan -- each
    // category is swept via its own bounded query against RetentionLog's
    // category_id and tagged_at indexes (two single-column @@index entries
    // from PR 1, not one composite index), never a scan across all
    // categories' rows at once.
    const categories = await this.prisma.retentionCategory.findMany({
      select: { id: true, module_id: true, category_id: true, tier: true },
    });

    let totalDeleted = 0;
    for (const category of categories) {
      totalDeleted += await this.sweepCategory(category);
    }

    logger.info('retention_sweep_completed', {
      categories_swept: categories.length,
      records_deleted: totalDeleted,
    });
  }

  private async sweepCategory(category: {
    id: string;
    module_id: string;
    category_id: string;
    tier: RetentionTier;
  }): Promise<number> {
    const cutoff = computeCutoff(category.tier, new Date());
    let total = 0;

    // RetentionLog.deleted_at (PR 1) is used only as a query-filter guard
    // below (deleted_at: null) -- this sweep hard-deletes the row itself
    // rather than ever setting deleted_at, so it never actually transitions
    // through a deleted_at-marked-but-present state. The filter is
    // belt-and-suspenders defense against a hypothetical future write path
    // that marks a row deleted without removing it, not a state this sweep
    // itself produces.
    //
    // OD-RETENTION-07 (concurrency, open): batches are bounded (findMany
    // .take(batchSize) then deleteMany on exactly those ids) so a large
    // backlog cannot lock RetentionLog, mirroring SessionSweepJob/
    // GeoRetentionSweepJob's identical bounded-loop shape. Overlapping-run
    // safety beyond this bounded-batch pattern remains OD-RETENTION-07's
    // own open item.
    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const eligible = await this.prisma.retentionLog.findMany({
        where: { category_id: category.id, deleted_at: null, tagged_at: { lt: cutoff } },
        select: { id: true },
        take: this.batchSize,
      });
      if (eligible.length === 0) break;

      const deletedAt = new Date();
      const ids = eligible.map((row) => row.id);

      // RULE-RETENTION-05: hard delete, not a soft-delete flag -- the row
      // is removed, not marked. RULE-RETENTION-06: every deletion produces
      // an immutable audit entry (category/tier/timestamp only, never the
      // deleted record's own data -- RetentionLog never held personal data
      // itself, only an opaque record_ref, so there is nothing to omit).
      // Both writes happen in one transaction so a deletion is never
      // recorded without its audit entry, matching this repository's own
      // transactional-write convention (e.g. HrService.fulfilPayslipRequest).
      await this.prisma.$transaction(async (tx) => {
        await tx.retentionLog.deleteMany({ where: { id: { in: ids } } });
        await tx.retentionAuditEntry.createMany({
          data: ids.map(() => ({
            module_id: category.module_id,
            category_id: category.category_id,
            tier: category.tier,
            deleted_at: deletedAt,
          })),
        });
      });

      total += ids.length;
      if (eligible.length < this.batchSize) break;
    }

    return total;
  }
}

// RULE-RETENTION-01/REQ-RETENTION-013: calendar-unit windows (months/years),
// computed via Date's own setMonth()/setFullYear() -- not a fixed-duration
// subtraction -- mirroring GeoRetentionSweepJob's identical setMonth()-based
// cutoff arithmetic (its own review fix pinned this exact boundary
// behavior; retention-sweep-job.test.ts mirrors that same pinning test).
function computeCutoff(tier: RetentionTier, now: Date): Date {
  const window = RETENTION_TIER_WINDOWS[tier];
  const cutoff = new Date(now);
  if (window.unit === 'months') {
    cutoff.setMonth(cutoff.getMonth() - window.amount);
  } else {
    cutoff.setFullYear(cutoff.getFullYear() - window.amount);
  }
  return cutoff;
}
