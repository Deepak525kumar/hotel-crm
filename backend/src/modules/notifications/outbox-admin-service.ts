import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { NotFoundError } from '../../lib/errors.js';
import { OutboxRepository } from './outbox-repository.js';

export interface OutboxActor {
  userId: string;
  role: string;
}

export interface OutboxMetrics {
  counts: Record<OutboxStatus, number>;
  backlog_count: number;
  oldest_pending_age_ms: number | null;
  delivery_latency_ms: { average: number | null; sample_size: number };
}

/**
 * Operator-facing surface over state-outbox (Epic 7 PR 7.6, ADR-029 §9):
 * the ADR's minimum metric surface, dead-letter triage, and the two operator
 * interventions (requeue, discard).
 *
 * Separate from NotificationService (the request-path enqueue writer) and from
 * the Platform Worker's own use of OutboxRepository — this is the human
 * operator's entry point, and it is the only one of the three that writes
 * AuditLog.
 *
 * Audit policy (deliberate): a DEAD_LETTER transition is NOT audited. It is
 * operational state the OutboxEvent row already captures in full (status,
 * attempts, last_error, processed_at), and auditing it would duplicate that
 * record on every exhausted retry schedule. What is audited is the *operator
 * action* — a human deciding to requeue or discard an event — because that
 * decision exists nowhere else once taken, and in the discard case the row it
 * describes is gone.
 */
export class OutboxAdminService extends BaseService {
  private readonly repository = new OutboxRepository(this.prisma);

  /** ADR-029 §9 minimum metric surface, derived from state-outbox. */
  async getMetrics(): Promise<OutboxMetrics> {
    const [counts, backlog, latency] = await Promise.all([
      this.repository.getStatusCounts(),
      this.repository.getBacklog(),
      this.repository.getDeliveryLatency(),
    ]);

    return {
      counts,
      backlog_count: backlog.backlogCount,
      oldest_pending_age_ms: backlog.oldestPendingAgeMs,
      delivery_latency_ms: { average: latency.averageMs, sample_size: latency.sampleSize },
    };
  }

  async listDeadLetters(params: { page: number; per_page: number }) {
    const { rows, total } = await this.repository.listDeadLetters({
      skip: (params.page - 1) * params.per_page,
      take: params.per_page,
    });
    return { data: rows, total };
  }

  /**
   * Requeue a dead-lettered event for another delivery attempt. `attempts` and
   * `last_error` are preserved by the repository (see its own note); only the
   * status and retry clock move.
   */
  async requeue(id: string, actor: OutboxActor, ip?: string): Promise<OutboxEvent> {
    const row = await this.repository.requeue(id);
    if (!row) throw new NotFoundError('No dead-lettered outbox event with that id');

    await this.auditOperatorAction('outbox.requeue', row, actor, ip);
    return row;
  }

  /** Permanently drop a dead-lettered event. The AuditLog row is its only remaining record. */
  async discard(id: string, actor: OutboxActor, ip?: string): Promise<OutboxEvent> {
    const row = await this.repository.discard(id);
    if (!row) throw new NotFoundError('No dead-lettered outbox event with that id');

    await this.auditOperatorAction('outbox.discard', row, actor, ip);
    return row;
  }

  /**
   * One audit row per operator intervention. `resource_id` is the event_id
   * (ADR-029 §7's canonical event identity) rather than the table row id, so
   * the trail stays meaningful after a discard deletes the row.
   */
  private async auditOperatorAction(
    action: 'outbox.requeue' | 'outbox.discard',
    row: OutboxEvent,
    actor: OutboxActor,
    ip?: string
  ): Promise<void> {
    await this.logAudit(
      actor.userId,
      actor.role,
      action,
      'OUTBOX_EVENT',
      row.event_id,
      {
        outbox_row_id: row.id,
        correlation_id: row.correlation_id,
        event_type: row.event_type,
        transport: row.transport,
        source_module: row.source_module,
        attempts: row.attempts,
        last_error: row.last_error,
      },
      ip
    );
  }
}

export const outboxAdminService = new OutboxAdminService();
