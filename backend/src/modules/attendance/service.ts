import { Attendance, AttendanceStatus, OutboxSourceModule, OutboxTransport, Prisma } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { notificationService } from '../notifications/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import { AttendanceDto, CheckInInput, ListAttendanceQuery, UpdateAttendanceInput } from './types.js';

export class AttendanceService extends BaseService {
  private toDto(a: Attendance): AttendanceDto {
    return {
      id: a.id,
      assignment_id: a.assignment_id,
      worker_id: a.worker_id,
      hotel_id: a.hotel_id,
      status: a.status,
      check_in_at: a.check_in_at?.toISOString() ?? null,
      check_out_at: a.check_out_at?.toISOString() ?? null,
      expected_start: a.expected_start?.toISOString() ?? null,
      expected_end: a.expected_end?.toISOString() ?? null,
      minutes_late: a.minutes_late,
      minutes_worked: a.minutes_worked,
      notes: a.notes,
      is_verified: a.is_verified,
      verified_by_id: a.verified_by_id,
      verified_at: a.verified_at?.toISOString() ?? null,
      created_at: a.created_at.toISOString(),
      updated_at: a.updated_at.toISOString(),
    };
  }

  async checkIn(
    input: CheckInInput,
    actorId: string,
    actorRole: string
  ): Promise<AttendanceDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: input.assignment_id },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.worker_id !== actorId) {
      throw new ForbiddenError('Can only check in to your own assignment');
    }

    // Find the pre-created EXPECTED attendance record
    const existing = await this.prisma.attendance.findUnique({
      where: { assignment_id: input.assignment_id },
    });
    if (!existing) throw new NotFoundError('Attendance record not found');
    if (existing.status !== AttendanceStatus.EXPECTED) {
      throw new ConflictError('Already checked in');
    }

    const now = new Date();
    const minutesLate = existing.expected_start
      ? Math.max(0, Math.floor((now.getTime() - existing.expected_start.getTime()) / 60000))
      : null;

    const updated = await this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        check_in_at: now,
        status: minutesLate && minutesLate > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        minutes_late: minutesLate,
        notes: input.notes ?? existing.notes,
      },
    });

    await this.logAudit(actorId, actorRole, 'CHECK_IN', 'ATTENDANCE', updated.id, {
      assignment_id: input.assignment_id,
    });

    return this.toDto(updated);
  }

  async list(
    query: ListAttendanceQuery,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ data: AttendanceDto[]; total: number }> {
    const where: Prisma.AttendanceWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.assignment_id ? { assignment_id: query.assignment_id } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.is_verified !== undefined ? { is_verified: query.is_verified } : {}),
    };

    if (actor.role !== 'admin' && actor.role !== 'manager' && actor.role !== 'checker') {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    // Epic 5 PR 5.5 (ADR-024, retired M-4): a manager's list is constrained to
    // the hotels in their PR 5.4 `scope` claim. Admin and checker remain
    // cross-hotel (unchanged); worker is already own-worker-scoped above.
    if (actor.role === 'manager') {
      const scope = actor.scope ?? null;
      if (!scope) {
        // No scope claim -> deny everything (empty-in matches no rows).
        where.hotel_id = { in: [] };
      } else if (scope.type === 'hotel') {
        where.hotel_id = scope.hotel_id;
      } else if (scope.type === 'hotel_group') {
        where.hotel = { hotel_group_id: scope.hotel_group_id };
      }
      // scope.type === 'global' -> no added restriction.
    }

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string }
  ): Promise<AttendanceDto> {
    const record = await this.prisma.attendance.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Attendance record not found');

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      if (record.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this attendance record');
      }
    }

    return this.toDto(record);
  }

  async update(
    id: string,
    input: UpdateAttendanceInput,
    actorId: string,
    actorRole: string,
    actorScope: UserScope | null = null
  ): Promise<AttendanceDto> {
    const record = await this.prisma.attendance.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Attendance record not found');

    // Epic 5 PR 5.5 (ADR-024, retired M-4): a manager may only mutate
    // attendance for hotels in their scope claim. Checked before any
    // mutation. Admin/checker/worker branches below are unchanged.
    if (actorRole === 'manager') {
      const inScope = await isHotelInScope(actorScope, record.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot access this attendance record');
      }
    }

    const isWorker = actorRole !== 'admin' && actorRole !== 'manager' && actorRole !== 'checker';

    if (isWorker) {
      if (record.worker_id !== actorId) {
        throw new ForbiddenError('Cannot modify another worker\'s attendance');
      }
      // Workers may only set check_out_at and notes
      if (
        input.status !== undefined ||
        input.minutes_late !== undefined ||
        input.minutes_worked !== undefined ||
        input.is_verified !== undefined
      ) {
        throw new ForbiddenError('Workers may only set check_out_at and notes');
      }
      if (record.check_in_at === null) {
        throw new ConflictError('Must check in before checking out');
      }
      if (record.check_out_at !== null) {
        throw new ConflictError('Already checked out');
      }
    }

    const data: Prisma.AttendanceUpdateInput = {};

    if (input.check_out_at !== undefined) {
      const checkOutTime = new Date(input.check_out_at);
      data.check_out_at = checkOutTime;
      if (record.check_in_at) {
        data.minutes_worked = Math.max(
          0,
          Math.floor((checkOutTime.getTime() - record.check_in_at.getTime()) / 60000)
        );
      }
    }

    if (input.notes !== undefined) data.notes = input.notes;

    // Manager-only fields
    if (!isWorker) {
      if (input.status !== undefined) data.status = input.status as AttendanceStatus;
      if (input.minutes_late !== undefined) data.minutes_late = input.minutes_late;
      if (input.minutes_worked !== undefined) data.minutes_worked = input.minutes_worked;
      if (input.is_verified === true) {
        data.is_verified = true;
        data.verified_by = { connect: { id: actorId } };
        data.verified_at = new Date();
      }
    }

    // ADR-029 (GD-01, Epic 7 PR 7.3): single commit for the attendance write
    // and its (manager-only) notification enqueue.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.attendance.update({ where: { id }, data });

      if (!isWorker) {
        if (input.is_verified === true) {
          await notificationService.enqueue(
            {
              recipientId: record.worker_id,
              type: 'ATTENDANCE_VERIFIED',
              title: 'Attendance Verified',
              message: 'Your attendance has been verified by a manager.',
              data: { attendance_id: id, assignment_id: record.assignment_id },
              hotelId: record.hotel_id,
              transports: [OutboxTransport.PUSH],
              sourceModule: OutboxSourceModule.ATTENDANCE,
              producerService: 'AttendanceService',
            },
            tx
          );
        } else if (input.status === 'ABSENT') {
          // WORKER_NO_SHOW is manager-facing per schema intent — notify the assignment manager
          const assignment = await tx.workerAssignment.findUnique({
            where: { id: record.assignment_id },
            select: { assigned_by_id: true },
          });
          if (assignment) {
            await notificationService.enqueue(
              {
                recipientId: assignment.assigned_by_id,
                type: 'WORKER_NO_SHOW',
                title: 'Worker No-Show',
                message: 'A worker did not attend their assigned shift.',
                data: { attendance_id: id, assignment_id: record.assignment_id, worker_id: record.worker_id },
                hotelId: record.hotel_id,
                transports: [OutboxTransport.PUSH],
                sourceModule: OutboxSourceModule.ATTENDANCE,
                producerService: 'AttendanceService',
              },
              tx
            );
          }
        }
      }

      return u;
    });

    await this.logAudit(actorId, actorRole, 'UPDATE_ATTENDANCE', 'ATTENDANCE', id, {
      worker_id: record.worker_id,
    });

    return this.toDto(updated);
  }
}

export const attendanceService = new AttendanceService();
