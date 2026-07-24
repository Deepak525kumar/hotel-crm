import { OutboxEvent, OutboxStatus, OutboxTransport, Prisma, PrismaClient } from '@prisma/client';
import { computeBackoff } from './outbox-backoff.js';

/**
 * Data access for the Platform Worker's OutboxEvent processing (ADR-029 §7).
 * Owns the atomic claim (SELECT ... FOR UPDATE SKIP LOCKED) and the terminal /
 * retry status transitions. Kept separate from NotificationService (the
 * request-path enqueue writer) so the worker's read/transition concern is
 * isolated from the producer's write concern, though both act on the same
 * backend-notifications-owned state-outbox.
 */
export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Atomically claim up to `batchSize` due rows and mark them PROCESSING.
   *
   * Due = a row whose transport has a registered handler AND is either
   *  - PENDING or FAILED with next_attempt_at in the past (ready for its next
   *    attempt), or
   *  - PROCESSING but abandoned — updated_at older than the visibility timeout,
   *    i.e. a worker crashed mid-delivery (reclaimed to preserve at-least-once;
   *    handlers are idempotent, ADR-029 §7).
   *
   * FOR UPDATE SKIP LOCKED lets concurrent Platform Worker instances claim
   * disjoint row sets without blocking each other (ADR-029 §7). The whole
   * select-then-mark runs in one transaction so a claimed row is PROCESSING
   * before its lock is released.
   */
  async claimBatch(params: {
    registeredTransports: OutboxTransport[];
    batchSize: number;
    processingTimeoutMs: number;
    now?: Date;
  }): Promise<OutboxEvent[]> {
    const { registeredTransports, batchSize, processingTimeoutMs } = params;
    if (registeredTransports.length === 0) return [];

    const now = params.now ?? new Date();
    const staleBefore = new Date(now.getTime() - processingTimeoutMs);
    const transports = registeredTransports.map((t) => t.toString());

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "OutboxEvent"
        WHERE "transport" = ANY(${transports}::"OutboxTransport"[])
          AND (
            ("status" IN ('PENDING', 'FAILED') AND "next_attempt_at" <= ${now})
            OR ("status" = 'PROCESSING' AND "updated_at" < ${staleBefore})
          )
        ORDER BY "next_attempt_at" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return [];

      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { status: OutboxStatus.PROCESSING },
      });

      // Preserve claim (next_attempt_at ASC) order for deterministic processing.
      const claimed = await tx.outboxEvent.findMany({ where: { id: { in: ids } } });
      const byId = new Map(claimed.map((row) => [row.id, row]));
      return ids.map((id) => byId.get(id)).filter((row): row is OutboxEvent => row !== undefined);
    });
  }

  /** Terminal success. Guarded on PROCESSING so a reaper/other worker can't double-transition. */
  async markDelivered(id: string, now: Date = new Date()): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id, status: OutboxStatus.PROCESSING },
      data: { status: OutboxStatus.DELIVERED, processed_at: now, last_error: null },
    });
  }

  /**
   * Record a failed delivery attempt: either schedule the next retry (FAILED
   * with next_attempt_at advanced by the backoff schedule) or dead-letter the
   * row when the schedule is exhausted (ADR-029 §5/§6).
   */
  async recordFailure(params: {
    row: OutboxEvent;
    scheduleMs: readonly number[];
    error: string;
    now?: Date;
  }): Promise<OutboxStatus> {
    const { row, scheduleMs, error } = params;
    const now = params.now ?? new Date();
    const attempts = row.attempts + 1;
    const outcome = computeBackoff(attempts, scheduleMs, now);

    if (outcome.deadLetter) {
      await this.prisma.outboxEvent.updateMany({
        where: { id: row.id, status: OutboxStatus.PROCESSING },
        data: {
          status: OutboxStatus.DEAD_LETTER,
          attempts,
          last_error: error,
          processed_at: now,
        },
      });
      return OutboxStatus.DEAD_LETTER;
    }

    await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, status: OutboxStatus.PROCESSING },
      data: {
        status: OutboxStatus.FAILED,
        attempts,
        next_attempt_at: outcome.nextAttemptAt,
        last_error: error,
      },
    });
    return OutboxStatus.FAILED;
  }
}
