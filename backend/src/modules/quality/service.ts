import {
  AssignmentStatus,
  AttendanceStatus,
  EmploymentStatus,
  OutboxSourceModule,
  OutboxTransport,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import type { DatabaseTransaction } from '../../lib/db.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { deriveRatingTier } from './rating-tiers.js';
import {
  RECENCY_WINDOW,
  blendRecencyWeightedScore,
} from './recency-weighting.js';
import { attendanceScore, blendQualityAndAttendance } from './overall-rating.js';
import { notificationService } from '../notifications/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
// From lib/scope.js, not the middleware re-export — see geo/service.ts's note:
// pure predicates, so suites mocking the permissions middleware need not stub them.
import { isScopedManagerRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import type {
  AssignReworkRequest,
  RecordInspectionRequest,
  CreateQualityVerificationRequest,
  UploadedPhoto,
} from './types.js';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTOS_PER_VERIFICATION,
  MAX_PHOTO_BYTES,
} from './types.js';
import { generateQualityPhotoKey, getStorageClient } from '../documents/storage.js';
import { ACTIVE_ASSIGNMENT_STATUSES } from '../assignments/service.js';
import { ABSENCE_CANCEL_REASON_SELF } from '../../config/constants.js';
import { todayInCalendarTimezone } from '../../lib/utils.js';

interface Actor {
  userId: string;
  role: string;
  scope?: UserScope | null;
}

type RatingAggregateTx = Prisma.TransactionClient;

// GD-04 single-writer fix: this is the only writer of WorkerOverallRating (a
// DB trigger used to also write it; dropped in
// 20260727020000_drop_rating_overall_trigger). Every call site that mutates a
// Rating row or a WorkerAssignment's status/completed_at must call this
// inside the same transaction, or the aggregate silently goes stale — see
// assignments/service.ts's call from AssignmentService.update().
/**
 * One shape for a check wherever it is listed.
 *
 * Three surfaces read checks -- the checker's history, the worker's shift
 * screen, and the rework detail both of them open -- and they must agree.
 * When they drifted before, the same inspection showed a different score
 * depending on which screen you came from, which is unfalsifiable from a
 * screenshot and reads as data corruption.
 */
export const QUALITY_CHECK_SELECT = {
  id: true,
  assignment_id: true,
  room_number: true,
  score: true,
  status: true,
  notes: true,
  criteria_scores: true,
  photo_urls: true,
  rework_required: true,
  rework_notes: true,
  rework_completed_at: true,
  created_at: true,
  worker: { select: { id: true, first_name: true, last_name: true } },
  hotel: { select: { id: true, name: true, city: true } },
  verified_by: { select: { id: true, first_name: true, last_name: true } },
  assignment: { select: { id: true, day: true, status: true } },
  // The corrective assignment, so a screen can offer "go to your rework"
  // without a second round trip. At most one today (one rework per check,
  // owner decision 2026-08-29), but modelled as a list because the schema
  // permits more.
  rework_assignments: { select: { id: true, status: true, day: true } },
} satisfies Prisma.QualityVerificationSelect;

type QualityCheckRow = Prisma.QualityVerificationGetPayload<{
  select: typeof QUALITY_CHECK_SELECT;
}>;

/**
 * Photo COUNT, never the keys. A key is useless without a presigned URL, and
 * the photos endpoint mints those on its own authorization check -- returning
 * them in a list would widen it into a directory of private storage paths.
 */
export function toCheckDto(row: QualityCheckRow) {
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    day: row.assignment?.day ?? null,
    assignment_status: row.assignment?.status ?? null,
    room_number: row.room_number,
    score: row.score,
    status: row.status,
    notes: row.notes,
    criteria_scores: row.criteria_scores,
    photo_count: row.photo_urls.length,
    rework_required: row.rework_required,
    rework_notes: row.rework_notes,
    rework_completed_at: row.rework_completed_at,
    created_at: row.created_at,
    worker: row.worker
      ? { id: row.worker.id, first_name: row.worker.first_name, last_name: row.worker.last_name }
      : null,
    hotel: row.hotel ? { id: row.hotel.id, name: row.hotel.name, city: row.hotel.city } : null,
    checked_by: row.verified_by
      ? {
          id: row.verified_by.id,
          first_name: row.verified_by.first_name,
          last_name: row.verified_by.last_name,
        }
      : null,
    // What the worker's "go to your rework" button needs.
    rework_assignment: row.rework_assignments[0]
      ? {
          id: row.rework_assignments[0].id,
          status: row.rework_assignments[0].status,
          day: row.rework_assignments[0].day,
        }
      : null,
  };
}

