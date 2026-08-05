import {
  Prisma,
  WorkerAssignment,
  CalendarEntry,
  AssignmentStatus,
  RoomsCompletedEntry,
  OutboxSourceModule,
  OutboxTransport,
} from '@prisma/client';
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
import { notificationService } from '../notifications/service.js';
import {
  AssignmentDto,
  CalendarEntryDto,
  CreateCalendarEntryInput,
  ListAssignmentsQuery,
  ListCalendarEntriesQuery,
  LogRoomsCompletedInput,
  MoveCalendarEntryInput,
  ReassignAssignmentInput,
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
    actorRole: string,
    actorScope?: UserScope | null
  ): Promise<AssignmentDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // isSelfScopedRole() rather than `actorRole !== 'admin' && actorRole !==
    // 'manager'`: that shape MATCHED regional_manager, routing an RM through the
    // worker-roster eligibility check (an individual-grain model) instead of
    // treating it as management. ADR-030 §3 C-24 grants RM `✓ᶜ` on assignments.
    if (isSelfScopedRole(actorRole)) {
      if (assignment.worker_id !== actorId) {
        const eligible = await isWorkerEligibleForHotel(actorId, assignment.hotel_id);
        if (!eligible) throw new ForbiddenError('Cannot access this assignment');
      }
    }

    // Product decision, 2026-08-05: a manager/regional_manager may only
    // drive the lifecycle (start/complete/cancel) of an assignment at a
    // hotel within their own scope -- previously unrestricted platform-wide
    // (FIND-SEC-001/OQ-01's original fix explicitly allowed this; this
    // narrows it to match placeOnCalendar()/moveCalendarEntry()'s scoping,
    // the same isScopedManagerRole + isHotelInScope pair used there). Admin
    // remains unrestricted.
    if (isScopedManagerRole(actorRole)) {
      const inScope = await isHotelInScope(actorScope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot access this assignment');
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

      // Job-dispatch lifecycle audit fix (2026-08-05): a cancelled
      // broadcast-accept assignment previously left its
      // JobRequestSkillSlot.confirmed_count permanently incremented, even
      // though the slot is open again -- a headcount-3 slot could get stuck
      // showing 3/3 filled forever after a single cancellation, silently
      // blocking any backfill. skill_slot_id is only ever set by
      // acceptBroadcast(), so this is a no-op for calendar-placed
      // assignments (skill_slot_id null) and never fires for COMPLETED.
      if (next === AssignmentStatus.CANCELLED && assignment.skill_slot_id) {
        await tx.jobRequestSkillSlot.update({
          where: { id: assignment.skill_slot_id },
          data: { confirmed_count: { decrement: 1 } },
        });
      }

      // Job-dispatch lifecycle notification fix (2026-08-05): a cancelled
      // assignment previously notified nobody at all -- a worker's
      // confirmed shift could vanish (manager-cancelled) with zero notice,
      // and a manager never learned when a worker cancelled their own
      // shift. Only the party who did NOT initiate the cancellation is
      // notified -- the actor already knows what they just did.
      if (next === AssignmentStatus.CANCELLED) {
        const isWorkerInitiated = actorId === assignment.worker_id;
        if (!isWorkerInitiated) {
          await notificationService.enqueue(
            {
              recipientId: assignment.worker_id,
              type: 'ASSIGNMENT_CANCELLED',
              title: 'Shift cancelled',
              message: 'Your confirmed shift has been cancelled.',
              data: { assignment_id: id, cancellation_reason: result.cancellation_reason },
              hotelId: assignment.hotel_id,
              transports: [OutboxTransport.PUSH],
              sourceModule: OutboxSourceModule.ASSIGNMENTS,
              producerService: 'AssignmentService',
            },
            tx
          );
        } else {
          await notificationService.enqueue(
            {
              recipientId: assignment.assigned_by_id,
              type: 'ASSIGNMENT_CANCELLED',
              title: 'Worker cancelled their shift',
              message: 'A worker cancelled their own confirmed shift.',
              data: { assignment_id: id, worker_id: assignment.worker_id, cancellation_reason: result.cancellation_reason },
              hotelId: assignment.hotel_id,
              transports: [OutboxTransport.PUSH],
              sourceModule: OutboxSourceModule.ASSIGNMENTS,
              producerService: 'AssignmentService',
            },
            tx
          );
        }
      }

      return result;
    });

    await this.logAudit(actorId, actorRole, 'UPDATE_ASSIGNMENT', 'WORKER_ASSIGNMENT', id, {
      from_status: assignment.status,
      to_status: next,
      // cancellation_reason was saved to the row above but never surfaced
      // in the audit trail.
      ...(next === AssignmentStatus.CANCELLED ? { cancellation_reason: updated.cancellation_reason } : {}),
    });

    return this.toDto(updated);
  }

  // Job-dispatch lifecycle feature (2026-08-05): atomic reassign. Replaces
  // the worker on a CONFIRMED/IN_PROGRESS assignment with a new one, in one
  // transaction, instead of two independent cancel-then-recreate calls that
  // could leave the shift unstaffed between them if the second call failed
  // (or if a concurrent request claimed the now-cancelled slot first).
  // Managerial action only (admin/manager/regional_manager) -- a worker
  // cannot reassign their own shift to someone else; that's a scheduling
  // decision, not a self-service one, unlike cancel/start/complete on
  // AssignmentService.update().
  async reassign(
    id: string,
    input: ReassignAssignmentInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ old_assignment: AssignmentDto; new_assignment: AssignmentDto }> {
    const assignment = await this.prisma.workerAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot reassign an assignment for this hotel');
      }
    }

    if (!ALLOWED_TRANSITIONS[assignment.status]?.includes(AssignmentStatus.CANCELLED)) {
      throw new ConflictError(`Cannot reassign an assignment in status ${assignment.status}`);
    }

    if (input.worker_id === assignment.worker_id) {
      throw new ConflictError('New worker must be different from the currently assigned worker');
    }

    const eligible = await isWorkerEligibleForHotel(input.worker_id, assignment.hotel_id);
    if (!eligible) {
      throw new ForbiddenError('The new worker is not eligible at this hotel');
    }

    const free = await isWorkerFreeOnDay(input.worker_id, assignment.day);
    if (!free) {
      throw new ConflictError('The new worker already has an assignment for this day');
    }

    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const oldAssignment = await tx.workerAssignment.update({
          where: { id },
          data: { status: AssignmentStatus.REASSIGNED },
        });

        // Same broadcast/skill-slot claim carries over to the new worker --
        // reassignment doesn't free the slot (unlike a plain cancel, Bug 3
        // above), it just changes who's filling it. skill_slot_id/
        // job_request_id/work_request_id/hotel_id/day are inherited
        // unchanged; only worker_id, assigned_by_id, and the reassignment
        // chain link differ.
        const newAssignment = await tx.workerAssignment.create({
          data: {
            work_request_id: oldAssignment.work_request_id,
            job_request_id: oldAssignment.job_request_id,
            skill_slot_id: oldAssignment.skill_slot_id,
            worker_id: input.worker_id,
            hotel_id: oldAssignment.hotel_id,
            assigned_by_id: actor.userId,
            status: AssignmentStatus.CONFIRMED,
            day: oldAssignment.day,
            previous_assignment_id: oldAssignment.id,
          },
        });

        // GD-04, same rule update() follows: REASSIGNED is a terminal
        // outcome for the OLD worker that never completes the shift, same
        // aggregate-affecting shape as CANCELLED -- their completion rate
        // must reflect it. The new worker has no rating-affecting event yet
        // (a fresh CONFIRMED row), so only one recompute is needed here.
        await refreshWorkerOverallRating(tx, assignment.worker_id);

        // Job-dispatch lifecycle notification fix (2026-08-05): both
        // affected workers were previously left uninformed -- the old
        // worker's shift silently disappeared, and the new worker had no
        // idea they'd been assigned it.
        await notificationService.enqueue(
          {
            recipientId: assignment.worker_id,
            type: 'ASSIGNMENT_CANCELLED',
            title: 'Shift reassigned',
            message: 'Your shift has been reassigned to another worker.',
            data: { assignment_id: id, new_worker_id: input.worker_id },
            hotelId: assignment.hotel_id,
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.ASSIGNMENTS,
            producerService: 'AssignmentService',
          },
          tx
        );
        await notificationService.enqueue(
          {
            recipientId: input.worker_id,
            type: 'ASSIGNMENT_CONFIRMED',
            title: 'You have been assigned a shift',
            message: "You've been assigned a shift previously held by another worker.",
            data: { assignment_id: newAssignment.id, previous_assignment_id: id },
            hotelId: assignment.hotel_id,
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.ASSIGNMENTS,
            producerService: 'AssignmentService',
          },
          tx
        );

        return { oldAssignment, newAssignment };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('The new worker already has an assignment for this day');
      }
      throw error;
    }

    await this.logAudit(actor.userId, actor.role, 'REASSIGN_ASSIGNMENT', 'WORKER_ASSIGNMENT', result.newAssignment.id, {
      previous_assignment_id: result.oldAssignment.id,
      previous_worker_id: assignment.worker_id,
      new_worker_id: input.worker_id,
    });

    return {
      old_assignment: this.toDto(result.oldAssignment),
      new_assignment: this.toDto(result.newAssignment),
    };
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

  // Calendar grid view: drag/drop scheduling. Day-only move — hotel and
  // worker are unchanged (product decision, 2026-08-05); role/scope gate and
  // hotel-scope check mirror placeOnCalendar() exactly, since a manager/RM
  // moving a placement is authorizing the same "can this actor schedule this
  // worker at this hotel" question create does, just for a different day.
  async moveCalendarEntry(
    calendarEntryId: string,
    input: MoveCalendarEntryInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ assignment: AssignmentDto; calendar_entry: CalendarEntryDto }> {
    const existing = await this.prisma.calendarEntry.findUnique({ where: { id: calendarEntryId } });
    if (!existing) throw new NotFoundError('Calendar entry not found');

    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, existing.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot move a calendar placement for this hotel');
      }
    }

    const day = new Date(`${input.day}T00:00:00.000Z`);

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const calendarEntry = await tx.calendarEntry.update({
          where: { id: calendarEntryId },
          data: { day },
        });
        const assignment = await tx.workerAssignment.update({
          where: { id: existing.assignment_id },
          data: { day },
        });

        // Job-dispatch lifecycle notification fix (2026-08-05): moving a
        // placement to a different day previously notified nobody -- the
        // worker could show up on the original day expecting a shift that
        // was silently relocated.
        await notificationService.enqueue(
          {
            recipientId: existing.worker_id,
            type: 'ASSIGNMENT_CONFIRMED',
            title: 'Shift moved',
            message: 'Your confirmed shift was moved to a different day.',
            data: {
              assignment_id: assignment.id,
              from_day: existing.day.toISOString().slice(0, 10),
              to_day: input.day,
            },
            hotelId: existing.hotel_id,
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.ASSIGNMENTS,
            producerService: 'AssignmentService',
          },
          tx
        );

        return { assignment, calendarEntry };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Worker already has a calendar placement for this day');
      }
      throw error;
    }

    await this.logAudit(actor.userId, actor.role, 'MOVE_CALENDAR_ENTRY', 'CALENDAR_ENTRY', calendarEntryId, {
      assignment_id: updated.assignment.id,
      from_day: existing.day.toISOString().slice(0, 10),
      to_day: input.day,
    });

    return {
      assignment: this.toDto(updated.assignment),
      calendar_entry: this.toCalendarEntryDto(updated.calendarEntry),
    };
  }

  async listCalendarEntries(
    query: ListCalendarEntriesQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: CalendarEntryDto[]; total: number }> {
    const where: Prisma.CalendarEntryWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.from && query.to
        ? { day: { gte: new Date(`${query.from}T00:00:00.000Z`), lte: new Date(`${query.to}T00:00:00.000Z`) } }
        : {}),
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
