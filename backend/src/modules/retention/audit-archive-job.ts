import { gzipSync, gunzipSync } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';
import type { ScheduledJob } from '../../lib/scheduler.js';
import { logger } from '../../lib/logger.js';
import { getStorageClient } from '../documents/storage.js';

export interface AuditArchiveJobConfig {
  intervalMs: number;
  /** Rows older than this are eligible. */
  archiveAfterDays: number;
  /** Rows per archived object, and per delete batch. */
  batchSize: number;
  maxBatchesPerRun?: number;
}

/**
 * ARCHIVING THE AUDIT LOG — the capacity problem `ADR-033` left open, solved
 * without destroying the record.
 *
 * `ADR-033` excludes `AuditLog` from all three retention tiers and requires it
 * **retained indefinitely**: it is the platform's own accountability record
 * (CRR §30), and deleting audit history on the same clock as the data it
 * describes would defeat its purpose. That decision is correct and is not
 * revisited here.
 *
 * The consequence was a table that only grows. `platform-table-sweep-job.ts`
 * says so in its own words -- "The capacity concern for `AuditLog` is real and
 * remains unsolved. It must be solved by something that does not destroy the
 * record: archival to cold storage, or table partitioning. Not deletion."
 * This is the first of those.
 *
 * "RETAINED INDEFINITELY" IS NOT "IN POSTGRES FOREVER". A row moved to durable
 * object storage is still retained; it is still readable; it is still the
 * record. What would violate `ADR-033` is a row that stops existing, and this
 * job is built so that cannot happen:
 *
 *   1. It REFUSES TO RUN AT ALL when storage is stubbed. With `S3_BUCKET`
 *      unset the storage client is a documented no-op whose uploads succeed
 *      and store nothing -- archiving into it and then deleting would destroy
 *      audit history while reporting success. This is the single most
 *      important line in the file.
 *   2. It VERIFIES EVERY OBJECT BY READING IT BACK and decompressing it before
 *      a single row is deleted. An upload that returned without error is not
 *      evidence that the bytes are retrievable.
 *   3. It DELETES BY EXPLICIT ID, and only the ids it just confirmed present
 *      in the archive. Deleting by the date predicate would race the read and
 *      remove rows that became eligible in between -- rows that were never
 *      archived.
 *
 * A failure at any step leaves the rows in Postgres. The safe direction is
 * always "archived twice" rather than "archived never", so the job is
 * idempotent by consequence: a re-run re-archives rows it did not manage to
 * delete, which costs storage and loses nothing.
 */
export class AuditArchiveJob implements ScheduledJob {
  readonly name = 'audit-archive';
  readonly intervalMs: number;
  private readonly archiveAfterDays: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerRun: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: AuditArchiveJobConfig
  ) {
    this.intervalMs = config.intervalMs;
    this.archiveAfterDays = config.archiveAfterDays;
    this.batchSize = config.batchSize;
    this.maxBatchesPerRun = config.maxBatchesPerRun ?? 20;
  }

  async run(): Promise<void> {
    const storage = await getStorageClient();

    // THE GUARD THAT MATTERS. The stub client's upload resolves and stores
    // nothing; archiving into it and deleting afterwards would erase audit
    // history and report success. Detected by round-tripping a probe object
    // rather than by inspecting configuration, because what matters is
    // whether bytes come back, not what the environment claims.
    const probeKey = `audit-archive/.probe/${Date.now()}`;
    const probe = Buffer.from('probe');
    let storageIsReal = false;
    try {
      await storage.upload(probeKey, probe, 'application/octet-stream');
      const readBack = await storage.download(probeKey);
      storageIsReal = readBack.equals(probe);
      await storage.delete(probeKey).catch(() => undefined);
    } catch {
      storageIsReal = false;
    }

    if (!storageIsReal) {
      logger.warn('audit_archive_skipped_no_durable_storage', {
        reason:
          'object storage did not return what was written; refusing to archive, because ' +
          'deleting rows after a no-op upload would destroy audit history (ADR-033)',
      });
      return;
    }

    const cutoff = new Date(Date.now() - this.archiveAfterDays * 24 * 60 * 60 * 1000);
    let archived = 0;
    let objects = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch += 1) {
      const rows = await this.prisma.auditLog.findMany({
        where: { timestamp: { lt: cutoff } },
        orderBy: { timestamp: 'asc' },
        take: this.batchSize,
      });
      if (rows.length === 0) break;

      const key = archiveKey(rows[0].timestamp as Date, rows[0].id);

      // Newline-delimited JSON, gzipped: streamable, greppable after
      // decompression, and appendable-by-object rather than needing the whole
      // history in one file. Dates are serialised by JSON.stringify as ISO.
      const body = gzipSync(Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n')));

      await storage.upload(key, body, 'application/gzip');

      // READ BACK BEFORE DELETING. An upload that did not throw is not
      // evidence the bytes are retrievable, and this is the last moment the
      // rows still exist in Postgres.
      const verified = await this.verify(key, rows.length, storage);
      if (!verified) {
        logger.error('audit_archive_verification_failed', {
          key,
          rows: rows.length,
          note: 'nothing deleted; rows remain in Postgres and will be retried',
        });
        return;
      }

      const { count } = await this.prisma.auditLog.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });

      archived += count;
      objects += 1;

      if (rows.length < this.batchSize) break;
    }

    if (archived > 0) {
      logger.info('audit_archive_completed', {
        rows_archived: archived,
        objects_written: objects,
        archive_after_days: this.archiveAfterDays,
        cutoff: cutoff.toISOString(),
      });
    }
  }

  /**
   * Confirms the object is readable and holds the row count that was written.
   *
   * Counts lines rather than comparing bytes: gzip output is not guaranteed
   * byte-identical across runs or library versions, so a byte comparison would
   * fail for reasons that have nothing to do with the data surviving.
   */
  private async verify(
    key: string,
    expectedRows: number,
    storage: Awaited<ReturnType<typeof getStorageClient>>
  ): Promise<boolean> {
    try {
      const stored = await storage.download(key);
      const lines = gunzipSync(stored).toString('utf8').split('\n').filter(Boolean);
      if (lines.length !== expectedRows) return false;
      // Parse one row: a truncated or corrupted object can still have the
      // right line count.
      JSON.parse(lines[lines.length - 1]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * `audit-archive/<yyyy-mm>/<iso-timestamp>-<row id>.jsonl.gz`
 *
 * Partitioned by month so a subject-access or dispute investigation can fetch
 * a bounded slice rather than the whole history, and suffixed with the first
 * row's id so two batches in the same second cannot collide.
 */
export function archiveKey(firstTimestamp: Date, firstId: string): string {
  const iso = firstTimestamp.toISOString();
  return `audit-archive/${iso.slice(0, 7)}/${iso.replace(/[:.]/g, '-')}-${firstId}.jsonl.gz`;
}
