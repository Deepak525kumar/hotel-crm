import { Prisma, WorkerAssignment, AssignmentStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isWorkerEligibleForHotel } from '../../lib/roster-scope.js';
import { AssignmentDto, ListAssignmentsQuery, UpdateAssignmentInput } from './types.js';

const ALLOWED_TRANSITIONS: Partial<Record<AssignmentStatus, AssignmentStatus[]>> = {
  [AssignmentStatus.CONFIRMED]: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.CANCELLED],
  [AssignmentStatus.IN_PROGRESS]: [AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED],
};

export class AssignmentService extends BaseService {
  private toDto(a: WorkerAssignment): AssignmentDto {
    return {
      id: a.id,
      work_request_id: a.work_request_id,
      worker_id: a.worker_id,
      hotel_id: a.hotel_id,
      assigned_by_id: a.assigned_by_id,
      application_id: a.application_id,
      status: a.status,
      confirmed_at: a.confirmed_at.toISOString(),
      started_at: a.started_at?.toISOString() ?? null,
      completed_at: a.completed_at?.toISOString() ?? null,
      cancelled_at: a.cancelled_at?.toISOString() ?? null,
      cancellation_reason: a.cancellation_reason,
      updated_at: a.updated_at.toISOString(),
    };
  }

  async list(
    query: ListAssignmentsQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: AssignmentDto[]; total: number }> {
    const where: Prisma.WorkerAssignmentWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.work_request_id ? { work_request_id: query.work_request_id } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    // Workers see only their own assignments
    if (actor.role !== 'admin' && actor.role !== 'manager') {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    const [records, total] = await Promise.all([
      this.prisma.workerAssignment.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { confirmed_at: 'desc' },
      }),
      this.prisma.workerAssignment.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string }
  ): Promise<AssignmentDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      if (assignment.worker_id !== actor.userId) {
        const eligible = await isWorkerEligibleForHotel(actor.userId, assignment.hotel_id);
        if (!eligible) throw new ForbiddenError('Cannot access this assignment');
      }
    }

    return this.toDto(assignment);
  }

  async update(
    id: string,
    input: UpdateAssignmentInput,
    actorId: string,
    actorRole: string
  ): Promise<AssignmentDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (actorRole !== 'admin' && actorRole !== 'manager') {
      if (assignment.worker_id !== actorId) {
        const eligible = await isWorkerEligibleForHotel(actorId, assignment.hotel_id);
        if (!eligible) throw new ForbiddenError('Cannot access this assignment');
      }
    }

    if (!input.status || input.status === assignment.status) {
      throw new ConflictError('No valid status change requested');
    }

    if (!ALLOWED_TRANSITIONS[assignment.status]?.includes(input.status as AssignmentStatus)) {
      throw new ConflictError(`Cannot transition from ${assignment.status} to ${input.status}`);
    }

    const next = input.status as AssignmentStatus;
    const data: Prisma.WorkerAssignmentUpdateInput = { status: next };

    if (next === AssignmentStatus.IN_PROGRESS) data.started_at = new Date();
    if (next === AssignmentStatus.COMPLETED) data.completed_at = new Date();
    if (next === AssignmentStatus.CANCELLED) {
      data.cancelled_at = new Date();
      data.cancellation_reason = input.cancellation_reason ?? null;
    }

    const updated = await this.prisma.workerAssignment.update({ where: { id }, data });

    await this.logAudit(actorId, actorRole, 'UPDATE_ASSIGNMENT', 'WORKER_ASSIGNMENT', id, {
      from_status: assignment.status,
      to_status: next,
    });

    return this.toDto(updated);
  }
}

export const assignmentService = new AssignmentService();
