import { AssignmentStatus, AttendanceStatus, CalendarAbsenceKind, CalendarEntry, OutboxSourceModule, OutboxTransport, Prisma, RoomsCompletedEntry, WorkerAssignment } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isWorkerEligibleForHotel } from '../../lib/roster-scope.js';
import { escapeLikeTerm } from '../../lib/like-escape.js';
import { isHotelInScope } from '../../middleware/permissions.js';
// From lib/scope.js, not the middleware re-export — see geo/service.ts's note:
// pure predicates, so suites mocking the permissions middleware need not stub them.
import { isScopedManagerRole, isSelfScopedRole } from '../../lib/scope.js';
import { getPrisma } from '../../lib/db.js';
import { getEnv } from '../../config/env.js';
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
  AssignmentHotelDto,
} from './types.js';
import { todayInCalendarTimezone } from '../../lib/utils.js';

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

/**
 * Absence kinds that BLOCK new staffing, enumerated explicitly rather than
 * treating every CalendarAbsence row as blocking.
 *
 * CalendarAbsenceKind is {SICK, VACATION} today, so "any row" and "these
 * two" happen to coincide -- but only coincidentally. If an informational
 * kind is ever added to the enum (TRAINING, NOTE, REMINDER, ...), an
 * implicit "a row exists therefore they are unavailable" test would
 * silently start blocking staffing for something that was never meant to.
 * Adding a kind to the enum must be a deliberate decision to add it here
 * too, not an accident of row existence.
 */
export const BLOCKING_ABSENCE_KINDS: CalendarAbsenceKind[] = [
  CalendarAbsenceKind.SICK,
  CalendarAbsenceKind.VACATION,
];

/**
 * Critical fix (2026-08-08): a worker who marked themselves (or was marked
 * by a manager) SICK or on VACATION for a day could still be placed on a
 * new assignment that same day -- calendar/service.ts's markAbsence()
 * auto-cancels an assignment that ALREADY EXISTS when the absence is
 * marked, but nothing checked the reverse direction: creating a NEW
 * assignment never consulted CalendarAbsence at all. Every worker-
 * assignment creation path (placeOnCalendar, reassign, acceptBroadcast)
 * must call this before creating a row.
 *
 * DAY-GRAIN, NOT TIME-GRAIN. The name is literal: this answers "is this
 * worker absent at all on this calendar day", never "is this worker absent
 * during this shift's hours". CalendarAbsence has no time component -- its
 * `day` column is `@db.Date` and the model stores a whole-day flag, by
 * design (SPEC-CALENDAR-001 REQ-CAL-T08). So a half-day absence cannot be
 * expressed today, and a morning-only sick mark blocks the entire day's
 * staffing, including an evening shift the worker could in principle have
 * worked. That is the accepted MVP behaviour (fail-safe: over-block rather
 * than staff someone who declared themselves unavailable), NOT an
 * oversight. Supporting partial-day absences would need a schema change
 * (start/end time on CalendarAbsence) plus an overlap test against the
 * shift's own window here -- do not assume time-granular behaviour exists.
 *
 * Deliberately a separate helper from isWorkerFreeOnDay() above, not folded
 * into it: that one enforces the active-assignment exclusivity invariant
 * (TRULE-006, backed by a DB unique index); this enforces a distinct
 * business rule (a declared absence blocks new placement) with no DB
 * constraint behind it -- CalendarAbsence and WorkerAssignment are
 * independent tables with no FK between them. Same read-only,
 * pre-filter-only caveat as isWorkerFreeOnDay(): not a replacement for a
 * DB-level guarantee, since none exists for this rule.
 */
export async function isWorkerAbsentOnDay(workerId: string, day: Date): Promise<boolean> {
  const prisma = getPrisma();
  // findFirst + an explicit kind filter, not findUnique on the
  // (worker_id, day) key: the unique key alone would match ANY kind, which
  // is precisely the implicit behaviour BLOCKING_ABSENCE_KINDS exists to
  // avoid.
  const absence = await prisma.calendarAbsence.findFirst({
    where: { worker_id: workerId, day, kind: { in: BLOCKING_ABSENCE_KINDS } },
    select: { id: true },
  });
  return absence !== null;
}

/**
 * Resolves an assignment's scheduled start instant, or null when the
 * assignment has no shift time to resolve.
 *
 * WorkerAssignment carries no start-time column of its own -- a time is only
 * reachable through a linked JobRequest (shift_date + shift_start_time).
 * placeOnCalendar() leaves BOTH work_request_id and job_request_id null
 * (service.ts, calendar-placement branch), so a calendar-placed assignment
 * has a day but no time and returns null here. That is a data-model gap, not
 * an oversight -- tracked in #365. Callers must treat null as "no time-based
 * rule can apply", never as "allowed" or "denied".
 *
 * Timezone: shift_start_time is a bare "HH:MM" wall-clock string and
 * shift_date is date-only, so producing a real instant needs the hotel's
 * zone. Hotel.timezone is used when present, falling back to Europe/Berlin
 * -- the same anchor calendar/service.ts already uses for "today"
 * (OD-CAL-04, pending a platform-wide timezone decision). Deliberately reuses
 * that established fallback rather than inventing a second convention.
 */
export async function resolveScheduledStart(
  tx: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  assignment: { work_request_id: string | null; job_request_id: string | null; hotel_id: string }
): Promise<Date | null> {
  const requestId = assignment.work_request_id ?? assignment.job_request_id;
  if (!requestId) return null;

  const request = await tx.jobRequest.findUnique({
    where: { id: requestId },
    select: { shift_date: true, shift_start_time: true },
  });
  if (!request?.shift_date || !request.shift_start_time) return null;

  const match = /^(\d{2}):(\d{2})$/.exec(request.shift_start_time);
  if (!match) return null;
  const [, hh, mm] = match;

  const hotel = await tx.hotel.findUnique({
    where: { id: assignment.hotel_id },
    select: { timezone: true },
  });
  const zone = hotel?.timezone || 'Europe/Berlin';

  // shift_date is @db.Date -- read it in UTC to get the calendar date without
  // the local-midnight shift a getFullYear()/getMonth() read would introduce.
  const y = request.shift_date.getUTCFullYear();
  const mo = request.shift_date.getUTCMonth() + 1;
  const d = request.shift_date.getUTCDate();

  // Interpret Y-M-D HH:MM as a wall-clock time in `zone`. Build a UTC guess,
  // measure what that instant reads as in the target zone, and correct by the
  // difference. One correction pass is sufficient for fixed offsets and for
  // every DST case except a wall-clock time inside a spring-forward gap,
  // which does not exist and is resolved to the post-transition instant.
  const guess = Date.UTC(y, mo - 1, d, Number(hh), Number(mm));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(guess)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const asRead = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return new Date(guess + (guess - asRead));
}

