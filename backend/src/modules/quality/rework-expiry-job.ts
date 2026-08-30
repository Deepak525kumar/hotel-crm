import type { PrismaClient } from '@prisma/client';
import { AssignmentStatus, NotificationType, OutboxSourceModule, OutboxTransport } from '@prisma/client';

import type { ScheduledJob } from '../../lib/scheduler.js';
import { logger } from '../../lib/logger.js';
import { notificationService } from '../notifications/service.js';

/**
 * Give up on rework nobody has done after three days, and say so.
 *
 * Owner decision (2026-08-30). Rework raised against a finished shift waits
 * for the worker to check in at that hotel before its clock starts -- which is
 * right, but it means a worker who never comes back (quits, long sick leave,
 * simply not scheduled there again) leaves the room waiting forever with no
 * timer and nobody told.
 *
 * After three days the round is CANCELLED and recorded as not completed. That
 * is deliberately not the same as completing it: the room was never fixed, and
 * the record has to keep saying so -- `cancelled_at` is a separate column from
 * `completed_at` for exactly that reason, and analytics that count completed
 * rework will not pick these up.
 *
 * The rework SHIFT is cancelled with it, so it stops appearing on the worker's
 * schedule as outstanding work.
 *
 * Applies to running rounds too, not only deferred ones. A round whose clock
 * started and which escalated at 20 minutes but was still never done is just
 * as stale three days later, and leaving it open forever serves nobody.
 */
export const REWORK_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

export class ReworkExpiryJob implements ScheduledJob {
  readonly name = 'rework-expiry';
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
    const cutoff = new Date(Date.now() - REWORK_EXPIRY_MS);

    // Measured from assigned_at, not timer_started_at: the three days are
    // about how long the room has been waiting, which starts when the checker
    // raised it. A deferred round has no timer at all, so measuring from the
    // clock would mean it could never expire -- the exact case this exists for.
    const stale = await this.prisma.reworkRound.findMany({
      where: {
        completed_at: null,
        cancelled_at: null,
        assigned_at: { lte: cutoff },
      },
      include: {
        verification: {
          select: {
            id: true,
            hotel_id: true,
            verified_by_id: true,
            room_number: true,
            worker_id: true,
            hotel: { select: { manager_user_id: true } },
          },
        },
      },
      orderBy: { assigned_at: 'asc' },
      take: this.batchSize,
    });

    for (const round of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Claim first, re-stating the whole predicate. The worker may have
          // completed it between the select and here -- cancelling then would
          // erase a fix that actually happened.
          const claimed = await tx.reworkRound.updateMany({
            where: { id: round.id, completed_at: null, cancelled_at: null },
            data: {
              cancelled_at: new Date(),
              cancellation_reason: 'Rework not completed for 3 days',
            },
          });
          if (claimed.count === 0) return;

          // Take the shift off the worker's schedule. Guarded on not-COMPLETED
          // so a shift the worker did finish is never rewritten.
          if (round.assignment_id) {
            await tx.workerAssignment.updateMany({
              where: { id: round.assignment_id, status: { not: AssignmentStatus.COMPLETED } },
              data: { status: AssignmentStatus.CANCELLED },
            });
          }

          const v = round.verification;

          // The checker and the manager, the same two the 20-minute escalation
          // tells. They are the people who can decide what happens to a room
          // that was never put right.
          const recipients = [v.verified_by_id, v.hotel?.manager_user_id].filter(
            (id): id is string => Boolean(id)
          );
          for (const recipientId of new Set(recipients)) {
            await notificationService.enqueue(
              {
                recipientId,
                type: NotificationType.REWORK_OVERDUE,
                title: 'Rework cancelled',
                message: `Room ${v.room_number} was not reworked within 3 days (round ${round.round_number}). It has been cancelled.`,
                data: {
                  verification_id: v.id,
                  rework_round_id: round.id,
                  round_number: round.round_number,
                  worker_id: v.worker_id,
                  reason: 'Rework not completed for 3 days',
                },
                hotelId: v.hotel_id,
                transports: [OutboxTransport.PUSH],
                sourceModule: OutboxSourceModule.QUALITY,
                producerService: 'ReworkExpiryJob',
              },
              tx
            );
          }
        });
      } catch (error) {
        // One bad round must not stop the batch: a failed transaction leaves
        // cancelled_at null, so the next tick retries it.
        logger.error('rework_expiry_failed', {
          reworkRoundId: round.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