export async function refreshWorkerOverallRating(tx: RatingAggregateTx, worker_id: string) {
  // Serialize concurrent rating/assignment updates for this worker to prevent
  // double-triggering threshold warnings or overwriting intermediate state.
  if (typeof tx.$executeRawUnsafe === 'function') {
    await tx.$executeRawUnsafe('SELECT 1 FROM "User" WHERE id = $1 FOR UPDATE', worker_id);
  }

  // 2026-08-13 fix (E2E integration audit -- "leaderboard sabotage"): this
  // denominator used to be a raw count of EVERY WorkerAssignment row
  // regardless of status, with zero filtering. completion_rate/on_time_rate
  // are ratios against it, so that had two concrete failure modes, both
  // reproducible in normal operation, neither the worker's doing:
  //
  //  1. A manager-cancelled shift (overstaffing, hotel closure, anything)
  //     stayed in the denominator forever -- the numerator (completed) never
  //     moves for a row that never happened, so every cancellation is a pure
  //     drop in the worker's own rate, permanently, for an outcome they had
  //     no part in.
  //  2. A brand-new worker who accepted several of NEXT WEEK's shifts had
  //     their completion rate crash toward 0% immediately, before any of
  //     those shifts' scheduled day had even arrived -- picking up future
  //     work penalized them exactly as if they'd failed to show up for it.
  //
  // Fixed by counting only assignments that have actually come DUE: a
  // terminal outcome (COMPLETED/NO_SHOW, regardless of day -- these already
  // happened) or an active assignment (CONFIRMED/IN_PROGRESS) whose `day`
  // has arrived. CANCELLED and REASSIGNED are excluded outright, at any day
  // -- neither describes a shift the worker was actually responsible for
  // completing. A future CONFIRMED/IN_PROGRESS assignment is excluded until
  // its day arrives, at which point it counts (and, from that day forward,
  // resolves to COMPLETED/NO_SHOW/CANCELLED like any other -- this query is
  // re-run by refreshWorkerOverallRating's every caller on the next status
  // change, so it is never permanently stuck counting a now-past CONFIRMED
  // row that should have transitioned).
  const dueAssignmentWhere: Prisma.WorkerAssignmentWhereInput = {
    worker_id,
    // ADR-069 §3: rework assignments are excluded from every ratio here. A
    // rework row is a SECOND row for work already counted once via the
    // original COMPLETED assignment, so counting it would halve
    // completion_rate for one failed inspection and then restore it --
    // compounding a penalty on top of the 0-100 quality score, which is the
    // mechanism the platform already uses to record poor work.
    rework_of_assignment_id: null,
    // Owner decision 2026-08-29: "only completed and no show. nor should sick
    // leave count nor vacations." Every other status is excluded:
    //
    //   - CANCELLED, which is what a sick or vacation mark auto-creates.
    //     Declaring an absence in advance is not a failure to turn up, and
    //     counting it would make using the absence feature lower your score.
    //     (Still visible on its own as `worker_cancellations`, never folded
    //     into a ratio where it would be indistinguishable from a no-show.)
    //   - CONFIRMED / IN_PROGRESS, even once their day has passed. This arm
    //     previously counted them via `day: { lte: today }`, which scored
    //     shifts that had not finished. A stale one is resolved to NO_SHOW by
    //     AssignmentNoShowJob, and counts from that point.
    //   - REASSIGNED, which describes a shift somebody else ended up owning.
    status: { in: [AssignmentStatus.COMPLETED, AssignmentStatus.NO_SHOW] },
  };

  const [
    agg,
    recentRatings,
    totalAssignments,
    completedAssignments,
    onTimeAttendance,
    lastWorked,
    workerCancellations,
  ] =
    await Promise.all([
      // Owner decision 2026-08-29: "the rating should be fed by the rating
      // checker submits in checks". The quality figure now comes from
      // QualityVerification -- the score recorded during a check -- rather
      // than the separate Rating model, which asked the checker for a second
      // number about the same visit.
      //
      // `verified_by_id` is not filtered: the score belongs to the WORKER
      // being inspected regardless of which checker recorded it. The join to
      // the worker is through the assignment, since QualityVerification has no
      // worker_id column of its own.
      tx.qualityVerification.aggregate({
        // Direct column since the Rating merge (2026-08-29) -- previously this
        // reached the worker through `assignment`, a join on the hot path that
        // every rating write and every assignment status change runs.
        where: { worker_id },
        _avg: { score: true },
        _count: true,
      }),
      // TREQ-004 (CONFIRMED §15): the last 10 jobs must weigh most. Read as a
      // bounded LIMIT 10 rather than pulling the worker's whole rating history
      // into the app and slicing it there -- OQ-08's performance note
      // (FIND-PERF-002) calls out that a full-history rescan makes per-write
      // cost grow O(n) with a worker's cumulative rating count, uncapped, and
      // asks whoever implements this to prefer a bounded design. The lifetime
      // half of the blend stays an aggregate, computed DB-side above.
      typeof tx.qualityVerification?.findMany === 'function'
        ? tx.qualityVerification.findMany({
            where: { worker_id },
            // id is a tiebreak, not decoration. created_at ties are
            // possible (several ratings written in one transaction share a
            // now()), and with a tie straddling the 10th position the window
            // -- and so the stored average_score -- would differ between two
            // calls over identical data. Ordering-dependent output that only
            // appears under duplicate timestamps never reproduces on demand.
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: RECENCY_WINDOW,
            select: { score: true },
          })
        : Promise.resolve([] as { score: number }[]),
      tx.workerAssignment.count({ where: dueAssignmentWhere }),
      // ADR-069 §3: MUST carry the same rework exclusion as the denominator.
      // Without it this is the on_time_rate bug of 2026-08-18 all over again,
      // one metric to the left: a completed rework row increments the
      // numerator while the denominator excludes it, so a worker who does one
      // rework reports completion_rate above 100%. Spelling the filter out
      // rather than spreading dueAssignmentWhere, because the status
      // constraint here is COMPLETED specifically, not "due".
      tx.workerAssignment.count({
        where: {
          worker_id,
          status: AssignmentStatus.COMPLETED,
          rework_of_assignment_id: null,
        },
      }),
      // 2026-08-18 fix: scoped to the SAME assignments as the denominator.
      // This counted every PRESENT row for the worker, while the denominator
      // (dueAssignmentWhere) excludes CANCELLED/REASSIGNED and future
      // CONFIRMED shifts -- two different filters over two different tables,
      // with nothing keeping them in step.
      //
      // Cancelling an assignment never clears its Attendance row, so the
      // normal sequence "worker checks in -> PRESENT -> shift is cancelled"
      // left the attendance in the numerator while removing the assignment
      // from the denominator. One such shift is enough to report an on-time
      // rate above 100%; several make it arbitrarily large. It reads as a
      // data-integrity bug on the worker's own record, and it inflates their
      // leaderboard standing rather than harming them, which is why it can
      // sit unnoticed.
      tx.attendance.count({
        where: {
          worker_id,
          status: AttendanceStatus.PRESENT,
          assignment: dueAssignmentWhere,
        },
      }),
      tx.workerAssignment.findFirst({
        where: {
          worker_id,
          status: AssignmentStatus.COMPLETED,
          completed_at: { not: null },
        },
        orderBy: { completed_at: 'desc' },
        select: { completed_at: true },
      }),
      // Shifts the worker stood themselves down from. Reported as a plain
      // count, never as a ratio: it is a visibility signal for a manager, not
      // a penalty applied behind the worker's back. Matched on the exported
      // constant so a reworded reason cannot silently stop counting, and
      // scoped to the SELF reason so a manager-cancelled shift is never
      // attributed to the worker.
      tx.workerAssignment.count({
        where: {
          worker_id,
          status: AssignmentStatus.CANCELLED,
          cancellation_reason: ABSENCE_CANCEL_REASON_SELF,
        },
      }),
    ]);

  // Two 70/30 splits on two different axes, composed. First recency
  // (TREQ-004): recent-10 against lifetime, WITHIN the quality figure.
  const qualityScore =
    agg._count > 0
      ? blendRecencyWeightedScore(recentRatings.map((r) => r.score), agg._avg.score, agg._count)
      : null;

  const completionRate = totalAssignments > 0 ? completedAssignments / totalAssignments : 0;
  const onTimeRate = totalAssignments > 0 ? onTimeAttendance / totalAssignments : 0;

  // Then quality against attendance (owner decision 2026-08-29). Attendance is
  // completionRate on the new denominator -- COMPLETED / (COMPLETED+NO_SHOW) --
  // expressed 0-100 so it shares the quality scale. Derived from the same
  // number rather than recomputed, so the stored rate and the rating it feeds
  // can never disagree.
  const attendance = attendanceScore(completedAssignments, totalAssignments);
  const blended = blendQualityAndAttendance(qualityScore, attendance);

  // Null means "never inspected" and is stored as 0 alongside total_ratings 0,
  // which is this codebase's existing unrated convention -- deriveRatingTier()
  // returns null on it and the web leaderboard prints "—". Kept rather than
  // migrating average_score to nullable, so there is one way to express
  // "unrated" instead of two that can disagree.
  const averageScore = blended ?? 0;

  const existingRating = typeof tx.workerOverallRating?.findUnique === 'function'
    ? await tx.workerOverallRating.findUnique({ where: { worker_id } })
    : null;
  let warning_70_sent_at = existingRating?.warning_70_sent_at ?? null;
  let warning_50_sent_at = existingRating?.warning_50_sent_at ?? null;

  // Warnings need BOTH a due shift and at least one check. The check
  // requirement is what keeps an unrated worker silent: averageScore is 0 for
  // them, which would otherwise read as "below 50" and alert the worker and
  // their regional manager before anyone had inspected anything.
  if (totalAssignments > 0 && agg._count > 0) {
    if (averageScore < 50) {
      if (!warning_50_sent_at) {
        warning_50_sent_at = new Date();
        warning_70_sent_at = new Date(); // If they dropped straight to <50, mark 70 as sent too

        if (typeof tx.notification?.create === 'function') {
          await notificationService.enqueue({
            recipientId: worker_id,
            type: 'QUALITY_RATING_WARNING_50',
            title: 'Rating Alert',
            message: 'Your overall rating has dropped below 50. Please contact your manager immediately.',
            data: { average_score: averageScore },
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.QUALITY,
            producerService: 'QualityService',
          }, tx);
        }

        const record = typeof tx.employmentRecord?.findUnique === 'function'
          ? await tx.employmentRecord.findUnique({
            where: { user_id: worker_id },
            select: { status: true, hotel_group_id: true },
          })
          : null;

        if (record && record.status === EmploymentStatus.ACTIVE && record.hotel_group_id) {
          const group = typeof tx.hotelGroup?.findUnique === 'function'
            ? await tx.hotelGroup.findUnique({
              where: { id: record.hotel_group_id },
              select: { regional_manager_user_id: true },
            })
            : null;

          if (group?.regional_manager_user_id && typeof tx.notification?.create === 'function') {
            await notificationService.enqueue({
              recipientId: group.regional_manager_user_id,
              type: 'QUALITY_RATING_WARNING_50',
              title: 'Worker Rating Alert',
              message: `A worker's rating has dropped below 50.`,
              data: { worker_id, average_score: averageScore },
              transports: [OutboxTransport.PUSH],
              sourceModule: OutboxSourceModule.QUALITY,
              producerService: 'QualityService',
            }, tx);
          }
        }
      }
    } else if (averageScore < 70) {
      if (!warning_70_sent_at) {
        warning_70_sent_at = new Date();
        if (typeof tx.notification?.create === 'function') {
          await notificationService.enqueue({
            recipientId: worker_id,
            type: 'QUALITY_RATING_WARNING_70',
            title: 'Rating Warning',
            message: 'Your overall rating has dropped below 70. Please review your recent feedback.',
            data: { average_score: averageScore },
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.QUALITY,
            producerService: 'QualityService',
          }, tx);
        }
      }
      if (warning_50_sent_at) {
        warning_50_sent_at = null; // Reset 50 warning since they improved
      }
    } else {
      warning_70_sent_at = null;
      warning_50_sent_at = null;
    }
  }

  const aggregateData = {
    average_score: averageScore,
    total_ratings: agg._count,
    total_assignments: totalAssignments,
    completion_rate: completionRate,
    on_time_rate: onTimeRate,
    last_worked_at: lastWorked?.completed_at ?? null,
    worker_cancellations: workerCancellations,
    warning_70_sent_at,
    warning_50_sent_at,
  };

  if (typeof tx.workerOverallRating?.upsert === 'function') {
    await tx.workerOverallRating.upsert({
      where: { worker_id },
      create: { worker_id, ...aggregateData },
      update: aggregateData,
    });
  }
}

