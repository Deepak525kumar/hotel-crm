import { AssignmentStatus, CalendarAbsenceKind, EmploymentStatus, OutboxSourceModule, OutboxTransport } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { NotImplementedError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { isWorkerInGroupScope } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import { AssignmentService } from '../assignments/service.js';
import { notificationService } from '../notifications/service.js';
import type { MarkAbsenceInput, CalendarAbsenceDto, AvailabilityDto } from './types.js';

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
  async getDailyOperations(_hotelId: string, _date: string) {
    throw new NotImplementedError('Calendar daily operations are not yet implemented');
  }

  async createDailyOperation(_hotelId: string, _data: Record<string, unknown>) {
    throw new NotImplementedError('Calendar daily operations are not yet implemented');
  }

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
    const today = todayInCalendarTimezone();
    if (input.day < today) {
      throw new ConflictError('Cannot mark a past day sick or vacation');
    }

    // RULE-CAL-03's transition model only states (none) -> sick|vacation and
    // is silent on re-marking an already-marked day. Last write wins (upsert
    // overwrites kind) -- not spec-mandated, but consistent with REQ-CAL-T03's
    // "no cap, no approval" intent: the worker may freely correct their own
    // mark rather than being blocked by a prior one.
    const day = new Date(`${input.day}T00:00:00.000Z`);
    const absence = await this.prisma.calendarAbsence.upsert({
      where: { worker_id_day: { worker_id: workerId, day } },
      create: { worker_id: workerId, day, kind: input.kind as CalendarAbsenceKind },
      update: { kind: input.kind as CalendarAbsenceKind },
    });

    try {
      await this.autoCancelSameDayAssignment(workerId, day);
    } catch (error) {
      logger.error('calendar_absence_auto_cancel_failed', { workerId, day: input.day, error });
    }

    try {
      await this.notifyManager(workerId, input.day, input.kind);
    } catch (error) {
      logger.error('calendar_absence_notify_manager_failed', { workerId, day: input.day, error });
    }

    return this.toDto(absence);
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

    if (!isSelf && actor.role !== 'admin' && actor.role !== 'checker') {
      // Permission matrix (MODULE_SPEC.md): Hotel Manager (their hotel),
      // Regional Manager (their group) -- both resolved via the worker's
      // EmploymentRecord.hotel_group_id, same primitive HR/Attendance use
      // for group-grain worker scoping (lib/scope.ts). Any other role
      // (worker reading someone else, or a role with no scope claim at all)
      // denies -- the permission matrix grants no other role this read.
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
          work_request: { shift_date: today },
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

  private async autoCancelSameDayAssignment(workerId: string, day: Date): Promise<void> {
    const existing = await this.prisma.workerAssignment.findFirst({
      where: {
        worker_id: workerId,
        status: { in: [AssignmentStatus.CONFIRMED, AssignmentStatus.IN_PROGRESS] },
        work_request: { shift_date: day },
      },
    });
    if (!existing) return;

    // RULE-CAL-04/ADR-021: Calendar performs no assignment write itself --
    // delegates to the assignment owner's own service (enforces transitions,
    // recomputes WorkerOverallRating per GD-04, writes the audit log).
    await assignmentService.update(
      existing.id,
      { status: 'CANCELLED', cancellation_reason: 'Worker marked sick/vacation' },
      workerId,
      'worker'
    );
  }

  // Resolves the worker's Hotel Group's Regional Manager as "the responsible
  // manager" (EmploymentRecord/HotelGroup, the current roster model --
  // HotelWorker is retired, ADR-022). Best-effort: an unassigned/inactive
  // worker has no group and no notification is sent, rather than guessing a
  // fallback recipient (OD-CAL-06 leaves the formal contract open).
  private async notifyManager(workerId: string, day: string, kind: string): Promise<void> {
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
    if (!record || record.status !== EmploymentStatus.ACTIVE || !record.hotel_group_id) return;

    const group = await this.prisma.hotelGroup.findUnique({
      where: { id: record.hotel_group_id },
      select: { id: true, regional_manager_user_id: true },
    });
    if (!group) return;

    await notificationService.enqueue({
      recipientId: group.regional_manager_user_id,
      type: 'CALENDAR_ABSENCE_MARKED',
      title: 'Worker marked sick/vacation',
      message: `${worker?.first_name} ${worker?.last_name} marked ${day} as ${kind.toLowerCase()}.`,
      data: { worker_id: workerId, day, kind },
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
    created_at: Date;
    updated_at: Date;
  }): CalendarAbsenceDto {
    return {
      id: a.id,
      worker_id: a.worker_id,
      day: a.day.toISOString().slice(0, 10),
      kind: a.kind,
      created_at: a.created_at.toISOString(),
      updated_at: a.updated_at.toISOString(),
    };
  }
}

export const calendarService = new CalendarService();
