import { AssignmentStatus, CalendarAbsence, CalendarAbsenceKind, EmploymentStatus, OutboxSourceModule, OutboxTransport } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { isScopedManagerRole, isWorkerInGroupScope, resolveNonAdminScopeFilter } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import { AssignmentService } from '../assignments/service.js';
import { notificationService } from '../notifications/service.js';
import type {
  MarkAbsenceInput,
  MarkAbsenceForWorkerInput,
  MoveCalendarAbsenceInput,
  CalendarAbsenceDto,
  AvailabilityDto,
  ListAbsencesQuery,
} from './types.js';

// Calendar depends directly on AssignmentService because GD-12 (event bus)
// is unresolved -- the target design (EVT-CAL-SickVacationMarked) would
// remove this import entirely. Not introducing an interface/port for it now:
// there is exactly one call site and one implementation: premature until a
// second consumer or the event-bus decision actually lands.
const assignmentService = new AssignmentService();

// OD-CAL-04: "today" is anchored to Europe/Berlin (matches Hotel.timezone's
// own default, SPEC-CRM-001) pending a platform-wide timezone decision.
const CALENDAR_TIMEZONE = 'Europe/Berlin';

function todayInCalendarTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIMEZONE }).format(new Date());
}

export class CalendarService extends BaseService {
  // REQ-CAL-T02: worker's own calendar view (this module's absence entries
  // only; assignment facts are read from Job Dispatch/assignments elsewhere).
  async getOwnAbsences(workerId: string): Promise<CalendarAbsenceDto[]> {
    const rows = await this.prisma.calendarAbsence.findMany({
      where: { worker_id: workerId },
      orderBy: { day: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  // REQ-CAL-T03/T04/T08: worker self-marks a current/future day sick or
  // vacation; auto-cancels any existing same-day assignment (RULE-CAL-04);
  // notifies the responsible manager, best-effort (RULE-CAL-06 -- OD-CAL-06
  // is open on the formal transport; reuses the existing notificationService
  // in-process call per the directed narrow scope, not a formal event bus).
  //
  // Per RULE-CAL-04/RULE-CAL-07/MODULE_SPEC.md:214: the absence write is
  // atomic within Calendar's own boundary only. A downstream failure to
  // auto-cancel is reconciled at the assignment locus, not by Calendar --
  // it must never mask the fact that the mark itself succeeded, and must
  // not block the (also best-effort) manager notification.
  async markAbsence(workerId: string, input: MarkAbsenceInput): Promise<CalendarAbsenceDto> {
    return this.markAbsenceInternal(workerId, input, { userId: workerId, role: 'worker' });
  }

  // Manager/RM/admin marks or corrects an absence on a worker's behalf
  // (2026-08-08 feature). Group-scoped the same way every other
  // manager-on-a-worker's-behalf write in this codebase is
  // (isWorkerInGroupScope, e.g. users/service.ts#updateUserProfile,
  // documents/service.ts#getDocument) -- admin unrestricted.
  async markAbsenceForWorker(
    input: MarkAbsenceForWorkerInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<CalendarAbsenceDto> {
    if (actor.role !== 'admin') {
      const inScope = await isWorkerInGroupScope(actor.scope ?? null, input.worker_id);
      if (!inScope) {
        throw new ForbiddenError("Cannot mark this worker's absence");
      }
    }
    const { worker_id, ...rest } = input;
    return this.markAbsenceInternal(worker_id, rest, actor);
  }

  private async markAbsenceInternal(
    workerId: string,
    input: MarkAbsenceInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<CalendarAbsenceDto> {
    const today = todayInCalendarTimezone();
    if (input.day < today) {
      throw new ConflictError('Cannot mark a past day sick or vacation');
    }

    // RULE-CAL-03's transition model only states (none) -> sick|vacation and
    // is silent on re-marking an already-marked day. Last write wins (upsert
    // overwrites kind/reason/marked_by) -- not spec-mandated, but consistent
    // with REQ-CAL-T03's "no cap, no approval" intent: the worker (or now, a
    // manager on their behalf) may freely correct an existing mark rather
    // than being blocked by a prior one.
    const day = new Date(`${input.day}T00:00:00.000Z`);
    const reason = input.reason ?? null;
    const absence = await this.prisma.calendarAbsence.upsert({
      where: { worker_id_day: { worker_id: workerId, day } },
      create: {
        worker_id: workerId,
        day,
        kind: input.kind as CalendarAbsenceKind,
        reason,
        marked_by_id: actor.userId,
      },
      update: { kind: input.kind as CalendarAbsenceKind, reason, marked_by_id: actor.userId },
    });

    // Audit trail (2026-08-08 feature): every calendar-absence write is
    // logged, regardless of actor -- self-service or manager-on-behalf-of.
    await this.logAudit(actor.userId, actor.role, 'MARK_ABSENCE', 'CALENDAR_ABSENCE', absence.id, {
      worker_id: workerId,
      day: input.day,
      kind: input.kind,
    });

    try {
      await this.autoCancelSameDayAssignment(workerId, day, actor);
    } catch (error) {
      logger.error('calendar_absence_auto_cancel_failed', { workerId, day: input.day, error });
    }

    try {
      await this.notifyAboutAbsence(workerId, actor.userId, input.day, input.kind, 'marked');
    } catch (error) {
      logger.error('calendar_absence_notify_failed', { workerId, day: input.day, error });
    }

    return this.toDto(absence);
  }

  // Drag-to-move (2026-08-08 feature): mirrors
  // AssignmentService.moveCalendarEntry()'s shape -- day-only move, same
  // scope check, same P2002-to-ConflictError translation (RULE-CAL-03's
  // one-mark-per-worker-per-day @@unique constraint). Self-service (the
  // owning worker) or a manager/RM/admin acting on the worker's behalf, per
  // the same group-scope rule markAbsenceForWorker() uses.
  async moveAbsence(
    absenceId: string,
    input: MoveCalendarAbsenceInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<CalendarAbsenceDto> {
    const existing = await this.prisma.calendarAbsence.findUnique({ where: { id: absenceId } });
    if (!existing) throw new NotFoundError('Absence not found');

    const isSelf = existing.worker_id === actor.userId;
    if (!isSelf) {
      if (actor.role === 'admin') {
        // unrestricted
      } else if (isScopedManagerRole(actor.role)) {
        const inScope = await isWorkerInGroupScope(actor.scope ?? null, existing.worker_id);
        if (!inScope) throw new ForbiddenError('Cannot move this absence');
      } else {
        throw new ForbiddenError('Cannot move this absence');
      }
    }

    const today = todayInCalendarTimezone();
    if (input.day < today) {
      throw new ConflictError('Cannot move an absence to a past day');
    }

    const day = new Date(`${input.day}T00:00:00.000Z`);

    let updated: CalendarAbsence;
    try {
      updated = await this.prisma.calendarAbsence.update({
        where: { id: absenceId },
        data: { day, marked_by_id: actor.userId },
      });
    } catch (error) {
      const isP2002 =
        error instanceof Object &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002';
      if (isP2002) {
        throw new ConflictError('Worker already has an absence marked for this day');
      }
      throw error;
    }

    await this.logAudit(actor.userId, actor.role, 'MOVE_ABSENCE', 'CALENDAR_ABSENCE', absenceId, {
      worker_id: existing.worker_id,
      from_day: existing.day.toISOString().slice(0, 10),
      to_day: input.day,
    });

    try {
      await this.autoCancelSameDayAssignment(existing.worker_id, day, actor);
    } catch (error) {
      logger.error('calendar_absence_auto_cancel_failed', { workerId: existing.worker_id, day: input.day, error });
    }

    try {
      await this.notifyAboutAbsence(existing.worker_id, actor.userId, input.day, updated.kind, 'moved');
    } catch (error) {
      logger.error('calendar_absence_notify_failed', { workerId: existing.worker_id, day: input.day, error });
    }

    return this.toDto(updated);
  }

  // New (calendar grid view): manager/regional_manager read of absences
  // across their scoped team, admin unrestricted. View-only -- REQ-CAL-T03's
  // self-service-only marking is unchanged, this adds no write path.
  // Scoped the same way listCalendarEntries/analytics's group-filter
  // consumers are (resolveNonAdminScopeFilter -> hotel_group_id), joined
  // through the worker's own EmploymentRecord since CalendarAbsence carries
  // no hotel/group column of its own.
  async listAbsences(
    query: ListAbsencesQuery,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<CalendarAbsenceDto[]> {
    const where: Record<string, unknown> = {
      day: {
        gte: new Date(`${query.from}T00:00:00.000Z`),
        lte: new Date(`${query.to}T00:00:00.000Z`),
      },
    };

    // worker_id narrows within whatever scope is resolved below; it must
    // never be assigned after the scope check, or an explicit worker_id
    // would silently overwrite (and bypass) a deny/group restriction.
    if (query.worker_id) {
      where['worker_id'] = query.worker_id;
    }

    if (actor.role !== 'admin') {
      const filter = await resolveNonAdminScopeFilter(actor.role, actor.scope ?? null);
      if (filter.kind === 'deny') {
        where['worker_id'] = { in: [] };
      } else {
        where['worker'] = { employment_record: { hotel_group_id: filter.hotelGroupId } };
      }
    }

    const rows = await this.prisma.calendarAbsence.findMany({
      where,
      orderBy: { day: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  // REQ-CAL-T06/RULE-CAL-08 (IF-CAL-GetAvailability/v0). Ownership of this
  // read-model is settled to Calendar by ADR-021 ("OD-CAL-01 RESOLVED") --
  // this reads the same-day-assignment fact from Job Dispatch/assignments
  // (WorkerAssignment, already read this way by autoCancelSameDayAssignment
  // above) and this module's own sick/vacation state; it writes neither.
  // Today-only and independent of any viewed calendar date, per RULE-CAL-08.
  async getAvailability(
    workerId: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<AvailabilityDto> {
    const isSelf = actor.userId === workerId;

    if (!isSelf && actor.role !== 'admin') {
      // Permission matrix (MODULE_SPEC.md:226): Hotel Manager (their hotel),
      // Regional Manager (their group) -- both resolved via the worker's
      // EmploymentRecord.hotel_group_id, same primitive HR/Attendance use
      // for group-grain worker scoping (lib/scope.ts).
      //
      // Checker is deliberately NOT given a cross-hotel bypass here, unlike
      // resolveHotelAccess()'s admin/checker bypass for *hotel*-scoped
      // operations. That bypass exists because a checker's quality-review
      // work is legitimately cross-hotel; this permission is worker-centric,
      // not hotel-centric, and the spec's own matrix marks it "checker:
      // (scope)" -- an unspecified scope construct, not "(all)" like admin --
      // while the sibling "View a worker's calendar" row marks checker
      // `[OPEN]` outright (OD-CAL-07 is silent on what a checker's worker-
      // scope would even mean). No checker-specific worker-scope model is
      // currently defined by the frozen specification or implemented in the
      // repository, so this denies checker rather than guessing at one via
      // an unrelated domain's bypass -- fail closed on an open decision,
      // not open.
      if (actor.role !== 'manager' && actor.role !== 'regional_manager') {
        throw new ForbiddenError("Cannot read this worker's availability");
      }
      const inScope = await isWorkerInGroupScope(actor.scope ?? null, workerId);
      if (!inScope) {
        throw new ForbiddenError("Cannot read this worker's availability");
      }
    }

    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { id: true },
    });
    if (!worker) throw new NotFoundError('Worker not found');

    const today = new Date(`${todayInCalendarTimezone()}T00:00:00.000Z`);

    const [assignedToday, absenceToday] = await Promise.all([
      this.prisma.workerAssignment.findFirst({
        where: {
          worker_id: workerId,
          status: { in: [AssignmentStatus.CONFIRMED, AssignmentStatus.IN_PROGRESS] },
          // Denormalized `day`, not the legacy `work_request` relation join
          // (2026-08-07). Neither current assignment-creation path populates
          // work_request_id -- placeOnCalendar() (assignments/service.ts) and
          // acceptBroadcast() (job-requests/service.ts) both set it null --
          // and Prisma's nested to-one filter never matches a row whose
          // relation is null, so this query silently returned nothing for
          // every modern assignment. PR 9.6 moved the codebase to the `day`
          // column for exactly this reason; isWorkerFreeOnDay() already
          // filters on it, and calendar was the last consumer of the old join.
          day: today,
        },
        select: { id: true },
      }),
      this.prisma.calendarAbsence.findUnique({
        where: { worker_id_day: { worker_id: workerId, day: today } },
        select: { id: true },
      }),
    ]);

    return { worker_id: workerId, available: !assignedToday && !absenceToday };
  }

  private async autoCancelSameDayAssignment(
    workerId: string,
    day: Date,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<void> {
    const existing = await this.prisma.workerAssignment.findFirst({
      where: {
        worker_id: workerId,
        status: { in: [AssignmentStatus.CONFIRMED, AssignmentStatus.IN_PROGRESS] },
        // See getAvailability() above for why the relation join matched
        // nothing. The user-visible effect here was worse: marking yourself
        // sick left the shift CONFIRMED, so the manager still saw a staffed
        // slot for someone who would not arrive.
        day,
      },
    });
    if (!existing) return;

    // RULE-CAL-04/ADR-021: Calendar performs no assignment write itself --
    // delegates to the assignment owner's own service (enforces transitions,
    // recomputes WorkerOverallRating per GD-04, writes the audit log).
    //
    // The REAL actor is passed through (2026-08-08 fix), not a hardcoded
    // (workerId, 'worker'). AssignmentService.update() branches its
    // cancellation notification on `actorId === assignment.worker_id`
    // ("only notify the party who did NOT initiate it"), so hardcoding the
    // worker meant a MANAGER marking a worker sick took the
    // worker-initiated branch: the shift was cancelled and the worker was
    // never told, because the code believed they had done it themselves.
    await assignmentService.update(
      existing.id,
      {
        status: 'CANCELLED',
        cancellation_reason:
          actor.userId === workerId
            ? 'Worker marked sick/vacation'
            : 'Marked sick/vacation by a manager',
      },
      actor.userId,
      actor.role,
      // MUST be passed: AssignmentService.update() runs its own
      // isScopedManagerRole -> isHotelInScope check, and a null scope denies.
      // Omitting it made a manager-initiated auto-cancel throw ForbiddenError
      // -- swallowed by the caller's best-effort try/catch, so the shift
      // silently stayed CONFIRMED while the absence was recorded.
      actor.scope ?? null
    );
  }

  // Notifies across whichever direction the actor did NOT already know
  // about (2026-08-08 feature, extending RULE-CAL-06's original
  // worker-marks-self -> notify-manager flow to the new manager-marks-
  // on-worker's-behalf direction too -- "everything marked on calendar
  // should push a notification to the responsible manager AND worker; same
  // for other hierarchies"):
  //   - actor is the worker themself (self-service) -> notify the
  //     responsible Regional Manager only (unchanged behavior).
  //   - actor is someone else (a manager/RM/admin acting on the worker's
  //     behalf) -> notify the WORKER (they weren't the one who acted), and
  //     still notify the RM unless the RM IS the actor (no point notifying
  //     yourself of your own action).
  // "Same scenario for different hierarchies": resolved via the SAME
  // responsible-RM lookup regardless of which hierarchy tier acted --
  // whether a Hotel Manager, Regional Manager, or Admin performed the
  // mark/move, the worker's own Regional Manager is still the one who
  // needs to know, per REQ-EMP-012's group-grain roster model (there is no
  // deeper manager hierarchy below RM in this system to notify instead).
  private async notifyAboutAbsence(
    workerId: string,
    actorId: string,
    day: string,
    kind: string,
    action: 'marked' | 'moved'
  ): Promise<void> {
    const [worker, record] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: workerId },
        select: { first_name: true, last_name: true },
      }),
      this.prisma.employmentRecord.findUnique({
        where: { user_id: workerId },
        select: { status: true, hotel_group_id: true },
      }),
    ]);

    const actedOnBehalf = actorId !== workerId;
    const verb = action === 'moved' ? 'moved' : 'marked';

    if (actedOnBehalf) {
      await notificationService.enqueue({
        recipientId: workerId,
        type: 'CALENDAR_ABSENCE_MARKED_FOR_WORKER',
        title: 'Your calendar was updated',
        message: `A manager ${verb} ${day} as ${kind.toLowerCase()} on your calendar.`,
        data: { worker_id: workerId, day, kind, marked_by_id: actorId },
        transports: [OutboxTransport.PUSH],
        sourceModule: OutboxSourceModule.CALENDAR,
        producerService: 'CalendarService',
      });
    }

    // Best-effort: an unassigned/inactive worker has no group and no RM
    // notification is sent, rather than guessing a fallback recipient
    // (OD-CAL-06 leaves the formal contract open) -- unchanged from the
    // original self-service-only behavior.
    if (!record || record.status !== EmploymentStatus.ACTIVE || !record.hotel_group_id) return;

    const group = await this.prisma.hotelGroup.findUnique({
      where: { id: record.hotel_group_id },
      select: { id: true, regional_manager_user_id: true },
    });
    // Vacancy model (2026-08-06): regional_manager_user_id can now be null
    // if the group is between RMs -- no one to notify, best-effort skip.
    if (!group || !group.regional_manager_user_id) return;
    // The RM acting on their own group's worker already knows -- don't
    // notify them of their own action.
    if (group.regional_manager_user_id === actorId) return;

    await notificationService.enqueue({
      recipientId: group.regional_manager_user_id,
      type: 'CALENDAR_ABSENCE_MARKED',
      title: actedOnBehalf ? 'Worker calendar updated' : 'Worker marked sick/vacation',
      message: actedOnBehalf
        ? `${worker?.first_name} ${worker?.last_name}'s ${day} was ${verb} as ${kind.toLowerCase()}.`
        : `${worker?.first_name} ${worker?.last_name} marked ${day} as ${kind.toLowerCase()}.`,
      data: { worker_id: workerId, day, kind, marked_by_id: actorId },
      transports: [OutboxTransport.PUSH],
      sourceModule: OutboxSourceModule.CALENDAR,
      producerService: 'CalendarService',
    });
  }

  private toDto(a: {
    id: string;
    worker_id: string;
    day: Date;
    kind: CalendarAbsenceKind;
    reason: string | null;
    marked_by_id: string | null;
    created_at: Date;
    updated_at: Date;
  }): CalendarAbsenceDto {
    return {
      id: a.id,
      worker_id: a.worker_id,
      day: a.day.toISOString().slice(0, 10),
      kind: a.kind,
      reason: a.reason,
      marked_by_id: a.marked_by_id,
      created_at: a.created_at.toISOString(),
      updated_at: a.updated_at.toISOString(),
    };
  }
}

export const calendarService = new CalendarService();