export class QualityService extends BaseService {
  /**
   * Upload inspection/rework evidence and return the STORAGE KEYS.
   *
   * Keys, never URLs: a presigned URL lives 15 minutes, so persisting one
   * would store a value that is dead almost immediately. The column is named
   * `photo_urls` from an earlier design; it holds keys.
   */
  private async uploadPhotos(
    photos: UploadedPhoto[],
    assignmentId: string,
    kind: 'inspection' | 'rework' | 'rating'
  ): Promise<string[]> {
    if (photos.length === 0) return [];
    if (photos.length > MAX_PHOTOS_PER_VERIFICATION) {
      throw new ValidationError(`At most ${MAX_PHOTOS_PER_VERIFICATION} photos may be attached`);
    }

    const storage = await getStorageClient();
    const keys: string[] = [];
    try {
      for (const photo of photos) {
        if (!(ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(photo.mimeType)) {
          throw new ValidationError(`Unsupported image type: ${photo.mimeType}`);
        }
        if (photo.buffer.byteLength > MAX_PHOTO_BYTES) {
          throw new ValidationError('Image exceeds the maximum size');
        }
        const key = generateQualityPhotoKey(assignmentId, kind, photo.originalName);
        await storage.upload(key, photo.buffer, photo.mimeType);
        keys.push(key);
      }
    } catch (err) {
      // Roll back what THIS call uploaded. Without it a rejected 4th photo
      // leaves three orphans on every retry -- and retrying a bad upload is
      // the common case.
      await Promise.all(keys.map((k) => storage.delete(k).catch(() => {})));
      throw err;
    }
    return keys;
  }

  // ---------------------------------------------------------------------------
  // CRR §14 rework loop: checker assigns -> worker notified (inbox + push) ->
  // worker uploads photo and marks done -> checker notified.
  // ---------------------------------------------------------------------------

  /** Assign rework for a failed inspection (ADR-069). */
  async assignRework(input: AssignReworkRequest, actor: Actor) {
    const verification = await this.prisma.qualityVerification.findUnique({
      where: { id: input.verification_id },
      include: { assignment: true },
    });
    if (!verification) throw new NotFoundError('Verification not found');
    const original = verification.assignment;
    if (!original) throw new NotFoundError('Assignment not found');

    // Same authorization surface as creating the verification: rework is an
    // outcome of the inspection, not a separate capability.
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, original.hotel_id);
      if (!inScope) throw new ForbiddenError('Cannot assign rework for this hotel');
    }
    // No score gate. Rework is the CHECKER's decision, not an inference from
    // the number they typed (owner decision, 2026-08-29).
    //
    // This used to refuse a PASSED verification outright, which made the
    // action a function of the score: `status` is derived from it
    // (>= 70 PASSED), so a checker who scored a room 75 and then saw
    // something that had to be redone could not say so. The score is a
    // summary; the person standing in the room is the authority. The reverse
    // case was already allowed and uncontroversial -- a NEEDS_REWORK score
    // with no rework assigned -- so the gate was only ever enforced in one
    // direction anyway.

