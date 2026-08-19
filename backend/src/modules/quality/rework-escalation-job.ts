import type { PrismaClient } from '@prisma/client';
import { NotificationType, OutboxSourceModule, OutboxTransport } from '@prisma/client';

import type { ScheduledJob } from '../../lib/scheduler.js';
import { logger } from '../../lib/logger.js';
import { notificationService } from '../notifications/service.js';

/**
 * CRR §14: "If the rework is NOT completed within 20 minutes, notify BOTH the
 * Manager and the Checker (auto-escalation)."
 *
 * Finds rework that was assigned more than the deadline ago and is still not
 * completed, and notifies both parties once.
 *
 * Idempotence is the whole design problem here. The scheduler re-runs on every
 * tick, so without a marker this would re-notify on every pass for as long as
 * the rework stayed open -- CRR §14 asks for an escalation, not a siren. The
 * marker is `rework_escalated_at`: set in the same transaction as the
 * notifications, and part of the query predicate, so a row can escalate at
 * most once and a crash mid-run simply retries it.
 */
export const REWORK_DEADLINE_MS = 20 * 60 * 1000;

export class ReworkEscalationJob implements ScheduledJob {
  readonly name = 'rework-escalation';
  readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaClient,
    opts: { intervalMs: number; batchSize?: number }
  ) {
    this.intervalMs = opts.intervalMs;
    this.batchSize = opts.batchSize ?? 50;
  }

  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - REWORK_DEADLINE_MS);

    const overdue = await this.prisma.qualityVerification.findMany({
      where: {
        rework_required: true,
        rework_completed_at: null,
        rework_escalated_at: null,
        // Measured from when the rework assignment was created, which is when
        // the worker was actually told -- not from the inspection, which may
        // have happened earlier. WorkerAssignment has no created_at; its
        // confirmed_at defaults to now() at insert, so it is the creation
        // timestamp for a row this job created.
        rework_assignments: { some: { confirmed_at: { lte: cutoff } } },
      },
      include: {
        assignment: { select: { worker_id: true, hotel_id: true } },
        hotel: { select: { manager_user_id: true } },
      },
      take: this.batchSize,
    });

    for (const v of overdue) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Claim the row first. A concurrent worker process that already
          // escalated it will have moved rework_escalated_at, so this update
          // matches nothing and we skip -- rather than double-notifying.
          const claimed = await tx.qualityVerification.updateMany({
            // `rework_completed_at: null` is re-checked HERE, not just in the
            // findMany above, and that is the whole point of re-stating it.
            // The select and this claim are separated by the batch loop -- up
            // to `batchSize` rows, one transaction each -- so a worker can
            // finish their rework in between. Claiming on
            // rework_escalated_at alone would then succeed and notify the
            // manager AND checker that work is overdue seconds after it was
            // actually completed. A false 20-minute alarm is exactly the kind
            // of thing that teaches people to ignore the real ones.
            where: { id: v.id, rework_escalated_at: null, rework_completed_at: null },
            data: { rework_escalated_at: new Date() },
          });
          if (claimed.count === 0) return;

          // CRR §14 says BOTH, explicitly. The manager may be unset on a hotel
          // with no assigned manager; the checker always exists (they are the
          // verifier). Missing recipients are skipped, not fatal -- an
          // escalation that cannot reach one party must still reach the other.
          const recipients = [v.verified_by_id, v.hotel?.manager_user_id].filter(
            (id): id is string => Boolean(id)
          );

          for (const recipientId of new Set(recipients)) {
            await notificationService.enqueue(
              {
                recipientId,
                type: NotificationType.REWORK_OVERDUE,
                title: 'Rework overdue',
                message: 'Rework was not completed within 20 minutes.',
                data: {
                  verification_id: v.id,
                  worker_id: v.assignment?.worker_id ?? null,
                },
                hotelId: v.hotel_id,
                transports: [OutboxTransport.PUSH],
                sourceModule: OutboxSourceModule.QUALITY,
                producerService: 'ReworkEscalationJob',
              },
              tx
            );
          }
        });
      } catch (error) {
        // One bad row must not stop the batch: the next tick retries it,
        // because a failed transaction leaves rework_escalated_at null.
        logger.error('rework_escalation_failed', {
          verificationId: v.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