/**
 * Resolves an assignment's scheduled end instant, accounting for overnight shifts.
 * If shift_end_time < shift_start_time, the end is on the day after shift_date.
 */
export async function resolveScheduledEnd(
  tx: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  assignment: { work_request_id: string | null; job_request_id: string | null; hotel_id: string }
): Promise<Date | null> {
  const requestId = assignment.work_request_id ?? assignment.job_request_id;
  if (!requestId) return null;

  const request = await tx.jobRequest.findUnique({
    where: { id: requestId },
    select: { shift_date: true, shift_start_time: true, shift_end_time: true },
  });
  if (!request?.shift_date || !request.shift_start_time || !request.shift_end_time) return null;

  const startMatch = /^(\d{2}):(\d{2})$/.exec(request.shift_start_time);
  const endMatch = /^(\d{2}):(\d{2})$/.exec(request.shift_end_time);
  if (!startMatch || !endMatch) return null;
  
  const [, startH, startM] = startMatch;
  const [, endH, endM] = endMatch;

  const hotel = await tx.hotel.findUnique({
    where: { id: assignment.hotel_id },
    select: { timezone: true },
  });
  const zone = hotel?.timezone || 'Europe/Berlin';

  const y = request.shift_date.getUTCFullYear();
  const mo = request.shift_date.getUTCMonth() + 1;
  const d = request.shift_date.getUTCDate();

  // If end time is earlier than start time, it's an overnight shift ending the next day
  const isOvernight = (Number(endH) < Number(startH)) || (Number(endH) === Number(startH) && Number(endM) < Number(startM));
  
  const guess = Date.UTC(y, mo - 1, isOvernight ? d + 1 : d, Number(endH), Number(endM));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(guess)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const asRead = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return new Date(guess + (guess - asRead));
}

export class AssignmentService extends BaseService {
  /**
   * Extra, batch-resolved context for the read paths.
   *
   * Optional so the mutation paths (create/update/cancel/...) keep returning the
   * same shape without paying for three extra lookups each; their callers
   * refetch the list or the row afterwards. list() and getById() populate it,
   * which is where clients actually read shift details from.
   */
  private toDto(
    a: WorkerAssignment,
    roomsCompleted: RoomsCompletedEntry | null = null,
    roomsCompletedEnteredByName: string | null = null,
    context: {
      hotel?: AssignmentHotelDto | null;
      shiftStartTime?: string | null;
      shiftEndTime?: string | null;
      assignedByName?: string | null;
      workerName?: string | null;
    } = {}
  ): AssignmentDto {
    return {
      id: a.id,
      work_request_id: a.work_request_id,
      job_request_id: a.job_request_id,
      rework_of_assignment_id: a.rework_of_assignment_id,
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
      rooms_completed: roomsCompleted
        ? this.toRoomsCompletedDto(roomsCompleted, roomsCompletedEnteredByName)
        : null,
      day: AssignmentService.isoDay(a.day),
      hotel: context.hotel ?? null,
      shift_start_time: context.shiftStartTime ?? null,
      shift_end_time: context.shiftEndTime ?? null,
      assigned_by_name: context.assignedByName ?? null,
      worker_name: context.workerName ?? null,
    };
  }

  /**
   * `day` is a Prisma `@db.Date`, which arrives as a Date at UTC midnight.
   * toISOString().slice(0, 10) is therefore the stored calendar day exactly —
   * using a locale formatter here would shift it a day either side of UTC.
   *
   * Tolerates a missing value instead of throwing: the column is non-null, but
   * not every code path that builds a DTO has selected it (and no caller should
   * crash over a display field). Returns null so the client can omit the row
   * rather than render "Invalid Date".
   */
  private static isoDay(day: Date | null | undefined): string | null {
    return day ? day.toISOString().slice(0, 10) : null;
  }

  /** Maps a Hotel row to the narrow shape a worker is allowed to see. */
  private static toHotelDto(h: {
    id: string; name: string; address: string; city: string; country: string;
    timezone: string; latitude: number | null; longitude: number | null;
    contact_phone: string | null; contact_email: string | null;
  }): AssignmentHotelDto {
    return {
      id: h.id, name: h.name, address: h.address, city: h.city, country: h.country,
      timezone: h.timezone, latitude: h.latitude, longitude: h.longitude,
      contact_phone: h.contact_phone, contact_email: h.contact_email,
    };
  }

  /**
   * Resolves hotel, shift times and assigner for one assignment.
   *
   * Used by the write path as well as getById, deliberately. When only the read
   * paths were enriched, the same field was populated on a read and null on a
   * write of the SAME row -- and the web assignment page does
   * `mutate(updated, { revalidate: false })`, writing the mutation response
   * straight into the SWR cache without refetching. Any field rendered from the
   * DTO would blank out the moment a worker tapped Start or Complete.
   *
   * Serving the hotel here rather than making the client call /crm/hotels/:id
   * is deliberate: that endpoint is scoped by the caller's hotel claim and 403s
   * for a worker assigned to the hotel, so the address was unreachable. The
   * ownership gate on each caller already limits which assignment this is.
   *
   * Cost note: update() runs this too, and JobRequestService's cancel-cascade
   * calls update() once per assignment tied to the cancelled request, so a
   * cascade pays three extra primary-key lookups per assignment for a DTO it
   * discards. Accepted rather than adding a "don't enrich" flag: N is bounded
   * by the request's workers_needed, the reads are indexed point lookups, and
   * a mutation response that silently differs from a read is the bug this
   * exists to prevent.
   */
  private async enrichContext(assignment: WorkerAssignment): Promise<{
    hotel: AssignmentHotelDto | null;
    shiftStartTime: string | null;
    shiftEndTime: string | null;
    assignedByName: string | null;
    workerName?: string | null;
  }> {
    const requestId = assignment.job_request_id ?? assignment.work_request_id;
    const [hotel, request, assigner, worker] = await Promise.all([
      this.prisma.hotel.findUnique({
        where: { id: assignment.hotel_id },
        select: AssignmentService.HOTEL_SELECT,
      }),
      requestId
        ? this.prisma.jobRequest.findUnique({
            where: { id: requestId },
            select: { shift_start_time: true, shift_end_time: true },
          })
        : null,
      this.prisma.user.findUnique({
        where: { id: assignment.assigned_by_id },
        select: { first_name: true, last_name: true },
      }),
      // The worker themself. This lookup did not exist until 2026-09-23:
      // `workerName` was declared in this function's return type and never
      // assigned, so `toDto` defaulted it to null and GET /assignments/:id
      // ALWAYS returned a nameless assignment -- while list() populated it
      // correctly from its batched map. A detail screen that cannot name the
      // person whose shift it is was the result, reported as "on that screen
      // I see no details of the shift".
      this.prisma.user.findUnique({
        where: { id: assignment.worker_id },
        select: { first_name: true, last_name: true },
      }),
    ]);
    return {
      hotel: hotel ? AssignmentService.toHotelDto(hotel) : null,
      shiftStartTime: request?.shift_start_time ?? null,
      shiftEndTime: request?.shift_end_time ?? null,
      assignedByName: AssignmentService.fullName(assigner),
      workerName: AssignmentService.fullName(worker),
    };
  }

