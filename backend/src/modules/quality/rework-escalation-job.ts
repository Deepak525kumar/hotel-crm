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

    // Scoped to ROUNDS since 2026-08-30, not to the verification's flat
    // fields. A room can now be sent back more than once, and the old query
    // could not express "round 1 escalated, round 2 has not" -- it matched on
    // `rework_assignments: { some: { confirmed_at: { lte: cutoff } } }`, and
    // round 1's long-finished shift satisfies `some` forever. Opening round 2
    // would therefore have escalated it to the manager and checker
    // immediately, before the worker could possibly have started. A false
    // 20-minute alarm is exactly what teaches people to ignore the real ones.
    //
    // Each round carries its own assigned_at and its own escalated_at, so the
    // clock is per attempt, which is what CRR §14 actually describes.
    const overdue = await this.prisma.reworkRound.findMany({
      where: {
        completed_at: null,
        escalated_at: null,
        // Cancelled rounds are closed. Escalating one would chase work that
        // has already been written off.
        cancelled_at: null,
        // Measured from when the clock STARTED, not when the round was
        // assigned (owner decision, 2026-08-30). A round raised against a
        // finished shift has timer_started_at NULL and is skipped entirely --
        // `{ lte: cutoff }` never matches NULL, so a deferred round cannot
        // escalate. It becomes eligible the moment the worker checks in at
        // that hotel and the clock is set.
        timer_started_at: { lte: cutoff },
      },
      include: {
        verification: {
          select: {
            id: true,
            hotel_id: true,
            verified_by_id: true,
            room_number: true,
            assignment: { select: { worker_id: true } },
            hotel: { select: { manager_user_id: true } },
          },
        },
      },
      orderBy: { timer_started_at: 'asc' },
      take: this.batchSize,
    });

    for (const round of overdue) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Claim the round first. A concurrent worker process that already
          // escalated it will have moved escalated_at, so this update matches
          // nothing and we skip -- rather than double-notifying.
          const claimed = await tx.reworkRound.updateMany({
            // `completed_at: null` is re-checked HERE, not just in the
            // findMany above, and that is the whole point of re-stating it.
            // The select and this claim are separated by the batch loop -- up
            // to `batchSize` rounds, one transaction each -- so a worker can
            // finish their rework in between. Claiming on escalated_at alone
            // would then succeed and tell the manager and checker that work is
            // overdue seconds after it was actually completed.
            where: { id: round.id, escalated_at: null, completed_at: null, cancelled_at: null },
            data: { escalated_at: new Date() },
          });
          if (claimed.count === 0) return;

          const v = round.verification;

          // Mirrored onto the verification so anything still reading the flat
          // field agrees with the round that actually escalated.
          await tx.qualityVerification.updateMany({
            where: { id: v.id, rework_escalated_at: null },
            data: { rework_escalated_at: new Date() },
          });

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
                message: `Rework was not completed within 20 minutes (room ${v.room_number}, round ${round.round_number}).`,
                data: {
                  verification_id: v.id,
                  rework_round_id: round.id,
                  round_number: round.round_number,
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
          reworkRoundId: round.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
