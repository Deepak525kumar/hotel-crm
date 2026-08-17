import {
  AssignmentStatus,
  AttendanceStatus,
  OutboxSourceModule,
  OutboxTransport,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { notificationService } from '../notifications/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
// From lib/scope.js, not the middleware re-export — see geo/service.ts's note:
// pure predicates, so suites mocking the permissions middleware need not stub them.
import { isScopedManagerRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import type { CreateQualityVerificationRequest, CreateRatingRequest } from './types.js';
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
export async function refreshWorkerOverallRating(tx: RatingAggregateTx, worker_id: string) {
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
  const today = new Date(`${todayInCalendarTimezone()}T00:00:00.000Z`);
  const dueAssignmentWhere: Prisma.WorkerAssignmentWhereInput = {
    worker_id,
    OR: [
      { status: { in: [AssignmentStatus.COMPLETED, AssignmentStatus.NO_SHOW] } },
      {
        status: { in: [AssignmentStatus.CONFIRMED, AssignmentStatus.IN_PROGRESS] },
        day: { lte: today },
      },
      // Worker-initiated cancellations are deliberately NOT here. Declaring
      // sick/vacation is not a failure to complete a shift, so it must not
      // move completion_rate -- the 2026-08-13 rule above stands. It is still
      // worth seeing, so it is surfaced as its own count
      // (worker_cancellations) rather than folded into a ratio where it would
      // be indistinguishable from a no-show.
    ],
  };

  const [
    agg,
    totalAssignments,
    completedAssignments,
    onTimeAttendance,
    lastWorked,
    workerCancellations,
  ] =
    await Promise.all([
      tx.rating.aggregate({
        where: { worker_id },
        _avg: { score: true },
        _count: true,
      }),
      tx.workerAssignment.count({ where: dueAssignmentWhere }),
      tx.workerAssignment.count({
        where: { worker_id, status: AssignmentStatus.COMPLETED },
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

  const averageScore = agg._avg.score ?? 0;
  const completionRate = totalAssignments > 0 ? completedAssignments / totalAssignments : 0;
  const onTimeRate = totalAssignments > 0 ? onTimeAttendance / totalAssignments : 0;

  const aggregateData = {
    average_score: averageScore,
    total_ratings: agg._count,
    total_assignments: totalAssignments,
    completion_rate: completionRate,
    on_time_rate: onTimeRate,
    last_worked_at: lastWorked?.completed_at ?? null,
    worker_cancellations: workerCancellations,
  };

  await tx.workerOverallRating.upsert({
    where: { worker_id },
    create: { worker_id, ...aggregateData },
    update: aggregateData,
  });
}

export class QualityService extends BaseService {
  async createVerification(
    data: CreateQualityVerificationRequest,
    actor: Actor
  ) {
    const { assignment_id, score, notes } = data;

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

    const existing = await this.prisma.qualityVerification.findUnique({
      where: { assignment_id },
    });
    if (existing) throw new ConflictError('Verification already exists for this assignment');

    const numScore = score;
    const derivedStatus: VerificationStatus =
      numScore >= 70
        ? VerificationStatus.PASSED
        : numScore >= 40
        ? VerificationStatus.NEEDS_REWORK
        : VerificationStatus.FAILED;

    const isPassed = derivedStatus === 'PASSED';
    const isNeedsRework = derivedStatus === 'NEEDS_REWORK';

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
            score: numScore,
            status: derivedStatus,
            notes: notes ?? null,
          },
        });
      } catch (err) {
        // assignment_id is unique. Concurrent duplicate requests can pass the
        // findUnique pre-check above and both reach create(), causing a P2002
        // unique-constraint violation. Translate it to the same 409 the
        // pre-check returns so concurrent duplicates never surface as a 500.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictError('Verification already exists for this assignment');
        }
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

  async createRating(data: CreateRatingRequest, actor: Actor) {
    const { assignment_id, worker_id, score, comment, criteria_scores } = data;

    if (!assignment_id || !worker_id) {
      throw new ValidationError('assignment_id and worker_id are required');
    }
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new ValidationError('score must be an integer between 0 and 100');
    }

    const rating = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.workerAssignment.findUnique({
        where: { id: assignment_id },
        select: { id: true, hotel_id: true, worker_id: true, day: true },
      });
      if (!assignment) {
        throw new NotFoundError('Assignment not found');
      }
      if (assignment.worker_id !== worker_id) {
        throw new ForbiddenError('worker_id does not match the assignment worker');
      }

      // Epic 5 PR 5.5 (ADR-024, retired M-4): a scope-bound manager may only
      // rate for hotels in their scope claim. Admin/checker unchanged.
      // regional_manager included as defense-in-depth — see verifyAttendance()
      // above for why (C-27 denies RM `quality:write` today).
      if (isScopedManagerRole(actor.role)) {
        const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
        if (!inScope) {
          throw new ForbiddenError('Cannot rate for this hotel');
        }
      } else if (actor.role === 'checker') {
        const checkerAssignment = await tx.workerAssignment.findFirst({
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

      let created;
      try {
        created = await tx.rating.create({
          data: {
            assignment_id,
            hotel_id: assignment.hotel_id,
            worker_id,
            rated_by_id: actor.userId,
            score,
            comment: comment ?? null,
            criteria_scores: criteria_scores
              ? (criteria_scores as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictError('Rating already exists for this assignment');
        }
        throw error;
      }

      await refreshWorkerOverallRating(tx, worker_id);

      // ADR-029 (GD-01, Epic 7 PR 7.3): joins the same transaction as the
      // rating write and aggregate refresh — single commit.
      await notificationService.enqueue(
        {
          recipientId: worker_id,
          type: 'RATING_RECEIVED',
          title: 'You Received a Rating',
          message: `You received a rating of ${score} out of 100.`,
          data: { rating_id: created.id, assignment_id, score },
          hotelId: assignment.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.QUALITY,
          producerService: 'QualityService',
        },
        tx
      );

      return created;
    });

    await this.logAudit(actor.userId, actor.role, 'CREATE_RATING', 'Rating', rating.id, {
      assignment_id,
      worker_id,
      score,
    });

    return rating;
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

    return {
      leaderboard: visibleLeaderboard,
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