  /** The columns toHotelDto needs — kept in one place so the call sites cannot drift. */
  private static readonly HOTEL_SELECT = {
    id: true, name: true, address: true, city: true, country: true,
    timezone: true, latitude: true, longitude: true,
    contact_phone: true, contact_email: true,
  } as const;

  async list(
    query: ListAssignmentsQuery,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ data: AssignmentDto[]; total: number }> {
    const where: Prisma.WorkerAssignmentWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.work_request_id ? { work_request_id: query.work_request_id } : {}),
      ...(query.job_request_id ? { job_request_id: query.job_request_id } : {}),
      ...(query.status ? { status: query.status } : {}),
      // `day` is the assignment's own calendar date, which is what a report
      // for "last month" means -- not created_at.
      ...(query.from && query.to
        ? { day: { gte: new Date(`${query.from}T00:00:00.000Z`), lte: new Date(`${query.to}T23:59:59.999Z`) } }
        : {}),
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

    // IDOR fix (2026-08-08): list() ran no manager-scope check at all --
    // update()/reassign()/placeOnCalendar() in this same file already scope
    // a manager/regional_manager to their own hotel/hotel_group claim, but
    // list() let a manager read every assignment platform-wide.
    if (isScopedManagerRole(actor.role)) {
      const scope = actor.scope ?? null;
      if (!scope) {
        where.hotel_id = { in: [] };
      } else if (scope.type === 'hotel') {
        where.hotel_id = scope.hotel_id;
      } else if (scope.type === 'hotel_group') {
        where.hotel = { hotel_group_id: scope.hotel_group_id };
      }
      // scope.type === 'global' -> no added restriction.
    }

    // Free-text search (owner decision, 2026-08-30), pushed to the database
    // rather than filtered on the client: this endpoint is paginated, so
    // filtering the page the client happens to hold would report "none found"
    // while the match sat on page 3.
    //
    // Added under AND rather than as `where.OR`. The scope block above may
    // already have set `where.hotel` (hotel_group scope), and a top-level OR
    // carrying its own `hotel` clause would overwrite that key -- turning a
    // manager's scoped list into a platform-wide one. AND nests instead of
    // colliding, so the search can never widen what the actor may see.
    const term = query.q?.trim();
    if (term) {
      const contains = { contains: escapeLikeTerm(term), mode: 'insensitive' as const };
      where.AND = [
        {
          OR: [
            { worker: { first_name: contains } },
            { worker: { last_name: contains } },
            { hotel: { name: contains } },
            { hotel: { city: contains } },
          ],
        },
      ];
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

    // Batched, not N+1: one query for the whole page rather than one per row.
    const roomsCompletedEntries = records.length
      ? await this.prisma.roomsCompletedEntry.findMany({
          where: { assignment_id: { in: records.map((r) => r.id) } },
        })
      : [];
    const roomsCompletedByAssignment = new Map(
      roomsCompletedEntries.map((rc) => [rc.assignment_id, rc])
    );

    // review follow-up (PR #395 item A): resolve entered_by_id -> display
    // name for the whole page in one batched query, same shape as the
    // roomsCompletedEntries lookup above -- one findMany() for however many
    // distinct enterers appear on this page, not one per row.
    const entererIds = Array.from(
      new Set(roomsCompletedEntries.map((rc) => rc.entered_by_id))
    );
    const enterers = entererIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: entererIds } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
    const entererById = new Map(enterers.map((u) => [u.id, u]));

    // Batched exactly like the two lookups above -- one query each for the
    // whole page, never one per row. Without these the API returned bare ids
    // and no client could tell the worker where or when the shift was.
    const hotelIdsOnPage = [...new Set(records.map((r) => r.hotel_id))];
    const jobRequestIdsOnPage = [
      ...new Set(records.map((r) => r.job_request_id ?? r.work_request_id).filter((v): v is string => !!v)),
    ];
    // Worker ids resolved in the SAME query as assigner ids: the DTO carried
    // no worker name, so every consumer had to look it up, and the reports
    // module -- which must not reach into Users -- could not, and emitted
    // nulls. One union of ids, one findMany, no extra round trip.
    const assignerIds = [
      ...new Set([
        ...records.map((r) => r.assigned_by_id),
        ...records.map((r) => r.worker_id),
      ].filter((v): v is string => Boolean(v))),
    ];

