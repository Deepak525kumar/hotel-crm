import type { PrismaClient } from '@prisma/client';
import { NotificationType, OutboxSourceModule, OutboxTransport } from '@prisma/client';

import type { ScheduledJob } from '../../lib/scheduler.js';
import { logger } from '../../lib/logger.js';
import { notificationService } from '../notifications/service.js';

/**
 * One end-of-shift summary instead of one push per room.
 *
 * Owner decision (2026-08-30). A checker writes up to ~100 checks on a shift,
 * one per room. Under the previous policy each of those pushed the worker, so
 * a normal day meant ~100 notifications -- which is how a worker learns to
 * turn notifications off, and turning them off silently disables the rework
 * alerts that actually require them to act. So: a room marked for rework still
 * pushes immediately (unchanged, it is a request to go and do something), and
 * every passing room is held and delivered as a single digest.
 *
 * WHEN a shift is "over" is the awkward part, and the reason this is a job
 * rather than something recordInspection can do. There is no "checker has
 * finished inspecting" signal, and checks may legitimately be written after
 * the shift is already COMPLETED -- the checker often inspects once the worker
 * has left. Waiting on assignment.status would therefore either fire too early
 * (mid-inspection) or never. Instead this waits for QUIET: an assignment whose
 * most recent undigested check is older than QUIET_PERIOD_MS is treated as
 * done being inspected. If the checker resumes afterwards, the later rooms
 * simply form a second digest, which is correct -- they are a second visit as
 * far as the worker is concerned.
 *
 * Idempotence is the same design as ReworkEscalationJob: `digest_notified_at`
 * is set in the SAME transaction as the notification and is part of the claim
 * predicate, so a shift is summarized at most once and two worker processes
 * cannot both send it. A crash mid-run leaves the rows unstamped and the next
 * tick retries them.
 */
export const QUIET_PERIOD_MS = 20 * 60 * 1000;

export class InspectionDigestJob implements ScheduledJob {
  readonly name = 'inspection-digest';
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
    const cutoff = new Date(Date.now() - QUIET_PERIOD_MS);

    // Group by assignment: the digest is per shift, not per check. groupBy
    // rather than findMany + reduce so the "which shifts are ready" question
    // is answered by the database using the covering index, instead of
    // pulling every undigested row into memory to bucket them.
    const ready = await this.prisma.qualityVerification.groupBy({
      by: ['assignment_id'],
      where: {
        digest_notified_at: null,
        // Rework checks are excluded everywhere in this job. They pushed the
        // moment they were written; including them here would tell the worker
        // a second time about the one thing they had already been told.
        rework_required: false,
      },
      _max: { created_at: true },
      // Oldest first, so when more shifts are ready than one batch can hold,
      // the worker who has been waiting longest is summarized first rather
      // than being starved behind a steady stream of newer shifts. Prisma also
      // requires an orderBy whenever `take` is present on a groupBy.
      orderBy: { _max: { created_at: 'asc' } },
      take: this.batchSize,
    });

    // The quiet-period test is applied to the group's newest check, which is
    // why it is filtered here rather than in the `where` above: a shift with
    // one old check and one recent one is still being inspected, and filtering
    // rows (not groups) by created_at would summarize the old one alone and
    // then have to send a second digest moments later.
    const quiet = ready.filter((g) => {
      const newest = g._max?.created_at;
      return newest != null && newest <= cutoff;
    });

    for (const group of quiet) {
      try {
        // One timestamp per shift, captured before the write so the read-back
        // can ask for exactly the rows this claim stamped.
        const stampedAt = new Date();
        await this.prisma.$transaction(async (tx) => {
          // Claim first, and re-state the whole predicate. Between the groupBy
          // and this claim another process may have digested the shift, or the
          // checker may have written a new check -- in either case this
          // matches nothing (or a different set) and we fall through on count.
          const claimed = await tx.qualityVerification.updateMany({
            where: {
              assignment_id: group.assignment_id,
              digest_notified_at: null,
              rework_required: false,
              created_at: { lte: cutoff },
            },
            data: { digest_notified_at: stampedAt },
          });
          if (claimed.count === 0) return;

          // Read back EXACTLY the rows just claimed, identified by the stamp
          // written above.
          //
          // This previously matched `digest_notified_at: { not: null }`, which
          // also matched every row digested by an EARLIER run. On a shift the
          // checker returned to, the message then reported this visit's room
          // count against the whole shift's average: "1 room was checked.
          // Average score 88" for a room that scored 70. The count and the
          // average described different sets of rows.
          //
          // The stamp is unique per claimed set: two runs cannot claim the
          // same assignment (the loser's updateMany matches nothing once the
          // winner commits), and the assignment_id filter keeps two
          // same-millisecond stamps on DIFFERENT shifts apart.
          const rows = await tx.qualityVerification.findMany({
            where: {
              assignment_id: group.assignment_id,
              digest_notified_at: stampedAt,
              rework_required: false,
            },
            select: { score: true, worker_id: true, hotel_id: true },
          });
          const first = rows[0];
          if (!first) return;

          // claimed.count and rows.length describe the same set now, but the
          // average is derived from `rows` -- the scores it actually summed --
          // so the two numbers in the message can never disagree.
          const rooms = rows.length;
          const average = Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length);

          await notificationService.enqueue(
            {
              recipientId: first.worker_id,
              type: NotificationType.QUALITY_VERIFICATION_SUBMITTED,
              title: 'Your shift was checked',
              // Plural handled rather than "1 rooms". The message says what
              // happened and the average, not a per-room list: the detail is
              // on the shift screen, and a push is a prompt to look, not the
              // report itself.
              message:
                rooms === 1
                  ? `1 room was checked on your shift. Average score ${average} out of 100.`
                  : `${rooms} rooms were checked on your shift. Average score ${average} out of 100.`,
              data: {
                assignment_id: group.assignment_id,
                rooms_checked: rooms,
                average_score: average,
              },
              hotelId: first.hotel_id,
              transports: [OutboxTransport.PUSH],
              sourceModule: OutboxSourceModule.QUALITY,
              producerService: 'InspectionDigestJob',
            },
            tx
          );
        });
      } catch (error) {
        // One bad shift must not stop the batch: a failed transaction leaves
        // digest_notified_at null, so the next tick retries this group.
        logger.error('inspection_digest_failed', {
          assignmentId: group.assignment_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
