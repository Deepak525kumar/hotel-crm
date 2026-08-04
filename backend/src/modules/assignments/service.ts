import { Prisma, WorkerAssignment, CalendarEntry, AssignmentStatus, RoomsCompletedEntry } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isWorkerEligibleForHotel } from '../../lib/roster-scope.js';
import { isHotelInScope } from '../../middleware/permissions.js';
// From lib/scope.js, not the middleware re-export — see geo/service.ts's note:
// pure predicates, so suites mocking the permissions middleware need not stub them.
import { isScopedManagerRole, isSelfScopedRole } from '../../lib/scope.js';
import { getPrisma } from '../../lib/db.js';
import type { UserScope } from '../../lib/jwt.js';
import { refreshWorkerOverallRating } from '../quality/service.js';
import {
  AssignmentDto,
  CalendarEntryDto,
  CreateCalendarEntryInput,
  ListAssignmentsQuery,
  ListCalendarEntriesQuery,
  LogRoomsCompletedInput,
  RoomsCompletedEntryDto,
  UpdateAssignmentInput,
} from './types.js';

const ALLOWED_TRANSITIONS: Partial<Record<AssignmentStatus, AssignmentStatus[]>> = {
  [AssignmentStatus.CONFIRMED]: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.CANCELLED],
  [AssignmentStatus.IN_PROGRESS]: [AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED],
};

// Epic 9 PR 9.6 (TREQ-007/TRULE-006, MIG-GAP-08): the same active-status set
// the WorkerAssignment_active_slot_unique partial index enforces DB-side.
// Exported so a future PR 9.9 eligibility computation (or any other reader)
// stays in lock-step with the DB constraint's own status list without
// duplicating it.
export const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.CONFIRMED,
  AssignmentStatus.IN_PROGRESS,
];

/**
 * Read-side enforcement of the daily-exclusivity invariant (TRULE-006): is
 * this worker free (no active-status assignment) on the given day?
 *
 * This is a read-only helper — it does not create, lock, or reserve
 * anything, so it is inherently racy against a concurrent creation on the
 * same worker/day (the DB-level WorkerAssignment_active_slot_unique partial
 * index, re-keyed by this same PR, is the actual source of truth that
 * prevents a double-booking from ever being persisted; this helper exists to
 * let a caller pre-filter candidates cheaply before attempting a write, not
 * to replace the constraint).
 *
 * Added ready for PR 9.9's broadcast-accept eligibility computation to
 * import (skill match ∧ no active assignment that day, per the plan's PR 9.7
 * section) — PR 9.7/9.9's own broadcast/eligibility logic is NOT implemented
 * here, only this helper.
 */
export async function isWorkerFreeOnDay(workerId: string, day: Date): Promise<boolean> {
  const prisma = getPrisma();
  const existing = await prisma.workerAssignment.findFirst({
    where: {
      worker_id: workerId,
      day,
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
    },
    select: { id: true },
  });
  return existing === null;
}