    const [hotelsOnPage, jobRequestsOnPage, assigners] = await Promise.all([
      hotelIdsOnPage.length
        ? this.prisma.hotel.findMany({
            where: { id: { in: hotelIdsOnPage } },
            select: AssignmentService.HOTEL_SELECT,
          })
        : [],
      jobRequestIdsOnPage.length
        ? this.prisma.jobRequest.findMany({
            where: { id: { in: jobRequestIdsOnPage } },
            select: { id: true, shift_start_time: true, shift_end_time: true },
          })
        : [],
      assignerIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: assignerIds } },
            select: { id: true, first_name: true, last_name: true },
          })
        : [],
    ]);
    const hotelById = new Map(hotelsOnPage.map((h) => [h.id, AssignmentService.toHotelDto(h)]));
    const jobRequestById = new Map(jobRequestsOnPage.map((j) => [j.id, j]));
    const assignerById = new Map(assigners.map((u) => [u.id, u]));

    return {
      data: records.map((r) => {
        const roomsCompleted = roomsCompletedByAssignment.get(r.id) ?? null;
        const enteredByName = roomsCompleted
          ? AssignmentService.fullName(entererById.get(roomsCompleted.entered_by_id))
          : null;
        const request = jobRequestById.get(r.job_request_id ?? r.work_request_id ?? '');
        return this.toDto(r, roomsCompleted, enteredByName, {
          hotel: hotelById.get(r.hotel_id) ?? null,
          shiftStartTime: request?.shift_start_time ?? null,
          shiftEndTime: request?.shift_end_time ?? null,
          assignedByName: AssignmentService.fullName(assignerById.get(r.assigned_by_id) ?? null),
          workerName: AssignmentService.fullName(assignerById.get(r.worker_id) ?? null),
        });
      }),
      total,
    };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<AssignmentDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Hotel eligibility answers "could this worker be assigned here", never
    // "is this worker's assignment" -- ownership is the gate (IDOR fix).
    if (isSelfScopedRole(actor.role) && assignment.worker_id !== actor.userId) {
      throw new ForbiddenError('Cannot access this assignment');
    } else if (isScopedManagerRole(actor.role)) {
      // IDOR fix (2026-08-08): same gap as list() above -- a manager/RM
      // could read any single assignment by id, unscoped.
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) throw new ForbiddenError('Cannot access this assignment');
    }

    const roomsCompleted = await this.prisma.roomsCompletedEntry.findUnique({
      where: { assignment_id: id },
    });
    const enteredByName = roomsCompleted
      ? AssignmentService.fullName(
          await this.prisma.user.findUnique({
            where: { id: roomsCompleted.entered_by_id },
            select: { first_name: true, last_name: true },
          })
        )
      : null;

    return this.toDto(assignment, roomsCompleted, enteredByName, await this.enrichContext(assignment));
  }

  async update(
    id: string,
    input: UpdateAssignmentInput,
    actorId: string,
    actorRole: string,
    actorScope?: UserScope | null,
    internalBypass: boolean = false
  ): Promise<AssignmentDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // isSelfScopedRole() rather than `actorRole !== 'admin' && actorRole !==
    // 'manager'`: that shape MATCHED regional_manager, routing an RM through the
    // worker-roster eligibility check (an individual-grain model) instead of
    // treating it as management. ADR-030 §3 C-24 grants RM `✓ᶜ` on assignments.
    if (isSelfScopedRole(actorRole)) {
      // Same ownership gate as getById() above (IDOR fix): hotel eligibility
      // answers "could be assigned", never "is theirs".
      if (assignment.worker_id !== actorId) {
        throw new ForbiddenError('Cannot access this assignment');
      } else if (
        input.status === AssignmentStatus.IN_PROGRESS ||
        input.status === AssignmentStatus.COMPLETED
      ) {
        // Self-action eligibility (2026-08-07). The branch above only checked
        // eligibility when a worker acted on SOMEONE ELSE's assignment, so a
        // worker acting on their OWN skipped the check entirely -- and
        // starting/completing your own shift is the common case, not the
        // edge case.
        //
        // That let a worker who had since been DEACTIVATED, or blocklisted
        // at this specific hotel, still start and complete the shift. Both
        // verified reachable before this fix. The blocklist case is the
        // sharper one: EmployeeBlocklistEntry enforcement was deliberately
        // wired into isWorkerEligibleForHotel() (REQ-EMP-005 / RULE-EMP-07)
        // precisely so a blocked worker could not work that hotel, and this
        // path bypassed it.
        //
        // Scoped to IN_PROGRESS/COMPLETED -- the transitions that mean "I am
        // working this shift". CANCELLED is deliberately NOT gated: a worker
        // who has lost eligibility must still be able to drop the shift, and
        // blocking that would strand the assignment CONFIRMED with nobody
        // able to release it.
        const stillEligible = await isWorkerEligibleForHotel(actorId, assignment.hotel_id);
        if (!stillEligible) {
          throw new ForbiddenError('You are no longer eligible to work at this hotel');
        }
        
        // Bug 35 (Critical): Block workers from manually marking assignments IN_PROGRESS or COMPLETED
        // via the assignment API. Only the Attendance module (via internal service calls) or
        // administrative roles should be able to perform these transitions.
        if (actorRole === 'worker' && !internalBypass) {
          throw new ForbiddenError('Workers must use the Attendance module to start or complete shifts');
        }
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

    // Early-start guard (2026-08-07). A shift could previously be started at
    // any time -- ALLOWED_TRANSITIONS validated only the state machine, with
    // no comparison against the shift's own scheduled start. Reuses the same
    // window as the attendance check-in guard
    // (ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES, default 2h) so "how early is
    // too early" has ONE answer across both paths rather than drifting.
    //
    // Applies only where a scheduled start actually exists. A calendar-placed
    // assignment has a day but no time (no linked JobRequest), so
    // resolveScheduledStart() returns null and no time rule can be applied --
    // deliberately skipped, not silently allowed. Tracked in #365; that gap
    // is a data-model limitation, not an exemption anyone chose.
    if (next === AssignmentStatus.IN_PROGRESS) {
      const scheduledStart = await resolveScheduledStart(this.prisma, assignment);
      if (scheduledStart) {
        const graceMinutes = getEnv().ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES;
        const minutesEarly = Math.floor((scheduledStart.getTime() - Date.now()) / 60000);
        if (minutesEarly > graceMinutes) {
          throw new ConflictError(
            `Cannot start this shift yet: it is scheduled to begin in ${minutesEarly} minutes. ` +
              `A shift may be started at most ${graceMinutes / 60} hours before its scheduled start.`
          );
        }
      }
      data.started_at = new Date();
    }
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
      // The attendance row is created EXPECTED when the shift is assigned, and
      // only a check-in ever moved it. A cancelled shift therefore left
      // attendance asserting the worker was still expected -- indefinitely,
      // and visibly wrong on the worker's own attendance list.
      //
      // EXCUSED rather than deleted: the row is the record that the shift
      // existed and was called off, which reports need to tell apart from a
      // no-show. Scoped to EXPECTED so a shift cancelled after the worker had
      // already checked in keeps its PRESENT/LATE evidence.
      if (next === AssignmentStatus.CANCELLED) {
        await tx.attendance.updateMany({
          where: { assignment_id: assignment.id, status: AttendanceStatus.EXPECTED },
          data: { status: AttendanceStatus.EXCUSED, updated_at: new Date() },
        });
      }

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

    return this.toDto(updated, null, null, await this.enrichContext(updated));
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

    // Critical fix (2026-08-08): block reassigning to a worker who has a
    // declared SICK/VACATION absence on this day.
    if (await isWorkerAbsentOnDay(input.worker_id, assignment.day)) {
      throw new ConflictError('The new worker has a sick/vacation absence marked for this day');
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

        // The outgoing worker's placement must be retired before the incoming
        // one is written. CalendarEntry is @@unique([worker_id, day]) and the
        // old assignment is only marked REASSIGNED (never deleted), so its
        // entry survives the status change and would otherwise:
        //   - keep rendering the old worker on the calendar grid against a
        //     REASSIGNED assignment, double-counting staffing for the day; and
        //   - occupy (old_worker, day) forever, so reassigning a shift back to
        //     that worker on that day trips the unique constraint and returns
        //     a false "already has an assignment for this day" 409 --
        //     isWorkerFreeOnDay() reads WorkerAssignment, where REASSIGNED
        //     counts as free, so nothing else catches the contradiction.
        // deleteMany (not delete): an assignment created via acceptBroadcast
        // may never have had a CalendarEntry at all.
        await tx.calendarEntry.deleteMany({ where: { assignment_id: oldAssignment.id } });

        await tx.calendarEntry.create({
          data: {
            assignment_id: newAssignment.id,
            worker_id: input.worker_id,
            hotel_id: oldAssignment.hotel_id,
            day: oldAssignment.day,
            placed_by_id: actor.userId,
          },
        });

        // GD-04, same rule update() follows: REASSIGNED is a terminal
        // outcome for the OLD worker that never completes the shift, same
        // aggregate-affecting shape as CANCELLED -- their completion rate
        // must reflect it.
        await refreshWorkerOverallRating(tx, assignment.worker_id);
        // Correction (2026-08-07): this previously refreshed ONLY the old
        // worker, reasoning that "the new worker has no rating-affecting
        // event yet (a fresh CONFIRMED row)". That is wrong --
        // refreshWorkerOverallRating() computes total_assignments as a count
        // of ALL the worker's rows regardless of status
        // (quality/service.ts:41), so a fresh CONFIRMED row IS
        // aggregate-affecting. Worse, the upsert there is the only creator of
        // a WorkerOverallRating row, so a worker whose sole activity is being
        // reassigned onto shifts had no row at all and was missing from the
        // leaderboard entirely.
        await refreshWorkerOverallRating(tx, input.worker_id);

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

  // enteredByName is a separate param (not a relation include on `r`) so
  // every call site chooses its own fetch shape: list() batches one
  // findMany() for the whole page rather than an include per row, while the
  // single-record paths (getById, logRoomsCompleted, updateRoomsCompleted)
  // fetch just the one name they need.
  private toRoomsCompletedDto(
    r: RoomsCompletedEntry,
    enteredByName: string | null = null
  ): RoomsCompletedEntryDto {
    return {
      id: r.id,
      assignment_id: r.assignment_id,
      hotel_id: r.hotel_id,
      worker_id: r.worker_id,
      entered_by_id: r.entered_by_id,
      entered_by_name: enteredByName,
      rooms_completed: r.rooms_completed,
      notes: r.notes,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    };
  }

  private static fullName(u: { first_name: string; last_name: string } | null | undefined): string | null {
    return u ? `${u.first_name} ${u.last_name}` : null;
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
      select: { id: true, hotel_id: true, worker_id: true, status: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // 2026-08-09: the model exists to record a POST-shift count (ADR-028's
    // own framing), so logging one before the shift has finished doesn't
    // describe anything real yet. Checked before the scope gate below so a
    // manager gets the same clear error regardless of whether they'd also
    // fail the scope check.
    if (assignment.status !== AssignmentStatus.COMPLETED) {
      throw new ConflictError('Rooms completed can only be logged for a completed assignment');
    }

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

    // entered_by_id === actor.userId here always (just created above), so
    // this is a lookup of the acting user's own name -- same one-record cost
    // getById() already pays for an existing entry, not a new query shape.
    const enteredByName = AssignmentService.fullName(
      await this.prisma.user.findUnique({
        where: { id: actor.userId },
        select: { first_name: true, last_name: true },
      })
    );

    return this.toRoomsCompletedDto(entry, enteredByName);
  }

  // 2026-08-09: correction path for an already-logged rooms-completed entry.
  // POST above stays strict-create/409-on-repeat (its existing, tested
  // contract, unchanged) -- this is a separate endpoint rather than turning
  // POST into an upsert, so the "second POST always 409s" behavior already
  // relied upon elsewhere keeps working exactly as before.
  async updateRoomsCompleted(
    assignmentId: string,
    input: LogRoomsCompletedInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<RoomsCompletedEntryDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, hotel_id: true, status: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (assignment.status !== AssignmentStatus.COMPLETED) {
      throw new ConflictError('Rooms completed can only be edited for a completed assignment');
    }

    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot edit rooms completed for this hotel');
      }
    }

    const existing = await this.prisma.roomsCompletedEntry.findUnique({
      where: { assignment_id: assignmentId },
    });
    if (!existing) {
      throw new NotFoundError('No rooms-completed entry exists for this assignment yet');
    }

    const updated = await this.prisma.roomsCompletedEntry.update({
      where: { assignment_id: assignmentId },
      data: {
        rooms_completed: input.rooms_completed,
        notes: input.notes ?? null,
      },
    });

    await this.logAudit(
      actor.userId,
      actor.role,
      'UPDATE_ROOMS_COMPLETED',
      'ROOMS_COMPLETED_ENTRY',
      updated.id,
      { assignment_id: assignmentId, rooms_completed: input.rooms_completed }
    );

    // entered_by_id is NOT necessarily actor.userId here -- a PATCH can
    // correct an entry someone else originally logged (any in-scope
    // manager/RM/admin may edit, per this method's own scope gate above), so
    // the name resolved must be the ORIGINAL enterer's (updated.entered_by_id
    // is unchanged by this update), not the editing actor's.
    const enteredByName = AssignmentService.fullName(
      await this.prisma.user.findUnique({
        where: { id: updated.entered_by_id },
        select: { first_name: true, last_name: true },
      })
    );

    return this.toRoomsCompletedDto(updated, enteredByName);
  }

  private toCalendarEntryDto(
    c: CalendarEntry & {
      worker?: { id: string; first_name: string; last_name: string } | null;
      hotel?: { id: string; name: string; city: string } | null;
    },
    assignmentStatus?: AssignmentStatus
  ): CalendarEntryDto {
    return {
      ...(assignmentStatus ? { assignment_status: assignmentStatus } : {}),
      id: c.id,
      assignment_id: c.assignment_id,
      worker_id: c.worker_id,
      hotel_id: c.hotel_id,
      day: c.day.toISOString().slice(0, 10),
      placed_by_id: c.placed_by_id,
      // Nested by the list path's own include, so this costs no extra query.
      // Absent on create/move, where the relations are not loaded.
      worker: c.worker ?? null,
      hotel: c.hotel ?? null,
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

    // REQ-EMP-005 / RULE-EMP-07 rework (2026-08-06): unlike reassign()
    // (line ~315) and broadcast-accept (job-requests/service.ts), manual
    // calendar placement never checked whether the WORKER being placed is
    // eligible at this hotel at all -- only whether the acting manager is.
    // A manager could place a worker outside their own hotel group, or one
    // this hotel had explicitly blocklisted, with no check catching either.
    // isWorkerEligibleForHotel() covers both (group-grain eligibility, per
    // roster-scope.ts's module doc comment, plus the blocklist check added
    // in this same change).
    const workerEligible = await isWorkerEligibleForHotel(input.worker_id, input.hotel_id);
    if (!workerEligible) {
      throw new ForbiddenError('This worker is not eligible at this hotel');
    }

    const today = todayInCalendarTimezone();
    if (input.day < today) {
      throw new ConflictError('Cannot place an assignment in the past');
    }

    const day = new Date(`${input.day}T00:00:00.000Z`);

    // Critical fix (2026-08-08): block placement on a day the worker has a
    // declared SICK/VACATION absence -- see isWorkerAbsentOnDay()'s doc
    // comment above for why this is a separate check from the eligibility
    // ones above it.
    if (await isWorkerAbsentOnDay(input.worker_id, day)) {
      throw new ConflictError('Worker has a sick/vacation absence marked for this day');
    }

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

        // Aggregate refresh (2026-08-07): total_assignments counts ALL of a
        // worker's rows regardless of status (quality/service.ts:41), so
        // creating one here changes it. Without this, placeOnCalendar() left
        // the aggregate stale -- and since the upsert in
        // refreshWorkerOverallRating() is the only creator of a
        // WorkerOverallRating row, a worker who had only ever been placed on
        // a calendar had no row at all and never appeared on the leaderboard.
        await refreshWorkerOverallRating(tx, input.worker_id);

        const calendarEntry = await tx.calendarEntry.create({
          data: {
            assignment_id: assignment.id,
            worker_id: input.worker_id,
            hotel_id: input.hotel_id,
            day,
            placed_by_id: actor.userId,
          },
        });

        // Notify the worker that they have been placed on the calendar (Bug fix).
        await notificationService.enqueue(
          {
            recipientId: input.worker_id,
            type: 'ASSIGNMENT_CONFIRMED',
            title: 'You have been assigned a shift',
            message: 'A manager has scheduled you for a shift.',
            data: { assignment_id: assignment.id },
            hotelId: input.hotel_id,
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
  //
  // 2026-08-13 integration-audit fixes (E2E review of calendar/assignments/
  // job-requests found this method was the one creation/mutation path that
  // never went through either of the two checks every OTHER path enforces):
  //
  //  1. isWorkerAbsentOnDay() was never consulted. placeOnCalendar(),
  //     reassign(), and acceptBroadcast() all block scheduling a worker onto
  //     a day they've declared SICK/VACATION; a drag-and-drop move onto such
  //     a day sailed through with no check at all.
  //
  //  2. A broadcast-accepted assignment (skill_slot_id set) kept counting
  //     against its ORIGINAL day's broadcast slot after being dragged to a
  //     different day -- moveCalendarEntry only ever touched
  //     CalendarEntry.day/WorkerAssignment.day, never skill_slot_id or the
  //     slot's confirmed_count. Two compounding failures followed: the
  //     original day's broadcast reads permanently "filled" for a worker who
  //     is no longer coming, and if that worker later cancels (including via
  //     calendar/service.ts's own auto-cancel-on-sick-mark), the cancellation
  //     path decrements confirmed_count on the ORIGINAL slot -- restocking a
  //     broadcast for a day that was never actually vacated by this move.
  //     Fixed by detaching the assignment from the broadcast the moment its
  //     day changes: decrement the original slot's confirmed_count and clear
  //     skill_slot_id/job_request_id, converting it into a plain calendar
  //     placement (the identical null/null shape placeOnCalendar() already
  //     produces) that stands on its own from here on -- exactly the
  //     "cleanly detach" option, not blocking the move outright, since a
  //     manager rescheduling a shift by a day is a legitimate action and the
  //     broadcast that originally sourced the worker has no further claim on
  //     where they end up.
  async moveCalendarEntry(
    calendarEntryId: string,
    input: MoveCalendarEntryInput,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ assignment: AssignmentDto; calendar_entry: CalendarEntryDto }> {
    const existing = await this.prisma.calendarEntry.findUnique({ where: { id: calendarEntryId } });
    if (!existing) throw new NotFoundError('Calendar entry not found');

    const currentAssignment = await this.prisma.workerAssignment.findUnique({
      where: { id: existing.assignment_id },
    });
    if (!currentAssignment) throw new NotFoundError('Assignment not found');

    if (
      currentAssignment.status === AssignmentStatus.CANCELLED ||
      currentAssignment.status === AssignmentStatus.COMPLETED ||
      currentAssignment.status === AssignmentStatus.REASSIGNED
    ) {
      throw new ConflictError(`Cannot move an assignment in status ${currentAssignment.status}`);
    }

    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, existing.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot move a calendar placement for this hotel');
      }
    }

    const today = todayInCalendarTimezone();
    if (input.day < today) {
      throw new ConflictError('Cannot move an assignment to the past');
    }

    const day = new Date(`${input.day}T00:00:00.000Z`);
    const dayIsChanging = existing.day.getTime() !== day.getTime();

    // Fix 1: same absence check every other creation/move path enforces.
    if (dayIsChanging && (await isWorkerAbsentOnDay(existing.worker_id, day))) {
      throw new ConflictError('Worker has a sick/vacation absence marked for this day');
    }

    // Fix 2: detach from the original broadcast slot when the day actually
    // moves. Read outside the transaction (used to decide what to write
    // inside it); re-read is unnecessary since skill_slot_id is immutable
    // once set (only this code path or acceptBroadcast() ever touch it, and
    // this is the only writer of a null-ing transition).
    const detachingFromBroadcast = dayIsChanging && currentAssignment.skill_slot_id !== null;

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        // Re-read the status inside the transaction. The guard above runs on a
        // row read before the transaction opened, so a concurrent cancel or
        // completion landing in that window would otherwise be overwritten --
        // and this path carries no optimistic `version` check (ADR-036) to
        // catch it. Re-checking here makes the terminal-status guard binding
        // rather than advisory.
        const fresh = await tx.workerAssignment.findUnique({
          where: { id: existing.assignment_id },
          select: { status: true },
        });
        if (!fresh) throw new NotFoundError('Assignment not found');
        if (
          fresh.status === AssignmentStatus.CANCELLED ||
          fresh.status === AssignmentStatus.COMPLETED ||
          fresh.status === AssignmentStatus.REASSIGNED
        ) {
          throw new ConflictError(`Cannot move an assignment in status ${fresh.status}`);
        }

        const calendarEntry = await tx.calendarEntry.update({
          where: { id: calendarEntryId },
          data: { day },
        });

        const assignmentData: Prisma.WorkerAssignmentUpdateInput = { day };
        if (detachingFromBroadcast) {
          assignmentData.skill_slot = { disconnect: true };
          assignmentData.job_request = { disconnect: true };
        }
        const assignment = await tx.workerAssignment.update({
          where: { id: existing.assignment_id },
          data: assignmentData,
        });

        if (detachingFromBroadcast && currentAssignment.skill_slot_id) {
          await tx.jobRequestSkillSlot.update({
            where: { id: currentAssignment.skill_slot_id },
            data: { confirmed_count: { decrement: 1 } },
          });
        }

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
      ...(detachingFromBroadcast ? { detached_from_skill_slot_id: currentAssignment.skill_slot_id } : {}),
    });

    return {
      assignment: this.toDto(updated.assignment),
      calendar_entry: this.toCalendarEntryDto(updated.calendarEntry),
    };
  }

  async listCalendarEntries(
    query: ListCalendarEntriesQuery,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ data: CalendarEntryDto[]; total: number }> {
    const where: Prisma.CalendarEntryWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.from && query.to
        ? { day: { gte: new Date(`${query.from}T00:00:00.000Z`), lte: new Date(`${query.to}T00:00:00.000Z`) } }
        : {}),
      // 2026-08-13 fix ("ghost shifts", found in E2E audit and confirmed
      // live on the production calendar grid): this query read CalendarEntry
      // in complete isolation from its 1:1 WorkerAssignment, so a shift
      // cancelled through ANY path -- a manager cancelling it directly, a
      // worker cancelling their own, or calendar/service.ts's own
      // auto-cancel-on-sick-mark -- left its CalendarEntry row exactly as-is.
      // The grid kept showing a fully-staffed placement for a shift nobody
      // was coming to. CANCELLED and REASSIGNED are both "this worker is not
      // the one working this day anymore" outcomes (REASSIGNED's replacement
      // is a brand-new WorkerAssignment with no CalendarEntry link of its
      // own today -- a pre-existing, separate gap, not one this fix expands
      // or narrows); COMPLETED/IN_PROGRESS/CONFIRMED/NO_SHOW all still mean
      // "this placement is real," so only these two are excluded.
      //
      // 2026-08-13 follow-up: the original fix excluded CANCELLED too, which
      // over-corrected -- a shift cancelled by a sick-leave mark then vanished
      // from the grid with no trace, so a manager could not see that the day
      // had lost its cover. CANCELLED is now returned and carries its status
      // through to the DTO so the grid can render it as a cancelled card.
      // REASSIGNED stays excluded: its replacement assignment is a different
      // row, so showing it would double-count the day.
      assignment: { status: { not: AssignmentStatus.REASSIGNED } },
    };

    // Workers see only their own calendar entries; admin/manager may filter
    // by worker_id (mirrors list()'s existing worker-scoping shape).
    if (isSelfScopedRole(actor.role)) {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    // IDOR fix (2026-08-10): this method ran NO manager-scope check at all --
    // it took `query.hotel_id` straight from the client and applied it as the
    // only hotel constraint, so a manager/RM could read any hotel's entire
    // placement roster just by passing someone else's hotel_id (or omit it
    // and read every hotel platform-wide). This is the identical defect that
    // list() in this same file had fixed on 2026-08-08 -- that fix was never
    // applied here.
    //
    // Applied AFTER the client-supplied hotel_id above, and deliberately
    // overwriting/intersecting it rather than being skipped when one is
    // present: an out-of-scope hotel_id must narrow to nothing, never widen.
    if (isScopedManagerRole(actor.role)) {
      const scope = actor.scope ?? null;
      if (!scope) {
        // Fail closed: a scoped manager role with no scope claim sees nothing,
        // rather than everything.
        where.hotel_id = { in: [] };
      } else if (scope.type === 'hotel') {
        // A hotel-scoped manager is pinned to their own hotel. If they asked
        // for a different one, the intersection is empty by construction.
        where.hotel_id =
          query.hotel_id && query.hotel_id !== scope.hotel_id ? { in: [] } : scope.hotel_id;
      } else if (scope.type === 'hotel_group') {
        // Group-scoped (RM): constrain to hotels in their own group. A
        // client-supplied hotel_id still applies on top (both conditions must
        // hold), so requesting a hotel outside the group yields nothing.
        where.hotel = { hotel_group_id: scope.hotel_group_id };
      }
      // scope.type === 'global' -> no additional restriction.
    }

    const [records, total] = await Promise.all([
      this.prisma.calendarEntry.findMany({
        where,
        include: {
          assignment: { select: { status: true } },
          // One query, not a second round trip: the rows are already being
          // fetched and the relations are narrow (identity only).
          worker: { select: { id: true, first_name: true, last_name: true } },
          hotel: { select: { id: true, name: true, city: true } },
        },
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { day: 'desc' },
      }),
      this.prisma.calendarEntry.count({ where }),
    ]);

    return {
      data: records.map((r) => this.toCalendarEntryDto(r, r.assignment?.status)),
      total,
    };
  }

  /**
   * Sweeps CONFIRMED assignments that are past their shift end
   * time by more than the configured grace period, marking them as NO_SHOW.
   * Calendar-placed assignments (no JobRequest) are marked NO_SHOW if their
   * calendar day is strictly before today in UTC.
   */
  async sweepShiftReminders(): Promise<number> {
    const now = new Date();
    // 70 minutes from now
    const cutoff = new Date(now.getTime() + 70 * 60 * 1000);
    
    // Look back 1 day and forward 2 days to account for timezones
    const minDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const maxDay = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const candidates = await this.prisma.workerAssignment.findMany({
      where: {
        status: AssignmentStatus.CONFIRMED,
        shift_reminder_sent_at: null,
        day: {
          gte: minDay,
          lte: maxDay,
        },
      },
      // Unlike every sibling sweep job (no-show, session, retention, ...),
      // this had no batch cap at all -- an unbounded findMany re-run every
      // 5 minutes. Bounded here rather than left open: any candidate this
      // cap defers is still a candidate next sweep (shift_reminder_sent_at
      // stays null until it is actually notified), so a large backlog only
      // delays a reminder by another 5-minute cycle, never drops it.
      take: 500,
    });

    let notifiedCount = 0;
    for (const assignment of candidates) {
      if (assignment.work_request_id || assignment.job_request_id) {
        const shiftStart = await resolveScheduledStart(this.prisma, assignment);
        
        // If the shift is starting in less than 70 minutes and is still in the future
        if (shiftStart && shiftStart <= cutoff && shiftStart > now) {
          await this.prisma.$transaction(async (tx) => {
            // Use updateMany for atomic check-and-set to prevent race conditions
            // if multiple background worker instances are running
            const result = await tx.workerAssignment.updateMany({
              where: { 
                id: assignment.id, 
                status: AssignmentStatus.CONFIRMED, 
                shift_reminder_sent_at: null 
              },
              data: { shift_reminder_sent_at: new Date() },
            });

            if (result.count === 1) {
              await notificationService.enqueue({
                recipientId: assignment.worker_id,
                type: 'SHIFT_REMINDER',
                title: 'Upcoming Shift',
                message: `Reminder: Your shift is starting in about 1 hour.`,
                data: { assignment_id: assignment.id },
                transports: [OutboxTransport.PUSH],
                sourceModule: OutboxSourceModule.ASSIGNMENTS,
                producerService: 'AssignmentService',
              }, tx);
              
              notifiedCount++;
            }
          });
        }
      }
    }
    return notifiedCount;
  }

  async sweepNoShows(gracePeriodMs: number, batchSize: number): Promise<number> {
    const cutoff = new Date(Date.now() - gracePeriodMs);

    // Only CONFIRMED shifts can be marked as NO_SHOW. If it's IN_PROGRESS,
    // the worker checked in, so they did show up.
    const candidates = await this.prisma.workerAssignment.findMany({
      where: {
        status: AssignmentStatus.CONFIRMED,
      },
      take: batchSize,
    });

    let updatedCount = 0;
    for (const assignment of candidates) {
      let isExpired = false;

      if (assignment.work_request_id || assignment.job_request_id) {
        const shiftEnd = await resolveScheduledEnd(this.prisma, assignment);
        if (shiftEnd && shiftEnd < cutoff) {
          isExpired = true;
        }
      } else {
        const endOfDay = new Date(assignment.day);
        endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
        if (endOfDay < cutoff) {
          isExpired = true;
        }
      }

      if (isExpired) {
        try {
          await this.prisma.$transaction(async (tx) => {
            // Re-check status within transaction to avoid race conditions
            const current = await tx.workerAssignment.findUnique({ where: { id: assignment.id } });
            if (current?.status !== AssignmentStatus.CONFIRMED) return;

            await tx.workerAssignment.update({
              where: { id: assignment.id },
              data: { status: AssignmentStatus.NO_SHOW, updated_at: new Date() },
            });

            // The attendance row is created EXPECTED when the shift is assigned
            // and only ever moved by a check-in. A worker who never checks in
            // therefore left it EXPECTED forever -- the assignment said NO_SHOW
            // while attendance still claimed the shift was upcoming, and the
            // two views of the same shift disagreed permanently.
            //
            // Scoped to EXPECTED: a row already PRESENT/LATE means a check-in
            // happened and must not be overwritten by a sweep.
            await tx.attendance.updateMany({
              where: { assignment_id: assignment.id, status: AttendanceStatus.EXPECTED },
              data: { status: AttendanceStatus.ABSENT, updated_at: new Date() },
            });

            // Recompute rating since NO_SHOW is a terminal outcome that hurts completion rate
            await refreshWorkerOverallRating(tx, assignment.worker_id);
            
            // Log the audit event using the system user (null actor or special system string)
            await this.logAudit(
              null, // actor_id
              null, // actor_role
              'UPDATE_ASSIGNMENT', 
              'WORKER_ASSIGNMENT', 
              assignment.id, 
              {
                from_status: AssignmentStatus.CONFIRMED,
                to_status: AssignmentStatus.NO_SHOW,
              }, 
              undefined, // ip_address
              undefined, // old_values
              undefined, // new_values
              tx
            );
            
            updatedCount++;
          });
        } catch (error) {
          // Log error but continue with other candidates
          console.error(`Failed to sweep assignment ${assignment.id} to NO_SHOW:`, error);
        }
      }
    }

    return updatedCount;
  }
}

export const assignmentService = new AssignmentService();
