import { Prisma, Rating, AssignmentStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { CreateRatingInput, ListRatingsQuery, RatingDto } from './types.js';

export class RatingService extends BaseService {
  private toDto(r: Rating): RatingDto {
    return {
      id: r.id,
      assignment_id: r.assignment_id,
      hotel_id: r.hotel_id,
      worker_id: r.worker_id,
      rated_by_id: r.rated_by_id,
      score: r.score,
      comment: r.comment,
      criteria_scores: (r.criteria_scores as Record<string, number> | null) ?? null,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  }

  async create(
    input: CreateRatingInput,
    actorId: string,
    actorRole: string
  ): Promise<RatingDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: input.assignment_id },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Respect assignment-based workflow: only completed work can be rated.
    if (assignment.status !== AssignmentStatus.COMPLETED) {
      throw new ConflictError('Assignment must be COMPLETED before rating');
    }

    // 1:1 with assignment (assignment_id is @unique)
    const existing = await this.prisma.rating.findUnique({
      where: { assignment_id: input.assignment_id },
    });
    if (existing) throw new ConflictError('Assignment already has a rating');

    // WorkerOverallRating is refreshed by the DB trigger on Rating insert.
    const r = await this.prisma.rating.create({
      data: {
        assignment_id: input.assignment_id,
        hotel_id: assignment.hotel_id,
        worker_id: assignment.worker_id,
        rated_by_id: actorId,
        score: input.score,
        comment: input.comment ?? null,
        criteria_scores: input.criteria_scores
          ? (input.criteria_scores as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    await this.logAudit(actorId, actorRole, 'CREATE', 'RATING', r.id, {
      assignment_id: input.assignment_id,
      worker_id: assignment.worker_id,
      score: input.score,
    });

    return this.toDto(r);
  }

  async list(
    query: ListRatingsQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: RatingDto[]; total: number }> {
    const where: Prisma.RatingWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.assignment_id ? { assignment_id: query.assignment_id } : {}),
    };

    // Non-management roles only see their own ratings.
    if (actor.role !== 'admin' && actor.role !== 'manager') {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    const [records, total] = await Promise.all([
      this.prisma.rating.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.rating.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string }
  ): Promise<RatingDto> {
    const r = await this.prisma.rating.findUnique({ where: { id } });
    if (!r) throw new NotFoundError('Rating not found');

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      if (r.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this rating');
      }
    }

    return this.toDto(r);
  }
}

export const ratingService = new RatingService();