export class AssignmentService extends BaseService {
  private toDto(a: WorkerAssignment): AssignmentDto {
    return {
      id: a.id,
      work_request_id: a.work_request_id,
      worker_id: a.worker_id,
      hotel_id: a.hotel_id,
      assigned_by_id: a.assigned_by_id,
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

    // Workers (and any other self-scoped role) see only their own assignments.
    // isSelfScopedRole() rather than `role !== 'admin' && role !== 'manager'`,
    // which MATCHED regional_manager and silently narrowed an RM to its own
    // rows — see lib/scope.ts for this defect class.
    if (isSelfScopedRole(actor.role)) {
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

    if (isSelfScopedRole(actor.role)) {
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

      // GD-04: not the trigger's job anymore — recompute WorkerOverallRating
      // here on any status change that affects it.
      // Keyed on `status` rather than `completed_at` because
      // SPEC-JOB-DISPATCH-001 (RULE-008, REQ-040) defines COMPLETED/CANCELLED
      // as terminal states and rejects same-status transitions. If the
      // specification changes, revisit this condition (SIR-JOBD-007).
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

    // isScopedManagerRole: ADR-030 §3 C-24 grants regional_manager `✓ᶜ` on
    // assignments and the route gate now admits it — so an RM MUST be
    // scope-checked here. A bare `role === 'manager'` test would have skipped
    // this check entirely for an RM, letting it log rooms completed for any
    // hotel in the platform. isHotelInScope() resolves its hotel_group claim.
    if (isScopedManagerRole(actor.role)) {
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

  private toCalendarEntryDto(c: CalendarEntry): CalendarEntryDto {
    return {
      id: c.id,
      assignment_id: c.assignment_id,
      worker_id: c.worker_id,
      hotel_id: c.hotel_id,
      day: c.day.toISOString().slice(0, 10),
      placed_by_id: c.placed_by_id,
      created_at: c.created_at.toISOString(),
      updated_at: c.updated_at.toISOString(),
    };
  }

  // Epic 9 PR 9.5 (TREQ-001/TRULE-001, MIG-GAP-03): manager places a worker
  // directly on the calendar for a given day — a DIRECT assignment, no
  // accept/decline step, no broadcast fired. Creates WorkerAssignment +
  // CalendarEntry in one transaction. Leaves BOTH work_request_id and
  // job_request_id null — calendar placement has no backing JobRequest at
  // all (per ADR-056; job_request_id is reserved for the future PR 9.9
  // broadcast-accept creation path, not this one).
  //
  // Daily exclusivity (TRULE-006) is now fully enforced DB-side as of Epic 9
  // PR 9.6 (TREQ-007/MIG-GAP-08): the re-keyed WorkerAssignment_active_slot_
  // unique partial index on (worker_id, day) spans every creation path
  // uniformly (this one, and any future PR 9.9 broadcast-accept path), not
  // just this path's own CalendarEntry(worker_id, day) constraint. A P2002
  // from either index surfaces through the same catch below.
  async placeOnCalendar(
    input: CreateCalendarEntryInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ assignment: AssignmentDto; calendar_entry: CalendarEntryDto }> {
    // ADR-030 D-5: regional_manager holds manager's operational capability
    // set at hotel_group scope — isHotelInScope() is role-agnostic, so the
    // same branch that serves 'manager' serves 'regional_manager' correctly
    // (mirrors middleware/permissions.ts's resolveHotelAccess() precedent).
    // Admin is unrestricted (bypass), matching logRoomsCompleted's shape.
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, input.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot place a worker on the calendar for this hotel');
      }
    }

    const day = new Date(`${input.day}T00:00:00.000Z`);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.workerAssignment.create({
          data: {
            work_request_id: null,
            job_request_id: null,
            worker_id: input.worker_id,
            hotel_id: input.hotel_id,
            assigned_by_id: actor.userId,
            status: AssignmentStatus.CONFIRMED,
            // Epic 9 PR 9.6 (TREQ-007/TRULE-006, MIG-GAP-08): populate the
            // denormalized day column directly at creation time -- the
            // migration's backfill only covers rows that existed before it
            // ran; every creation path going forward (this one, and any
            // future PR 9.9 broadcast-accept path) must write `day` itself.
            // Reuses the same parsed `day` value already computed below for
            // CalendarEntry.day, in the same transaction, so both rows agree
            // on the exact date with no risk of drift between them.
            day,
          },
        });

        const calendarEntry = await tx.calendarEntry.create({
          data: {
            assignment_id: assignment.id,
            worker_id: input.worker_id,
            hotel_id: input.hotel_id,
            day,
            placed_by_id: actor.userId,
          },
        });

        return { assignment, calendarEntry };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Worker already has a calendar placement for this day');
      }
      throw error;
    }

    await this.logAudit(actor.userId, actor.role, 'PLACE_ON_CALENDAR', 'CALENDAR_ENTRY', created.calendarEntry.id, {
      assignment_id: created.assignment.id,
      worker_id: input.worker_id,
      hotel_id: input.hotel_id,
      day: input.day,
    });

    return {
      assignment: this.toDto(created.assignment),
      calendar_entry: this.toCalendarEntryDto(created.calendarEntry),
    };
  }

  async listCalendarEntries(
    query: ListCalendarEntriesQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: CalendarEntryDto[]; total: number }> {
    const where: Prisma.CalendarEntryWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
    };

    // Workers see only their own calendar entries; admin/manager may filter
    // by worker_id (mirrors list()'s existing worker-scoping shape).
    if (isSelfScopedRole(actor.role)) {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    const [records, total] = await Promise.all([
      this.prisma.calendarEntry.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { day: 'desc' },
      }),
      this.prisma.calendarEntry.count({ where }),
    ]);

    return { data: records.map((r) => this.toCalendarEntryDto(r)), total };
  }
}

export const assignmentService = new AssignmentService();
