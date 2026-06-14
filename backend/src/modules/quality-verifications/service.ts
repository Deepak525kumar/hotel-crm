import {
  Prisma,
  QualityVerification,
  VerificationStatus,
  AssignmentStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import {
  CreateVerificationInput,
  ListVerificationsQuery,
  VerificationDto,
} from './types.js';

export class QualityVerificationService extends BaseService {
  private toDto(v: QualityVerification): VerificationDto {
    return {
      id: v.id,
      assignment_id: v.assignment_id,
      hotel_id: v.hotel_id,
      verified_by_id: v.verified_by_id,
      score: v.score,
      status: v.status,
      notes: v.notes,
      photo_urls: v.photo_urls,
      rework_required: v.rework_required,
      rework_notes: v.rework_notes,
      rework_completed_at: v.rework_completed_at?.toISOString() ?? null,
      created_at: v.created_at.toISOString(),
      updated_at: v.updated_at.toISOString(),
    };
  }

  async create(
    input: CreateVerificationInput,
    actorId: string,
    actorRole: string
  ): Promise<VerificationDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: input.assignment_id },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Respect assignment-based workflow: only completed work can be verified.
    if (assignment.status !== AssignmentStatus.COMPLETED) {
      throw new ConflictError('Assignment must be COMPLETED before verification');
    }

    // 1:1 with assignment (assignment_id is @unique)
    const existing = await this.prisma.qualityVerification.findUnique({
      where: { assignment_id: input.assignment_id },
    });
    if (existing) throw new ConflictError('Assignment already has a quality verification');

    const status = (input.status as VerificationStatus | undefined) ?? VerificationStatus.PASSED;

    const v = await this.prisma.qualityVerification.create({
      data: {
        assignment_id: input.assignment_id,
        hotel_id: assignment.hotel_id,
        verified_by_id: actorId,
        score: input.score,
        status,
        notes: input.notes ?? null,
        photo_urls: input.photo_urls ?? [],
        rework_required: input.rework_required ?? status === VerificationStatus.NEEDS_REWORK,
        rework_notes: input.rework_notes ?? null,
      },
    });

    await this.logAudit(actorId, actorRole, 'CREATE', 'QUALITY_VERIFICATION', v.id, {
      assignment_id: input.assignment_id,
      score: input.score,
      status,
    });

    return this.toDto(v);
  }

  async list(
    query: ListVerificationsQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: VerificationDto[]; total: number }> {
    const where: Prisma.QualityVerificationWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.assignment_id ? { assignment_id: query.assignment_id } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    // Non-management roles only see verifications for their own assignments.
    if (actor.role !== 'admin' && actor.role !== 'manager') {
      where.assignment = { worker_id: actor.userId };
    }

    const [records, total] = await Promise.all([
      this.prisma.qualityVerification.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.qualityVerification.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string }
  ): Promise<VerificationDto> {
    const v = await this.prisma.qualityVerification.findUnique({
      where: { id },
      include: { assignment: { select: { worker_id: true } } },
    });
    if (!v) throw new NotFoundError('Quality verification not found');

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      if (v.assignment.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this quality verification');
      }
    }

    return this.toDto(v);
  }
}

export const qualityVerificationService = new QualityVerificationService();
