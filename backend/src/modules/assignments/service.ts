import { Prisma, WorkerAssignment, AssignmentStatus, RoomsCompletedEntry } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isWorkerEligibleForHotel } from '../../lib/roster-scope.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import { refreshWorkerOverallRating } from '../quality/service.js';
import {
  AssignmentDto,
  ListAssignmentsQuery,
  LogRoomsCompletedInput,
  RoomsCompletedEntryDto,
  UpdateAssignmentInput,
} from './types.js';

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

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.workerAssignment.update({ where: { id }, data });

      // GD-04: status transitions that affect completion_rate/on_time_rate/
      // last_worked_at (WorkerOverallRating's derived fields) must recompute
      // the aggregate here — it is not the trigger's job anymore, and
      // createRating's own recompute only runs when a Rating is created,
      // which can be long after (or never, relative to) a status change.
      // Keyed on `status` (not e.g. completed_at) because the guard above
      // rejects any call where input.status === assignment.status — so
      // completed_at cannot change independently of a COMPLETED transition
      // today. If a same-status update path is ever added (e.g. correcting
      // completed_at after the fact), this condition must be revisited.
      if (next === AssignmentStatus.COMPLETED || next === AssignmentStatus.CANCELLED) {
        await refreshWorkerOverallRating(tx, assignment.worker_id);
      }

      return result;
    });

    await this.logAudit(actorId, actorRole, 'UPDATE_ASSIGNMENT', 'WORKER_ASSIGNMENT', id, {
      from_status: assignment.status,
      to_status: next,
    });

    return this.toDto(updated);
  }

  private toRoomsCompletedDto(r: RoomsCompletedEntry): RoomsCompletedEntryDto {
    return {
      id: r.id,
      assignment_id: r.assignment_id,
      hotel_id: r.hotel_id,
      worker_id: r.worker_id,
      entered_by_id: r.entered_by_id,
      rooms_completed: r.rooms_completed,
      notes: r.notes,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  }

  // ADR-028 (OQ-ANALYTICS-03): manager-entered "rooms completed" count, one row
  // per worker's full-day WorkerAssignment — not a per-task/per-room record, and
  // not a comparison against any task-start time (CONFIRMED §33 rules out a
  // room-level task layer). Mirrors quality/service.ts createRating's scope-authz
  // shape (Epic 5 PR 5.5 / ADR-024): the manager is bound to the assignment's
  // hotel via the PR 5.4 scope claim when the flag is on; admin is unrestricted.
  async logRoomsCompleted(
    assignmentId: string,
    input: LogRoomsCompletedInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<RoomsCompletedEntryDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, hotel_id: true, worker_id: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (actor.role === 'manager') {
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot log rooms completed for this hotel');
      }
    }

    let entry;
    try {
      entry = await this.prisma.roomsCompletedEntry.create({
        data: {
          assignment_id: assignmentId,
          hotel_id: assignment.hotel_id,
          worker_id: assignment.worker_id,
          entered_by_id: actor.userId,
          rooms_completed: input.rooms_completed,
          notes: input.notes ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Rooms-completed entry already exists for this assignment');
      }
      throw error;
    }

    await this.logAudit(actor.userId, actor.role, 'LOG_ROOMS_COMPLETED', 'ROOMS_COMPLETED_ENTRY', entry.id, {
      assignment_id: assignmentId,
      rooms_completed: input.rooms_completed,
    });

    return this.toRoomsCompletedDto(entry);
  }
}

export const assignmentService = new AssignmentService();
