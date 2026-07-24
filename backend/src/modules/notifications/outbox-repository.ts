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

  // ---------------------------------------------------------------------------
  // Observability + dead-letter operability (Epic 7 PR 7.6, ADR-029 §9).
  //
  // ADR-029 §9 requires a *minimum derivable* metric surface, not a specific
  // metrics backend: counts by status, retry_count per event (the `attempts`
  // column, surfaced on each dead-letter row), and delivery_latency
  // (processed_at - created_at) for delivered events. These reads are the
  // canonical derivation of that surface from state-outbox.
  // ---------------------------------------------------------------------------

  /** Row counts per OutboxStatus. Every status is present, zero-filled. */
  async getStatusCounts(): Promise<Record<OutboxStatus, number>> {
    const grouped = await this.prisma.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const counts = Object.fromEntries(
      Object.values(OutboxStatus).map((status) => [status, 0])
    ) as Record<OutboxStatus, number>;
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return counts;
  }

  /**
   * Backlog depth and the age of the oldest event still awaiting a terminal
   * outcome (PENDING/PROCESSING/FAILED). This is the health signal a status
   * histogram alone cannot give: a steady `pending` count looks identical
   * whether the queue is flowing or wedged, but a growing oldest-age does not.
   */
  async getBacklog(now: Date = new Date()): Promise<{ backlogCount: number; oldestPendingAgeMs: number | null }> {
    const result = await this.prisma.outboxEvent.aggregate({
      where: {
        status: { in: [OutboxStatus.PENDING, OutboxStatus.PROCESSING, OutboxStatus.FAILED] },
      },
      _count: { _all: true },
      _min: { created_at: true },
    });

    const oldest = result._min.created_at;
    return {
      backlogCount: result._count._all,
      oldestPendingAgeMs: oldest ? now.getTime() - oldest.getTime() : null,
    };
  }

  /**
   * Average delivery latency (processed_at - created_at) over DELIVERED rows.
   * Raw SQL because the interval arithmetic has no Prisma aggregate equivalent;
   * averaging in the database avoids loading every delivered row to compute it.
   */
  async getDeliveryLatency(): Promise<{ averageMs: number | null; sampleSize: number }> {
    const rows = await this.prisma.$queryRaw<{ avg_ms: number | null; sample_size: bigint }[]>(Prisma.sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM ("processed_at" - "created_at")) * 1000)::float8 AS avg_ms,
        COUNT(*) AS sample_size
      FROM "OutboxEvent"
      WHERE "status" = 'DELIVERED' AND "processed_at" IS NOT NULL
    `);

    const row = rows[0];
    if (!row) return { averageMs: null, sampleSize: 0 };
    return { averageMs: row.avg_ms ?? null, sampleSize: Number(row.sample_size) };
  }

  /** Dead-lettered rows, newest terminal transition first, for operator triage. */
  async listDeadLetters(params: { skip: number; take: number }): Promise<{ rows: OutboxEvent[]; total: number }> {
    const where = { status: OutboxStatus.DEAD_LETTER };
    const [rows, total] = await Promise.all([
      this.prisma.outboxEvent.findMany({
        where,
        orderBy: { processed_at: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.outboxEvent.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Operator requeue: DEAD_LETTER → PENDING, due immediately.
   *
   * `attempts` and `last_error` are deliberately preserved rather than reset —
   * they are the event's failure history, and losing them would erase why an
   * operator intervened in the first place. A requeued row therefore re-enters
   * the backoff schedule at its existing attempt count, so an event whose
   * schedule is already exhausted dead-letters again after its next failure
   * rather than looping forever.
   *
   * Returns the pre-requeue snapshot (for the caller's audit record), or null
   * if the row is absent or no longer DEAD_LETTER (lost a concurrent race).
   */
  async requeue(id: string, now: Date = new Date()): Promise<OutboxEvent | null> {
    const row = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!row || row.status !== OutboxStatus.DEAD_LETTER) return null;

    const { count } = await this.prisma.outboxEvent.updateMany({
      where: { id, status: OutboxStatus.DEAD_LETTER },
      data: { status: OutboxStatus.PENDING, next_attempt_at: now, processed_at: null },
    });
    return count === 1 ? row : null;
  }

  /**
   * Operator discard: permanently drop a dead-lettered event the operator has
   * judged undeliverable. The row is deleted; the caller's AuditLog entry is
   * the durable record of what was dropped and by whom, which is why this
   * returns the pre-delete snapshot.
   *
   * Returns null if the row is absent or no longer DEAD_LETTER — only a
   * terminal row may be discarded, never one still in flight.
   */
  async discard(id: string): Promise<OutboxEvent | null> {
    const row = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!row || row.status !== OutboxStatus.DEAD_LETTER) return null;

    const { count } = await this.prisma.outboxEvent.deleteMany({
      where: { id, status: OutboxStatus.DEAD_LETTER },
    });
    return count === 1 ? row : null;
  }
}
