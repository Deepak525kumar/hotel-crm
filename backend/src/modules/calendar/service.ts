import { AssignmentStatus, CalendarAbsence, CalendarAbsenceKind, EmploymentStatus, OutboxSourceModule, OutboxTransport } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { isScopedManagerRole, isWorkerInGroupScope, resolveNonAdminScopeFilter } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import { AssignmentService } from '../assignments/service.js';
import {
  ABSENCE_CANCEL_REASON_SELF,
  ABSENCE_CANCEL_REASON_MANAGER,
} from '../../config/constants.js';
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

import { todayInCalendarTimezone } from '../../lib/utils.js';

/**
 * Cancellation reasons written by autoCancelSameDayAssignment(). Constants
 * rather than inline literals because deleteAbsence() reads them back to tell
 * an absence-driven cancellation apart from one a manager made deliberately --
 * two copies of the same string in different methods is exactly the drift this
 * codebase has been bitten by before.
 */
// Defined in config/constants.ts so the quality module can read them without
// closing a calendar -> assignments -> quality import cycle; re-exported here
// because this module is their long-standing import site.
export {
  ABSENCE_CANCEL_REASON_SELF,
  ABSENCE_CANCEL_REASON_MANAGER,
} from '../../config/constants.js';

export class CalendarService extends BaseService {
  // REQ-CAL-T02: worker's own calendar view (this module's absence entries
  // only; assignment facts are read from Job Dispatch/assignments elsewhere).
  async getOwnAbsences(workerId: string): Promise<CalendarAbsenceDto[]> {
    const rows = await this.prisma.calendarAbsence.findMany({
      where: { worker_id: workerId },
      orderBy: { day: 'asc' },
      // Names for the report/UI layers, which carry ids they cannot resolve
      // themselves. Two small joins rather than a second round trip.
      include: {
        worker: { select: { first_name: true, last_name: true } },
        marked_by: { select: { first_name: true, last_name: true } },
      },
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
  /**
   * A sick or vacation day the person marked themselves belongs to them.
   *
   * Owner decision, 2026-08-29: "manager should not be able to move or
   * change worker's or checker's sick leave when the worker or checker has
   * marked the leave himself."
   *
   * The register already had the mirror of this rule -- deleteAbsence()
   * refuses to let a WORKER remove an absence a manager marked on their
   * behalf -- but nothing in the other direction. A manager could silently
   * move, re-kind or delete a worker's own declaration of their own sick
   * day, and the only trace was an AuditLog entry nobody reads until there
   * is a dispute. That is precisely the record it matters most not to be
   * able to rewrite quietly.
   *
   * `marked_by_id == null` counts as self-marked. That is not a guess: the
   * column was added on 2026-08-08
   * (20260808000000_calendar_absence_reason_and_marked_by) with **no
   * backfill**, and until that same change landed there was no
   * manager-on-behalf path at all -- POST /calendar/my-absences was the only
   * writer. So every NULL row was self-service by construction. Going
   * forward NULL can also mean "the manager who marked it has since been
   * deleted" (onDelete: SetNull), which is rare and, for a protection rule,
   * the safe way to be wrong.
   *
   * Note this reads the opposite way from deleteAbsence()'s existing
   * worker-side branch, which treats NULL as "not manager-marked" so a
   * worker is never locked out of their own absence. Both choices resolve
   * the same ambiguity in favour of the WORKER, which is the point.
   *
   * Admin is exempt, matching every other rule in this service ("unscoped by
   * design"): admin is the break-glass role, and a genuinely wrong absence
   * still has to be fixable by someone.
   */
  private assertSelfMarkedAbsenceIsUntouched(
    existing: { worker_id: string; marked_by_id: string | null },
    actor: { userId: string; role: string },
    action: 'move' | 'change' | 'delete'
  ): void {
    const role = actor.role.toLowerCase();
    if (role === 'admin') return;
    // The owner acting on their own absence is the whole point of protecting it.
    if (existing.worker_id === actor.userId) return;

    const selfMarked =
      existing.marked_by_id === null || existing.marked_by_id === existing.worker_id;
    if (!selfMarked) return;

    throw new ForbiddenError(
      `Cannot ${action} an absence the worker marked themselves. Ask them to change it.`
    );
  }

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
    // The upsert below overwrites kind, reason and marked_by_id on an
    // existing row, so "mark on behalf of" is also the CHANGE path -- a
    // manager re-marking a day the worker already claimed as sick would
    // silently replace their declaration. Read before writing.
    const existing = await this.prisma.calendarAbsence.findUnique({
      where: {
        worker_id_day: {
          worker_id: input.worker_id,
          day: new Date(`${input.day}T00:00:00.000Z`),
        },
      },
      select: { worker_id: true, marked_by_id: true },
    });
    if (existing) {
      this.assertSelfMarkedAbsenceIsUntouched(existing, actor, 'change');
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
    const absence = await this.prisma.$transaction(async (tx) => {
      const createdAbsence = await tx.calendarAbsence.upsert({
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
      await this.logAudit(actor.userId, actor.role, 'MARK_ABSENCE', 'CALENDAR_ABSENCE', createdAbsence.id, {
        worker_id: workerId,
        day: input.day,
        kind: input.kind,
      }, undefined, undefined, undefined, tx);

      return createdAbsence;
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

    // Scope says WHICH workers a manager may act on; this says whether this
    // particular absence is theirs to touch at all.
    this.assertSelfMarkedAbsenceIsUntouched(existing, actor, 'move');

    const today = todayInCalendarTimezone();
    if (input.day < today) {
      throw new ConflictError('Cannot move an absence to a past day');
    }

    const day = new Date(`${input.day}T00:00:00.000Z`);

    let updated: CalendarAbsence;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const movedAbsence = await tx.calendarAbsence.update({
          where: { id: absenceId },
          data: { day, marked_by_id: actor.userId },
        });

        await this.logAudit(actor.userId, actor.role, 'MOVE_ABSENCE', 'CALENDAR_ABSENCE', absenceId, {
          worker_id: existing.worker_id,
          from_day: existing.day.toISOString().slice(0, 10),
          to_day: input.day,
        }, undefined, undefined, undefined, tx);

        return movedAbsence;
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

  // Delete an absence (Bug 8)
  async deleteAbsence(
    absenceId: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<void> {
    const existing = await this.prisma.calendarAbsence.findUnique({
      where: { id: absenceId },
    });
    if (!existing) {
      throw new NotFoundError('Absence not found');
    }

    if (actor.role === 'worker') {
      if (existing.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot delete another worker\'s absence');
      }
      // Only a manager-marked absence is off-limits. `marked_by_id` is
      // nullable with onDelete: SetNull (schema.prisma:1404-1405), so a NULL
      // means the marking user's row is gone -- not that a manager marked it.
      // Treating NULL as "somebody else" would lock a worker out of their own
      // absence permanently once that manager was deleted.
      if (existing.marked_by_id != null && existing.marked_by_id !== actor.userId) {
        throw new ForbiddenError('Cannot delete an absence marked by a manager');
      }
    } else if (actor.role !== 'admin') {
      const inScope = await isWorkerInGroupScope(actor.scope ?? null, existing.worker_id);
      if (!inScope) throw new ForbiddenError('Cannot delete this absence');
    }

    // The mirror of the worker-side rule above: that one stops a worker
    // removing a manager's mark, this one stops a manager removing the
    // worker's own. Placed after the scope checks so an out-of-scope manager
    // still gets the scope answer rather than being told what the absence is.
    this.assertSelfMarkedAbsenceIsUntouched(existing, actor, 'delete');

    const today = todayInCalendarTimezone();
    const absenceDay = existing.day.toISOString().slice(0, 10);
    if (absenceDay < today) {
      throw new ConflictError('Cannot delete an absence in the past');
    }

    // Withdrawal gap (2026-08-13): marking an absence auto-cancels that day's
    // shift (autoCancelSameDayAssignment) and decrements the broadcast slot.
    // Withdrawing the absence frees the worker again but deliberately does NOT
    // un-cancel the shift: the slot was released back to the broadcast and may
    // already have been backfilled by someone else, so restoring it could
    // exceed headcount or double-book the day. Re-staffing is a scheduling
    // decision, not something to infer.
    //
    // What WAS missing is that nobody was told. The RM's existing "cancelled"
    // notification says only that the absence went away -- it never mentioned
    // the shift cancelled as a consequence, so an unstaffed shift sat on the
    // calendar with the worker showing as available and no prompt to act.
    const releasedAssignment = await this.prisma.workerAssignment.findFirst({
      where: {
        worker_id: existing.worker_id,
        day: existing.day,
        status: AssignmentStatus.CANCELLED,
        cancellation_reason: {
          in: [ABSENCE_CANCEL_REASON_SELF, ABSENCE_CANCEL_REASON_MANAGER],
        },
      },
      select: { id: true, hotel_id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.calendarAbsence.delete({
        where: { id: absenceId },
      });

      await this.logAudit(actor.userId, actor.role, 'DELETE_ABSENCE', 'CALENDAR_ABSENCE', absenceId, {
        worker_id: existing.worker_id,
        day: absenceDay,
        // Recorded so an audit of the day can see the shift was left cancelled
        // on purpose, rather than the restore having silently failed.
        ...(releasedAssignment
          ? { left_cancelled_assignment_id: releasedAssignment.id }
          : {}),
      }, undefined, undefined, undefined, tx);
    });

    try {
      await this.notifyAboutAbsence(
        existing.worker_id,
        actor.userId,
        absenceDay,
        existing.kind,
        'cancelled',
        releasedAssignment ?? undefined
      );
    } catch (error) {
      logger.error('calendar_absence_notify_failed', { workerId: existing.worker_id, day: absenceDay, error });
    }
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
      // Names for the report/UI layers, which carry ids they cannot resolve
      // themselves. Two small joins rather than a second round trip.
      include: {
        worker: { select: { first_name: true, last_name: true } },
        marked_by: { select: { first_name: true, last_name: true } },
      },
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
            ? ABSENCE_CANCEL_REASON_SELF
            : ABSENCE_CANCEL_REASON_MANAGER,
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
    action: 'marked' | 'moved' | 'cancelled',
    // Set only by deleteAbsence(), when withdrawing the absence leaves behind
    // a shift that was auto-cancelled because of it and is now unstaffed.
    releasedAssignment?: { id: string; hotel_id: string }
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
    let verb = 'marked';
    if (action === 'moved') verb = 'moved';
    if (action === 'cancelled') verb = 'cancelled';

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
      title: releasedAssignment
        ? 'Shift needs re-staffing'
        : actedOnBehalf
          ? 'Worker calendar updated'
          : 'Worker marked sick/vacation',
      message: releasedAssignment
        ? `${worker?.first_name} ${worker?.last_name} is available again on ${day}, but the shift cancelled for that ${kind.toLowerCase()} day was not restored and is still unstaffed.`
        : actedOnBehalf
          ? `${worker?.first_name} ${worker?.last_name}'s ${day} was ${verb} as ${kind.toLowerCase()}.`
          : `${worker?.first_name} ${worker?.last_name} marked ${day} as ${kind.toLowerCase()}.`,
      data: {
        worker_id: workerId,
        day,
        kind,
        marked_by_id: actorId,
        ...(releasedAssignment
          ? {
              cancelled_assignment_id: releasedAssignment.id,
              hotel_id: releasedAssignment.hotel_id,
            }
          : {}),
      },
      transports: [OutboxTransport.PUSH],
      sourceModule: OutboxSourceModule.CALENDAR,
      producerService: 'CalendarService',
    });
  }

  private static personName(u?: { first_name?: string | null; last_name?: string | null } | null) {
    if (!u) return null;
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || null;
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
    worker?: { first_name?: string | null; last_name?: string | null } | null;
    marked_by?: { first_name?: string | null; last_name?: string | null } | null;
  }): CalendarAbsenceDto {
    return {
      id: a.id,
      worker_id: a.worker_id,
      day: a.day.toISOString().slice(0, 10),
      kind: a.kind,
      reason: a.reason,
      marked_by_id: a.marked_by_id,
      worker_name: CalendarService.personName(a.worker),
      marked_by_name: CalendarService.personName(a.marked_by),
      created_at: a.created_at.toISOString(),
      updated_at: a.updated_at.toISOString(),
    };
  }
}

export const calendarService = new CalendarService();
