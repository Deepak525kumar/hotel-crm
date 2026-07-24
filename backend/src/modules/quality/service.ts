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
import { isScopeAuthzEnabled } from '../../config/feature-flags.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import type { CreateQualityVerificationRequest, CreateRatingRequest } from './types.js';

interface Actor {
  userId: string;
  role: string;
  scope?: UserScope | null;
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

    // Epic 5 PR 5.5 (ADR-024): a manager may only verify attendance for hotels
    // in their scope claim when scope-authz is enabled. Admin/checker unchanged.
    if (isScopeAuthzEnabled() && actor.role === 'manager') {
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot verify attendance for this hotel');
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
        select: { id: true, hotel_id: true, worker_id: true },
      });
      if (!assignment) {
        throw new NotFoundError('Assignment not found');
      }
      if (assignment.worker_id !== worker_id) {
        throw new ForbiddenError('worker_id does not match the assignment worker');
      }

      // Epic 5 PR 5.5 (ADR-024): a manager may only rate for hotels in their
      // scope claim when scope-authz is enabled. Admin/checker unchanged.
      if (isScopeAuthzEnabled() && actor.role === 'manager') {
        const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
        if (!inScope) {
          throw new ForbiddenError('Cannot rate for this hotel');
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

      const [agg, totalAssignments, completedAssignments, onTimeAttendance, lastWorked] =
        await Promise.all([
          tx.rating.aggregate({
            where: { worker_id },
            _avg: { score: true },
            _count: true,
          }),
          tx.workerAssignment.count({ where: { worker_id } }),
          tx.workerAssignment.count({
            where: { worker_id, status: AssignmentStatus.COMPLETED },
          }),
          tx.attendance.count({
            where: { worker_id, status: AttendanceStatus.PRESENT },
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
      };

      await tx.workerOverallRating.upsert({
        where: { worker_id },
        create: { worker_id, ...aggregateData },
        update: aggregateData,
      });

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

  async getLeaderboard(hotelId: string) {
    let where: Record<string, unknown> = {};
    if (hotelId) {
      const hotel = await this.prisma.hotel.findUnique({
        where: { id: hotelId },
        select: { hotel_group_id: true },
      });
      where = {
        worker: {
          employment_record: { hotel_group_id: hotel?.hotel_group_id ?? '__none__', status: 'ACTIVE' },
        },
      };
    }

    return this.prisma.workerOverallRating.findMany({
      where,
      include: {
        worker: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
      orderBy: { average_score: 'desc' },
      take: 50,
    });
  }
}

export const qualityService = new QualityService();