    return this.prisma.$transaction(async (tx) => {
      // CLAIM FIRST, then act. The read above is a check-then-act window: two
      // concurrent assignRework calls could both see rework_required false and
      // both proceed, giving the worker two rework rows and TWO 20-minute
      // escalation timers for one failure. This conditional update is a
      // compare-and-swap -- whoever flips false->true wins, the loser matches
      // zero rows and gets the same 409 a sequential duplicate would.
      const claimed = await tx.qualityVerification.updateMany({
        where: { id: verification.id, rework_required: false },
        data: {
          rework_required: true,
          rework_notes: input.notes,
          // The decision overrides the score-derived status. Without this a
          // row can say PASSED while carrying a rework assignment -- which is
          // self-contradictory in the record, renders as a green PASSED badge
          // next to "awaiting the worker" on both evidence screens, and lets
          // analytics keep counting it as a pass (analytics/service.ts filters
          // on `status: PASSED`) after the checker has said it is not one.
          //
          // Deliberately NOT FAILED: the checker asked for a correction, which
          // is what NEEDS_REWORK means. The `score` column is untouched -- the
          // number they gave is still the number they gave, and overwriting it
          // would destroy the input to WorkerOverallRating.
          status: VerificationStatus.NEEDS_REWORK,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictError('Rework has already been assigned for this verification');
      }

      return this.createReworkAssignment(tx, {
        original,
        verificationId: verification.id,
        notes: input.notes,
        actorId: actor.userId,
      });
    });
  }

  /**
   * The rework assignment and the notification that goes with it (CRR §14).
   *
   * Shared by assignRework() -- which acts on an inspection recorded earlier --
   * and recordInspection(), which decides at capture time. Extracted rather
   * than duplicated because the two must not drift: the worker app deep-links
   * a REWORK_REQUIRED push on `data.rework_assignment_id`
   * (worker-app/src/lib/push-notifications.ts), so a payload that differs
   * between the two producers means a push that opens the wrong screen -- or
   * nothing -- depending on which path created it.
   *
   * Runs inside the caller's transaction. The caller owns the claim on
   * `rework_required`; this helper assumes it has already been won.
   */
  private async createReworkAssignment(
    tx: DatabaseTransaction,
    params: {
      original: { id: string; worker_id: string; hotel_id: string };
      verificationId: string;
      notes: string;
      actorId: string;
    }
  ) {
    const { original, verificationId, notes, actorId } = params;

    const reworkAssignment = await tx.workerAssignment.create({
      data: {
        worker_id: original.worker_id,
        hotel_id: original.hotel_id,
        assigned_by_id: actorId,
        // Dated today, not the original's day: CRR §14 expects rework to be
        // actionable now, and the 20-minute clock starts here.
        day: new Date(`${todayInCalendarTimezone()}T00:00:00.000Z`),
        status: AssignmentStatus.CONFIRMED,
        rework_of_assignment_id: original.id,
        rework_verification_id: verificationId,
      },
    });

    // CRR §14 requires BOTH a stored, readable inbox entry AND a push --
    // "not one instead of the other". enqueue() writes the Notification row
    // (the inbox) and dispatches PUSH, so one call satisfies both. CRR §18's
    // push-only rule is about external channels (no SMS), not about
    // skipping the in-app record.
    await notificationService.enqueue(
      {
        recipientId: original.worker_id,
        type: 'REWORK_REQUIRED',
        title: 'Rework required',
        message: notes,
        data: {
          verification_id: verificationId,
          original_assignment_id: original.id,
          rework_assignment_id: reworkAssignment.id,
          notes,
        },
        hotelId: original.hotel_id,
        transports: [OutboxTransport.PUSH],
        sourceModule: OutboxSourceModule.QUALITY,
        producerService: 'QualityService',
      },
      tx
    );

    return reworkAssignment;
  }

  /**
   * Worker uploads evidence and marks the rework done (CRR §14).
   * The photo is mandatory: it is what the checker is notified WITH.
   */
  async completeRework(assignmentId: string, photos: UploadedPhoto[], actor: Actor) {
    const reworkAssignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignmentId },
      include: { rework_verification: true },
    });
    if (!reworkAssignment) throw new NotFoundError('Assignment not found');
    if (!reworkAssignment.rework_of_assignment_id) {
      throw new ValidationError('This assignment is not a rework task');
    }
    // Self-scoped: a worker completes their own rework and nobody else's.
    if (reworkAssignment.worker_id !== actor.userId) {
      throw new ForbiddenError('Cannot complete rework for another worker');
    }
    if (photos.length === 0) {
      throw new ValidationError('A photo is required to mark rework as done');
    }

    const verification = reworkAssignment.rework_verification;
    if (!verification) throw new NotFoundError('Originating verification not found');

    const photoKeys = await this.uploadPhotos(photos, assignmentId, 'rework');

    return this.prisma.$transaction(async (tx) => {
      // Same compare-and-swap as assignRework, for the same reason: a
      // double-tap on "mark done" would otherwise notify the checker twice
      // and append the photos twice.
      const claimed = await tx.qualityVerification.updateMany({
        where: { id: verification.id, rework_completed_at: null },
        data: {
          rework_completed_at: new Date(),
          // Appended, not replaced: the checker needs the before/after pair,
          // so inspection and rework evidence both stay on the record.
          photo_urls: { push: photoKeys },
        },
      });
      if (claimed.count === 0) {
        throw new ConflictError('This rework has already been completed');
      }

      await tx.workerAssignment.update({
        where: { id: assignmentId },
        data: { status: AssignmentStatus.COMPLETED, completed_at: new Date() },
      });

      // CRR §14: "Checker is notified with the photo + details."
      await notificationService.enqueue(
        {
          recipientId: verification.verified_by_id,
          type: 'REWORK_COMPLETED',
          title: 'Rework completed',
          message: 'The worker uploaded evidence and marked the rework done.',
          data: {
            verification_id: verification.id,
            rework_assignment_id: assignmentId,
            photo_keys: photoKeys,
          },
          hotelId: reworkAssignment.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.QUALITY,
          producerService: 'QualityService',
        },
        tx
      );

      await refreshWorkerOverallRating(tx, reworkAssignment.worker_id);

      return tx.qualityVerification.findUnique({ where: { id: verification.id } });
    });
  }


  /**
   * May this actor record an inspection against this assignment?
   *
   * The identical branch was written out three times -- createVerification,
   * createRating, and now recordInspection -- which is three places for one
   * security rule to drift. Extracted verbatim; the comments below are the
   * ones that were already there and are the reason it is written this way.
   *
   * isScopedManagerRole() covers regional_manager as defense-in-depth, not as
   * a live grant: ADR-030 §3 C-27 denies RM `quality:write`, so an RM cannot
   * currently reach these methods at all. Written this way because a bare
   * `role === 'manager'` test would SILENTLY no-op the scope check if C-27
   * were ever widened -- failing open on a security boundary.
   *
   * The checker branch is assignment-based, NOT JWT scope: a checker's token
   * never carries a scope claim (resolveScope mints one only for
   * admin/RM/manager), so a scope gate here would deny every checker
   * unconditionally.
   */
  private async assertCanInspect(
    assignment: { hotel_id: string; day: Date },
    actor: Actor,
    forbiddenMessage: string
  ): Promise<void> {
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError(forbiddenMessage);
      }
    } else if (actor.role === 'checker') {
      const checkerAssignment = await this.prisma.workerAssignment.findFirst({
        where: {
          worker_id: actor.userId,
          hotel_id: assignment.hotel_id,
          day: assignment.day,
          status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        },
      });
      if (!checkerAssignment) {
        throw new ForbiddenError(
          'Checker must have an active assignment at the same hotel on the same day'
        );
      }
    }
  }

  /**
   * A shift cannot be inspected before the worker starts it.
   *
   * Owner decision, 2026-08-29, after a checker recorded a completed
   * inspection against a shift still sitting in CONFIRMED -- the worker had
   * not begun, so there was nothing in the room to look at, and the record
   * said otherwise.
   *
   * **This deliberately supersedes ADR-072 §2.5**, which had check-in state
   * explicitly NOT filtering the inspectable-worker list, reasoning that a
   * checker "may need to inspect, or record the absence of, work by someone
   * whose attendance is missing". That case is real but it is the lesser one:
   * it costs a checker a second attempt after the worker checks in, whereas
   * the behaviour it allowed produced a scored, photographed inspection of
   * work that had not happened -- which feeds WorkerOverallRating and the
   * leaderboard, and is indistinguishable afterwards from a real one.
   *
   * COMPLETED is admitted alongside IN_PROGRESS: the common case is
   * inspecting a room after the worker has checked out, and refusing that
   * would leave nearly every finished shift uninspectable. CANCELLED,
   * NO_SHOW and REASSIGNED are refused -- there is no work to inspect, and
   * the picker has never offered them.
   */
  private assertShiftHasStarted(assignment: { status: AssignmentStatus }): void {
    if (
      assignment.status === AssignmentStatus.IN_PROGRESS ||
      assignment.status === AssignmentStatus.COMPLETED
    ) {
      return;
    }
    throw new ValidationError(
      assignment.status === AssignmentStatus.CONFIRMED
        ? 'This shift has not started yet. The worker must check in before it can be inspected.'
        : `A ${assignment.status.toLowerCase().replace(/_/g, ' ')} shift cannot be inspected.`
    );
  }

  /**
   * One inspection, one request (2026-08-29).
   *
   * The checker app used to make three sequential calls to end an inspection
   * -- createRating, then createVerification, then assignRework -- because the
   * two records live in two tables written by two endpoints. That was wrong in
   * three concrete ways, all of them invisible from the server side:
   *
   *   1. The photos were uploaded TWICE, once per record, over hotel wifi.
   *   2. Nothing was atomic. A failure between calls left a rating with no
   *      verification, or a verification with no rework, and the client had to
   *      reason about which.
   *   3. The worker received up to THREE notifications for one inspection:
   *      RATING_RECEIVED, then a score-derived REWORK_REQUIRED from
   *      createVerification, then the real REWORK_REQUIRED from assignRework.
   *      Two of those were duplicates of a decision the checker made once.
   *
   * This writes both records, the aggregate refresh, the rework assignment and
   * exactly ONE notification in a single transaction, from a single upload.
   * The two-endpoint path is untouched -- the web still uses it, and it
   * remains the way to add a verification to an inspection recorded earlier.
   *
   * The outcome is the CHECKER's, not the score's: `outcome: 'rework'` writes
   * NEEDS_REWORK whatever the number says. See assignRework() for why the
   * score gate was removed.
   */
  async recordInspection(
    data: RecordInspectionRequest,
    actor: Actor,
    photos: UploadedPhoto[] = []
  ) {
    const { assignment_id, worker_id, score, comment, criteria_scores, outcome, room_number } = data;
    const reworkNotes = (data.rework_notes ?? comment ?? '').trim();

    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignment_id },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.worker_id !== worker_id) {
      throw new ForbiddenError('worker_id does not match the assignment worker');
    }

    await this.assertCanInspect(assignment, actor, 'Cannot inspect for this hotel');
    // Authorization first, business rule second -- an actor who may not inspect
    // this assignment gets that answer, not a hint about its state.
    this.assertShiftHasStarted(assignment);

    // CRR §15: the photo accompanies the rating. After authorization, so an
    // actor who may not inspect gets that answer rather than a validation hint.
    if (photos.length === 0) {
      throw new ValidationError('A photo is required to submit an inspection');
    }
    // The notes ARE what the worker is sent and the only instruction they get,
    // with a 20-minute escalation clock running. An empty one is not a
    // rework request, it is a shift they cannot act on.
    if (outcome === 'rework' && reworkNotes === '') {
      throw new ValidationError('Rework notes are required to assign rework');
    }

    // No duplicate pre-check any more: a shift carries one check PER ROOM, so a
    // second inspection of the same assignment is the normal case rather than
    // a conflict (owner decision, 2026-08-29). The room number is what
    // distinguishes them, which is why it is required above.
    //
    // Deliberately NOT unique on (assignment_id, room_number) either: a
    // checker may legitimately re-inspect a room after rework, and rejecting
    // that would make the second look like a mistake.

    // ONE upload, shared by both records. They are the same photographs of the
    // same room on the same visit; storing two copies under two key prefixes
    // was an artifact of two endpoints, not a property of the evidence.
    //
    // Uploaded BEFORE the transaction opens: an S3 round-trip per file inside
    // it would hold row locks for the duration of a network upload. The cost
    // is orphaned objects if the commit then fails -- cheap and invisible --
    // against lock contention on a hot table.
    const photoKeys = await this.uploadPhotos(photos, assignment_id, 'inspection');

    const derivedStatus: VerificationStatus =
      score >= 70
        ? VerificationStatus.PASSED
        : score >= 40
          ? VerificationStatus.NEEDS_REWORK
          : VerificationStatus.FAILED;

    // The decision wins over the derivation. A row that says PASSED while
    // carrying a rework assignment contradicts itself, renders as a green
    // badge beside "awaiting the worker", and keeps counting as a pass in
    // analytics (which filters on `status: PASSED`). Same rule assignRework
    // applies when it is used on its own.
    const status = outcome === 'rework' ? VerificationStatus.NEEDS_REWORK : derivedStatus;

    const result = await this.prisma.$transaction(async (tx) => {
      let verification;
      try {
        verification = await tx.qualityVerification.create({
          data: {
            assignment_id,
            hotel_id: assignment.hotel_id,
            verified_by_id: actor.userId,
            worker_id,
            room_number,
            score,
            status,
            notes: comment ?? null,
            // The checklist lives here since the Rating merge (2026-08-29).
            criteria_scores: criteria_scores
              ? (criteria_scores as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            photo_urls: photoKeys,
            ...(outcome === 'rework'
              ? { rework_required: true, rework_notes: reworkNotes }
              : {}),
          },
        });
      } catch (error) {
        // No unique constraint on this table any more, so P2002 here would
        // mean a NEW one somebody added without updating this handler --
        // surfaced as itself rather than mistranslated into a stale
        // "already inspected" message that would send the checker looking for
        // a duplicate that does not exist.
        throw error;
      }

      // GD-04 single-writer rule: every path that writes a Rating must refresh
      // the aggregate inside the same transaction, or WorkerOverallRating goes
      // silently stale.
      await refreshWorkerOverallRating(tx, worker_id);

      if (outcome === 'rework') {
        // No compare-and-swap here, unlike assignRework: the verification row
        // was created microseconds ago inside this same transaction, so there
        // is no concurrent claimant to lose to. The duplicate this guards
        // against upstream -- two rework rows and two escalation timers for
        // one failure -- is prevented by `assignment_id @unique` instead.
        const reworkAssignment = await this.createReworkAssignment(tx, {
          original: assignment,
          verificationId: verification.id,
          notes: reworkNotes,
          actorId: actor.userId,
        });
        return { verification, reworkAssignment };
      }

      // Exactly one notification for the "complete" outcome. The old
      // three-call path sent RATING_RECEIVED as well; two pushes for one
      // inspection is noise, and the score is in this one.
      await notificationService.enqueue(
        {
          recipientId: worker_id,
          type: 'QUALITY_VERIFICATION_SUBMITTED',
          title: 'Quality check recorded',
          message: `Your work was inspected and scored ${score} out of 100.`,
          data: { verification_id: verification.id, assignment_id, score, status },
          hotelId: assignment.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.QUALITY,
          producerService: 'QualityService',
        },
        tx
      );

      return { verification, reworkAssignment: null };
    });

    await this.logAudit(
      actor.userId,
      actor.role,
      'RECORD_INSPECTION',
      'QUALITY_VERIFICATION',
      result.verification.id,
      { assignment_id, worker_id, score, outcome },
    );

    return {
      verification: result.verification,
      rework_assignment: result.reworkAssignment,
    };
  }

  async createVerification(
    data: CreateQualityVerificationRequest,
    actor: Actor,
    // CRR §15: "the Checker/supervisor uploads a photo WITH the rating."
    photos: UploadedPhoto[] = []
  ) {
    const { assignment_id, score, notes, criteria_scores, room_number } = data;

    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignment_id },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Epic 5 PR 5.5 (ADR-024, retired M-4): a scope-bound manager may only
    // verify attendance for hotels in their scope claim. Admin/checker unchanged.
    //
    // isScopedManagerRole() covers regional_manager as defense-in-depth, not as
    // a live grant: ADR-030 §3 C-27 denies RM `quality:write`, so an RM cannot
    // currently reach this method at all. Written this way because a bare
    // `role === 'manager'` test would SILENTLY no-op the scope check if C-27 were
    // ever widened — failing open on a security boundary. Same posture as
    // resolveWorkerScope()'s deny-by-default tail.
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot verify attendance for this hotel');
      }
    } else if (actor.role === 'checker') {
      const checkerAssignment = await this.prisma.workerAssignment.findFirst({
        where: {
          worker_id: actor.userId,
          hotel_id: assignment.hotel_id,
          day: assignment.day,
          status: { in: ACTIVE_ASSIGNMENT_STATUSES }
        }
      });
      if (!checkerAssignment) {
        throw new ForbiddenError('Checker must have an active assignment at the same hotel on the same day');
      }
    }

    this.assertShiftHasStarted(assignment);

    // CRR §15 enforcement (2026-08-24). The comment on the `photos` parameter
    // above has stated this requirement since the parameter was added, but
    // nothing checked it: a rating with no photo returned 201 and stored
    // `photo_urls = {}`, so the evidence that justifies the whole
    // rating/rework/dispute loop was optional in practice. The worker half of
    // the same CRR clause was already enforced — completeRework() throws
    // 'A photo is required to mark rework as done' on an empty array — so the
    // two halves of one rule disagreed.
    //
    // Placed AFTER the authorization branches above, deliberately: an actor
    // who may not rate this assignment must get that answer (403), not a
    // validation hint. Authorization first, business validation second.
    if (photos.length === 0) {
      throw new ValidationError('A photo is required to submit a rating');
    }

    // No duplicate check: one shift carries one check per room since
    // 2026-08-29, so a second inspection of the same assignment is normal.

    const numScore = score;
    const derivedStatus: VerificationStatus =
      numScore >= 70
        ? VerificationStatus.PASSED
        : numScore >= 40
        ? VerificationStatus.NEEDS_REWORK
        : VerificationStatus.FAILED;

    const isPassed = derivedStatus === 'PASSED';
    const isNeedsRework = derivedStatus === 'NEEDS_REWORK';

    // Uploaded BEFORE the transaction opens: an S3 round-trip per file inside
    // it would hold row locks for the duration of a network upload. The cost
    // is orphaned objects if the commit then fails -- cheap and invisible --
    // against lock contention on a hot table.
    const photoKeys = await this.uploadPhotos(photos, assignment_id, 'inspection');

    // ADR-029 (GD-01, Epic 7 PR 7.3): single commit for the verification
    // write and its notification enqueue.
    const verification = await this.prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.qualityVerification.create({
          data: {
            assignment_id,
            hotel_id: assignment.hotel_id,
            verified_by_id: actor.userId,
            // Denormalized since the Rating merge (2026-08-29). Read from the
            // assignment rather than accepted from the client: the caller does
            // not get to say whose inspection this is.
            worker_id: assignment.worker_id,
            room_number,
            score: numScore,
            status: derivedStatus,
            notes: notes ?? null,
            // TREQ-005 checklist, persisted here since the Rating merge
            // (2026-08-29). Accepting it in the schema without writing it
            // would silently drop every checklist the web records.
            criteria_scores: criteria_scores
              ? (criteria_scores as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            photo_urls: photoKeys,
          },
        });
      } catch (err) {
        // No unique constraint on assignment_id since 2026-08-29 -- a shift
        // carries one check per room -- so the P2002-to-409 translation that
        // lived here is gone. A P2002 now would mean a NEW constraint somebody
        // added without updating this handler, and it is re-thrown as itself
        // rather than mistranslated into "already inspected", which would send
        // a checker hunting for a duplicate that does not exist.
        throw err;
      }

      await notificationService.enqueue(
        {
          recipientId: assignment.worker_id,
          type: isPassed ? 'QUALITY_VERIFICATION_SUBMITTED' : isNeedsRework ? 'REWORK_REQUIRED' : 'QUALITY_VERIFICATION_SUBMITTED',
          title: isPassed ? 'Quality Check Passed' : isNeedsRework ? 'Rework Required' : 'Quality Check Failed',
          message: isPassed
            ? `Your work quality has been verified with a score of ${numScore}.`
            : isNeedsRework
            ? `Your work requires rework. Score: ${numScore}.`
            : `Your work did not meet quality standards. Score: ${numScore}.`,
          data: { verification_id: created.id, assignment_id, score: numScore, status: derivedStatus },
          hotelId: assignment.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.QUALITY,
          producerService: 'QualityService',
        },
        tx
      );

      return created;
    });

    await this.logAudit(
      actor.userId,
      actor.role,
      'CREATE_VERIFICATION',
      'QUALITY_VERIFICATION',
      verification.id,
      { assignment_id }
    );

    return verification;
  }

  async getVerification(verificationId: string, actor: Actor) {
    const verification = await this.prisma.qualityVerification.findUnique({
      where: { id: verificationId },
      include: {
        // Names, not just ids. The checker app's evidence screen showed a
        // score, a status and photos with no indication of WHOSE work was
        // inspected or WHERE -- and it could not resolve them itself, because
        // /crm/hotels/:id is scoped and 403s for a checker.
        //
        // Included on the same query rather than fetched separately: all three
        // are direct relations, so this stays one round trip.
        assignment: {
          select: {
            worker_id: true,
            day: true,
            worker: { select: { id: true, first_name: true, last_name: true } },
          },
        },
        hotel: { select: { id: true, name: true, city: true } },
        verified_by: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!verification) throw new NotFoundError('Verification not found');
    await this.assertCanViewVerification(verification, actor);
    return verification;
  }

  /**
   * Shared read gate for an inspection and its evidence.
   *
   * Extracted 2026-08-24 so getVerification() and getVerificationPhotos()
   * cannot drift apart — the record and the photos attached to it are the
   * same disclosure, and gating them differently would mean one endpoint
   * leaking what the other withholds.
   */
  private async assertCanViewVerification(
    verification: { hotel_id: string; assignment?: { worker_id: string } | null },
    actor: Actor
  ): Promise<void> {
    const isSubject = verification.assignment?.worker_id === actor.userId;
    const role = actor.role.toLowerCase();

    if (isSubject) return; // the worker the inspection is about
    if (role === 'admin') return; // unscoped by design

    if (role === 'checker') {
      // Assignment-based, NOT JWT scope: a checker's token never carries a
      // scope (resolveScope mints one only for admin/RM/manager), so a
      // scope gate here would deny every checker unconditionally.
      const checkerAssignment = await this.prisma.workerAssignment.findFirst({
        where: {
          worker_id: actor.userId,
          hotel_id: verification.hotel_id,
          status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        },
        select: { id: true },
      });
      if (!checkerAssignment) {
        throw new ForbiddenError('Cannot view evidence for this hotel');
      }
      return;
    }

    if (isScopedManagerRole(role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, verification.hotel_id);
      if (!inScope) throw new ForbiddenError('Cannot view evidence for this hotel');
      return;
    }

    // Any other role, including a WORKER who is not the subject.
    throw new ForbiddenError('Cannot view evidence for this inspection');
  }

  async getVerificationPhotos(verificationId: string, actor: Actor) {
    const verification = await this.prisma.qualityVerification.findUnique({
      where: { id: verificationId },
      include: { assignment: { select: { worker_id: true } } },
    });
    if (!verification) throw new NotFoundError('Verification not found');

    await this.assertCanViewVerification(verification, actor);

    const storage = await getStorageClient();
    const photos = await Promise.all(
      verification.photo_urls.map(async (key) => ({
        key,
        // null when storage is unconfigured (the stub). Surfaced rather than
        // hidden so a broken bucket shows as a missing image, not as an
        // inspection that never had evidence.
        url: await storage.getPresignedUrl(key),
      }))
    );

    return { verification_id: verification.id, photos };
  }

  /**
   * The workers a checker may inspect today (ADR-072 §2.5, owner decision
   * 2026-08-27: "workers with a shift today, any hotel in the checker's scope").
   *
   * A checker's JWT carries no `scope` claim — resolveScope mints one only for
   * admin/RM/manager — so "in scope" for a checker is resolved the way
   * assertCanViewVerification already resolves it: the hotels where the checker
   * themselves holds an active assignment. That keeps one definition of a
   * checker's reach rather than inventing a second.
   *
   * Check-in state is deliberately NOT a filter (ADR-072 §2.5): a checker may
   * need to inspect, or record the absence of, work by someone whose attendance
   * is missing, and filtering on check-in would hide exactly that case.
   *
   * Rework assignments are excluded: they are corrective work on a shift that
   * was already inspected, not a shift to inspect. Listing them would offer the
   * checker the same worker twice for one day's work.
   */
  async listInspectableWorkers(actor: Actor, day?: string) {
    const targetDay = day ?? todayInCalendarTimezone();
    const dayStart = new Date(`${targetDay}T00:00:00.000Z`);
    // A YYYY-MM-DD shape is not a real date: '2026-13-45' reached Prisma as an
    // Invalid Date and surfaced as a generic "Invalid database request", and
    // '2026-02-30' silently rolled over to March 2 while the response still
    // echoed back '2026-02-30' — a result for a day nobody asked about.
    // Round-tripping the parsed date rejects both.
    if (Number.isNaN(dayStart.getTime()) || dayStart.toISOString().slice(0, 10) !== targetDay) {
      throw new ValidationError('day must be a real calendar date in YYYY-MM-DD form');
    }

    let hotelFilter: Prisma.WorkerAssignmentWhereInput = {};

    if (actor.role.toLowerCase() === 'admin') {
      // Unscoped by design, as everywhere else in this service.
    } else if (isScopedManagerRole(actor.role)) {
      const scope = actor.scope ?? null;
      // No scope claim denies, matching assignments/service.ts list(): an
      // absent scope is not "see everything".
      if (!scope) return { day: targetDay, workers: [] };
      if (scope.type === 'hotel') {
        hotelFilter = { hotel_id: scope.hotel_id };
      } else if (scope.type === 'hotel_group') {
        // Narrowed through the hotel relation, the same shape
        // assignments/service.ts list() uses. An earlier revision of this
        // method left the group case unfiltered with a comment claiming it was
        // narrowed here — it was not, so a group-scoped manager would have seen
        // every hotel's workers. Unreachable in practice (this route needs
        // quality:write, which manager/RM do not hold) but wrong, and one
        // permission grant away from being a disclosure.
        hotelFilter = { hotel: { hotel_group_id: scope.hotel_group_id } };
      }
      // scope.type === 'global' -> no added restriction, deliberately.
    } else {
      const own = await this.prisma.workerAssignment.findMany({
        where: {
          worker_id: actor.userId,
          status: { in: ACTIVE_ASSIGNMENT_STATUSES },
          day: dayStart,
        },
        select: { hotel_id: true },
      });
      const hotelIds = [...new Set(own.map((a) => a.hotel_id))];
      // No shift today means no hotel in reach, which is a legitimately empty
      // list rather than an error: the client turns it into "you have no shift
      // today", the same thing the Start-checking gate says.
      if (hotelIds.length === 0) return { day: targetDay, workers: [] };
      hotelFilter = { hotel_id: { in: hotelIds } };
    }

    const assignments = await this.prisma.workerAssignment.findMany({
      where: {
        ...hotelFilter,
        day: dayStart,
        // IN_PROGRESS and COMPLETED only -- NOT the full active set, which
        // includes CONFIRMED. Offering a not-yet-started shift here and then
        // refusing it at submit time would waste the whole form; the picker
        // and assertShiftHasStarted() must agree. See that method for why
        // this supersedes ADR-072 §2.5.
        status: { in: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED] },
        rework_of_assignment_id: null,
        worker_id: { not: actor.userId },
      },
      select: {
        id: true,
        worker_id: true,
        hotel_id: true,
        status: true,
        worker: { select: { first_name: true, last_name: true, role: true } },
        hotel: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    });

    return {
      day: targetDay,
      workers: assignments.map((a) => ({
        assignment_id: a.id,
        worker_id: a.worker_id,
        worker_name: [a.worker?.first_name, a.worker?.last_name].filter(Boolean).join(' ') || null,
        hotel_id: a.hotel_id,
        hotel_name: a.hotel?.name ?? null,
        status: a.status,
      })),
    };
  }

  /**
   * The checks this person recorded, newest first, with free-text search.
   *
   * Lists CHECKS rather than shifts (2026-08-29). A shift now carries one
   * check per room, so keying the history by assignment would collapse a
   * hundred room inspections into one row and hide the very thing the checker
   * is looking for.
   *
   * Self-scoped by construction: the filter is the caller's own id on
   * `verified_by_id`, never a client-supplied parameter. A role that cannot
   * inspect gets an empty list, which is correct rather than a denial.
   *
   * Photo COUNTS, not keys: a key is useless without a presigned URL, and the
   * photos endpoint mints those per record on its own authorization check.
   */
  async listOwnChecks(
    actor: Actor,
    options: { page?: number; perPage?: number; q?: string } = {}
  ) {
    const page = options.page ?? 1;
    const perPage = options.perPage ?? 20;
    const q = options.q?.trim();

    // One box, four columns (owner decision, 2026-08-29). Someone typing "412"
    // may mean a room, a note that mentions it, or a name -- asking them which
    // before they can search is the kind of form nobody fills in twice.
    //
    // `mode: 'insensitive'` on every arm: "Grand" and "grand" are the same
    // hotel, and a case-sensitive search silently returns nothing rather than
    // reporting that it could not help.
    const search: Prisma.QualityVerificationWhereInput | undefined = q
      ? {
          OR: [
            { room_number: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
            { worker: { first_name: { contains: q, mode: 'insensitive' } } },
            { worker: { last_name: { contains: q, mode: 'insensitive' } } },
            { hotel: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : undefined;

    const where: Prisma.QualityVerificationWhereInput = {
      verified_by_id: actor.userId,
      ...(search ?? {}),
    };

    const [total, checks] = await Promise.all([
      this.prisma.qualityVerification.count({ where }),
      this.prisma.qualityVerification.findMany({
        where,
        select: QUALITY_CHECK_SELECT,
        // created_at is the inspection's own moment, which is what a checker
        // recognizes a row by when several rooms share a shift. `id` breaks
        // ties deterministically -- without it, two checks written in the same
        // transaction can swap places between requests and, under pagination,
        // silently drop or duplicate one across a page boundary.
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return {
      checks: checks.map(toCheckDto),
      pagination: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) },
    };
  }

  /**
   * Every check recorded against one shift.
   *
   * Backs the worker's shift screen (owner decision, 2026-08-29: "when the
   * worker clicks on the shifts he completed, or are in progress ... below
   * them he should be able to see all the checks that have been submitted by
   * the checker for him"). Also serves a checker or manager opening the same
   * shift, so both sides read one endpoint and cannot disagree.
   *
   * The WORKER the shift belongs to is admitted unconditionally -- these are
   * inspections of their own work, and CRR §14 is explicit that they are
   * notified with the detail. Everyone else goes through the same gate that
   * guards a single check.
   */
  async listChecksForAssignment(assignmentId: string, actor: Actor) {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, worker_id: true, hotel_id: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Reuses the single-check gate rather than restating it: one rule, so a
    // future change to who may see an inspection cannot apply to the detail
    // screen and miss the list that links to it.
    await this.assertCanViewVerification(
      { hotel_id: assignment.hotel_id, assignment: { worker_id: assignment.worker_id } },
      actor
    );

    const checks = await this.prisma.qualityVerification.findMany({
      where: { assignment_id: assignmentId },
      select: QUALITY_CHECK_SELECT,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });

    return { assignment_id: assignmentId, checks: checks.map(toCheckDto) };
  }

  /**
   * One check, in the shape every screen renders.
   *
   * Distinct from getVerification() above, which returns the raw record for
   * the checker's evidence screen. This returns the shared DTO -- including
   * the rework assignment -- so the worker's detail screen and the checker's
   * are literally the same view of the same data (owner decision: "he should
   * see the details, I mean the same screen the checker sees").
   */
  async getCheck(checkId: string, actor: Actor) {
    const check = await this.prisma.qualityVerification.findUnique({
      where: { id: checkId },
      select: QUALITY_CHECK_SELECT,
    });
    if (!check) throw new NotFoundError('Check not found');

    await this.assertCanViewVerification(
      { hotel_id: check.hotel?.id ?? '', assignment: { worker_id: check.worker?.id ?? '' } },
      actor
    );

    return toCheckDto(check);
  }

  async getLeaderboard(
    hotelId: string,
    page = 1,
    perPage = 25,
    actor?: { userId?: string; role: string; scope?: UserScope | null }
  ) {
    let where: Record<string, unknown> = {};
    if (hotelId) {
      // Group-grain, not hotel-grain, by design: EmploymentRecord's roster
      // eligibility is group-scoped (REQ-EMP-012, a worker may work ANY
      // hotel in their assigned group) and EmploymentRecord.primary_hotel_id
      // is explicitly documented as DISPLAY-ONLY -- "must never be read by
      // ... any eligibility check" (schema.prisma). There is no per-hotel
      // work-history field to leaderboard against, so resolving hotelId to
      // its hotel_group_id is the correct existing behavior, unchanged here.
      const hotel = await this.prisma.hotel.findUnique({
        where: { id: hotelId },
        select: { hotel_group_id: true },
      });
      where = {
        worker: {
          employment_record: { hotel_group_id: hotel?.hotel_group_id ?? '__none__', status: 'ACTIVE' },
        },
      };
    } else if (actor && isScopedManagerRole(actor.role)) {
      // IDOR fix (2026-08-08): the bare GET /leaderboard route (no
      // checkHotelAccess(), no hotel_id) previously applied no scoping
      // whatsoever once hotelId was empty -- any manager/RM holding
      // quality:read got the platform-wide leaderboard regardless of scope.
      // Scoped to the manager's own group (or their single hotel's group,
      // for a hotel-scoped manager -- same group-grain limitation as above,
      // since there is no narrower signal available).
      const scope = actor.scope ?? null;
      if (!scope) {
        where = { worker: { employment_record: { hotel_group_id: '__none__' } } };
      } else if (scope.type === 'hotel') {
        const hotel = await this.prisma.hotel.findUnique({
          where: { id: scope.hotel_id },
          select: { hotel_group_id: true },
        });
        where = {
          worker: {
            employment_record: { hotel_group_id: hotel?.hotel_group_id ?? '__none__', status: 'ACTIVE' },
          },
        };
      } else if (scope.type === 'hotel_group') {
        where = { worker: { employment_record: { hotel_group_id: scope.hotel_group_id, status: 'ACTIVE' } } };
      }
      // scope.type === 'global' -> no added restriction (unreachable for a
      // scoped-manager role in practice, kept for type completeness).
    } else if (actor && (actor.role === 'worker' || actor.role === 'checker')) {
      // A worker or checker sees the leaderboard for their OWN hotel group and
      // no further. Their scope is not carried on the JWT the way a manager's
      // is, so it is read from their employment record rather than actor.scope
      // -- and read here, server-side, so the group can never be supplied by
      // the caller.
      //
      // Without this branch they would fall through to the unrestricted `where`
      // below and receive the platform-wide leaderboard: every worker on the
      // system, their average score and shift counts. That is the same IDOR the
      // 2026-08-08 fix above closed for managers, and it would have been
      // reintroduced the moment these roles were let onto this route.
      const record = await this.prisma.employmentRecord.findUnique({
        where: { user_id: actor.userId },
        select: { hotel_group_id: true, status: true },
      });
      where = {
        worker: {
          employment_record: {
            // An unassigned or not-yet-approved account has no group to compare
            // within, so it sees an empty board rather than everyone's.
            hotel_group_id:
              record?.status === 'ACTIVE' && record.hotel_group_id
                ? record.hotel_group_id
                : '__none__',
            status: 'ACTIVE',
          },
        },
      };
    }

    const skip = (page - 1) * perPage;
    const [leaderboard, total] = await Promise.all([
      this.prisma.workerOverallRating.findMany({
        where,
        include: {
          worker: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              // Display-only, and safe to show a peer: which hotel this person
              // is normally based at. Read through primary_hotel for its NAME
              // only -- primary_hotel_id is documented as display-only and must
              // never drive an eligibility decision (schema.prisma).
              employment_record: {
                select: { primary_hotel: { select: { id: true, name: true } } },
              },
            },
          },
        },
        orderBy: { average_score: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.workerOverallRating.count({ where }),
    ]);

    // A worker or checker sees their group's board, so every row is a
    // colleague rather than a report. They get the identifying and
    // work-related fields -- name, hotel, scores -- and not the contact
    // details: email is a manager-facing field, and a leaderboard is not a
    // reason to hand every worker in a group everyone else's address.
    //
    // Built as an allow-list rather than by deleting `email` from the row: a
    // deny-list silently leaks the next field added to the `select` above,
    // which is the wrong way round for a projection that crosses a privacy
    // boundary. Adding a field here has to be a deliberate act.
    const isPeerViewer = actor?.role === 'worker' || actor?.role === 'checker';
    const visibleLeaderboard = isPeerViewer
      ? leaderboard.map((row) => ({
          ...row,
          worker: {
            id: row.worker.id,
            first_name: row.worker.first_name,
            last_name: row.worker.last_name,
            employment_record: row.worker.employment_record,
          },
        }))
      : leaderboard;

    // TREQ-003: the tier travels with the row rather than being re-derived in
    // each client. Three clients read this board (checker app, worker app, web)
    // and a threshold re-implemented three times is a threshold that will
    // disagree with itself. Derived, never stored -- see rating-tiers.ts.
    // Applied AFTER the peer allow-list above, so it lands on every row
    // including a worker's or checker's view of their colleagues. Deliberate,
    // and not a new disclosure: rating_tier is a pure function of
    // average_score and total_ratings, both already present in the rows a peer
    // receives. It reveals nothing they could not compute themselves.
    const tieredLeaderboard = visibleLeaderboard.map((row) => ({
      ...row,
      rating_tier: deriveRatingTier(row.average_score, row.total_ratings),
    }));

    return {
      leaderboard: tieredLeaderboard,
      pagination: {
        page, per_page: perPage, total,
        total_pages: Math.ceil(total / perPage),
        has_next: page * perPage < total,
        has_prev: page > 1,
      },
    };
  }
}

export const qualityService = new QualityService();
