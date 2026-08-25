import { Attendance, AttendanceStatus, OutboxSourceModule, OutboxTransport, Prisma } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { notificationService } from '../notifications/service.js';
import { geoService } from '../geo/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import { getEnv } from '../../config/env.js';
// From lib/scope.js, not the middleware re-export — see geo/service.ts's note:
// pure predicates, so suites mocking the permissions middleware need not stub them.
import { isScopedManagerRole, isSelfScopedRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import { AttendanceDto, CheckInInput, ListAttendanceQuery, UpdateAttendanceInput,
  AttendancePersonDto,
  AttendanceHotelDto,
} from './types.js';
import { assignmentService, resolveScheduledStart } from '../assignments/service.js';
import { AssignmentStatus } from '@prisma/client';
import { todayInCalendarTimezone } from '../../lib/utils.js';

export class AttendanceService extends BaseService {
  /**
   * `context` is optional so the mutation paths (checkIn/checkOut/verify/...)
   * keep their current cost and shape; their callers refetch. list() and
   * getById() populate it, which is where the checker app reads from.
   */
  private toDto(
    a: Attendance,
    context: {
      worker?: AttendancePersonDto | null;
      hotel?: AttendanceHotelDto | null;
      verifiedByName?: string | null;
    } = {}
  ): AttendanceDto {
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
      worker: context.worker ?? null,
      hotel: context.hotel ?? null,
      verified_by_name: context.verifiedByName ?? null,
    };
  }

  /** The columns every enrichment call site selects — kept together so they cannot drift. */
  private static readonly PERSON_SELECT = { id: true, first_name: true, last_name: true } as const;
  private static readonly HOTEL_SELECT = { id: true, name: true, city: true } as const;

  /**
   * Resolves the names for one record.
   *
   * Used by the mutation paths as well as getById, deliberately. Leaving writes
   * un-enriched made the same field populated on a read and null on a write of
   * the SAME row, and the checker app assigns the verify() response straight
   * into state — so tapping "Verify" erased the worker name and hotel that had
   * just been on screen. A DTO field that means "not loaded" in one response and
   * "no such worker" in another is not a contract a client can use.
   */
  private async enrichContext(record: Attendance): Promise<{
    worker: AttendancePersonDto | null;
    hotel: AttendanceHotelDto | null;
    verifiedByName: string | null;
  }> {
    const [worker, hotel, verifier] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: record.worker_id }, select: AttendanceService.PERSON_SELECT }),
      this.prisma.hotel.findUnique({ where: { id: record.hotel_id }, select: AttendanceService.HOTEL_SELECT }),
      record.verified_by_id
        ? this.prisma.user.findUnique({ where: { id: record.verified_by_id }, select: AttendanceService.PERSON_SELECT })
        : null,
    ]);
    return {
      worker,
      hotel,
      verifiedByName: verifier ? `${verifier.first_name} ${verifier.last_name}`.trim() : null,
    };
  }

  async checkIn(
    input: CheckInInput,
    actorId: string,
    actorRole: string,
    actorIp?: string
  ): Promise<AttendanceDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: input.assignment_id },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.worker_id !== actorId) {
      throw new ForbiddenError('Can only check in to your own assignment');
    }

    // Find the pre-created EXPECTED attendance record, or lazily create it (Bug 23)
    let existing = await this.prisma.attendance.findUnique({
      where: { assignment_id: input.assignment_id },
    });

    if (!existing) {
      const expectedStart = await resolveScheduledStart(this.prisma, assignment);
      let expectedEnd: Date | null = null;
      
      if (expectedStart && assignment.job_request_id) {
        const jobReq = await this.prisma.jobRequest.findUnique({
          where: { id: assignment.job_request_id },
          select: { shift_start_time: true, shift_end_time: true },
        });
        if (jobReq?.shift_start_time && jobReq?.shift_end_time) {
          const [sh, sm] = jobReq.shift_start_time.split(':').map(Number);
          const [eh, em] = jobReq.shift_end_time.split(':').map(Number);
          let durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
          if (durationMinutes < 0) durationMinutes += 24 * 60;
          expectedEnd = new Date(expectedStart.getTime() + durationMinutes * 60000);
        }
      }

      try {
        existing = await this.prisma.attendance.create({
          data: {
            assignment_id: assignment.id,
            worker_id: assignment.worker_id,
            hotel_id: assignment.hotel_id,
            status: AttendanceStatus.EXPECTED,
            expected_start: expectedStart,
            expected_end: expectedEnd,
          },
        });
      } catch (e: any) {
        // Handle concurrent check-ins racing to create the same attendance row
        if (e.code === 'P2002') {
          existing = await this.prisma.attendance.findUniqueOrThrow({
            where: { assignment_id: input.assignment_id },
          });
        } else {
          throw e;
        }
      }
    }

    if (existing.status !== AttendanceStatus.EXPECTED) {
      throw new ConflictError('Already checked in');
    }

    // GD-14 (SPEC-GEO-001): CRM owns hotel coordinates, Geo owns the distance
    // verification (IF-GEO-DISTANCE-CHECK via GeoService.verifyGeofence;
    // Attendance never recomputes the haversine distance itself). Whether
    // location is *required* is decided from the hotel's own configuration,
    // never from whether the client happened to send coordinates -- a worker
    // who denies location permission on a geofenced hotel is not the same as
    // a hotel with no geofence configured, and must not be treated as if it
    // were (that would let denying permission silently bypass the geofence).
    if (input.latitude !== undefined && input.longitude !== undefined) {
      const verification = await geoService.verifyGeofence(
        actorId,
        { hotel_id: assignment.hotel_id, latitude: input.latitude, longitude: input.longitude },
        actorRole,
        actorIp,
        existing.id
      );

      if (verification.status === 'verified' && !verification.insideRadius) {
        await this.logAudit(actorId, actorRole, 'CHECK_IN_DENIED_GEOFENCE', 'ATTENDANCE', existing.id, {
          assignment_id: input.assignment_id,
          distance_meters: verification.distanceMeters,
        });
        throw new ForbiddenError('Check-in denied: outside the hotel geofence');
      }
    } else if (await geoService.isGeofenceConfigured(assignment.hotel_id)) {
      await this.logAudit(actorId, actorRole, 'CHECK_IN_DENIED_GEOFENCE', 'ATTENDANCE', existing.id, {
        assignment_id: input.assignment_id,
        reason: 'location_not_supplied',
      });
      throw new ForbiddenError('Location permission is required to check in at this hotel');
    }

    const now = new Date();

    // Deferred-bug batch (2026-08-07): workers were able to check in an
    // unbounded amount of time before their shift, with no upper bound at
    // all. RULE-002 (early arrival still resolves PRESENT, not LATE) stays
    // intact for arrivals inside this window; only arrivals earlier than the
    // window are rejected. Configurable (ATTENDANCE_EARLY_CHECK_IN_GRACE_
    // MINUTES, default 2h per user direction) rather than hardcoded, same
    // convention as every other business-rule threshold in config/env.ts.
    let minutesLate: number | null = null;
    let isLate = false;

    if (existing.expected_start) {
      const graceMinutes = getEnv().ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES;
      const minutesEarly = Math.floor(
        (existing.expected_start.getTime() - now.getTime()) / 60000
      );
      
      if (minutesEarly > graceMinutes) {
        await this.logAudit(actorId, actorRole, 'CHECK_IN_DENIED_TOO_EARLY', 'ATTENDANCE', existing.id, {
          assignment_id: input.assignment_id,
          minutes_early: minutesEarly,
        });
        throw new ForbiddenError(
          `Check-in denied: too early. Check-in opens ${graceMinutes / 60} hours before the shift starts.`
        );
      }

      // Bug 14: Implement configurable tardiness grace period.
      const tardyGraceMinutes = getEnv().ATTENDANCE_TARDY_GRACE_MINUTES;
      const lateThreshold = new Date(existing.expected_start.getTime() + tardyGraceMinutes * 60000);
      isLate = now > lateThreshold;
      minutesLate = Math.max(0, Math.floor((now.getTime() - existing.expected_start.getTime()) / 60000));
    } else {
      // Bug 34 fix: Handle calendar-placed shifts (which have no expected_start)
      const calendarEntry = await this.prisma.calendarEntry.findUnique({
        where: { assignment_id: assignment.id },
      });
      
      if (!calendarEntry) {
        throw new ForbiddenError('Check-in denied: shift lacks a scheduled start time and is not a calendar placement. Contact your manager.');
      }

      const hotel = await this.prisma.hotel.findUnique({ where: { id: assignment.hotel_id } });
      const todayStr = todayInCalendarTimezone(hotel?.timezone || 'Europe/Berlin').split('T')[0];
      const shiftDayStr = calendarEntry.day.toISOString().split('T')[0];

      if (shiftDayStr! > todayStr!) {
        throw new ForbiddenError('Check-in denied: too early. This calendar shift is scheduled for a future day.');
      } else if (shiftDayStr! < todayStr!) {
        throw new ForbiddenError('Check-in denied: this calendar shift was scheduled for a past day.');
      }
      
      // If it's today, check-in is allowed. No tardiness applies.
    }

    // Review fix: compare-and-swap via updateMany's WHERE clause (same
    // pattern as hr/service.ts's fulfilPayslipRequest() review fix,
    // mirroring ADR-057's first-accept-wins precedent in
    // job-requests/service.ts). The status check above (line 52) is a
    // fast-path rejection for the common case; this WHERE clause is what
    // actually prevents two concurrent checkIn() calls for the same
    // assignment from both passing the geofence gate and then both
    // unconditionally overwriting the same Attendance row (last-write-wins,
    // duplicate CHECK_IN audit entries).
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.attendance.updateMany({
        where: { id: existing.id, status: AttendanceStatus.EXPECTED },
        data: {
          check_in_at: now,
          status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          minutes_late: minutesLate,
          notes: input.notes ?? existing.notes,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictError('Already checked in');
      }

      const u = await tx.attendance.findUniqueOrThrow({ where: { id: existing.id } });

      await this.logAudit(
        actorId,
        actorRole,
        'CHECK_IN',
        'ATTENDANCE',
        u.id,
        { assignment_id: input.assignment_id },
        undefined,
        { status: existing.status, check_in_at: existing.check_in_at, minutes_late: existing.minutes_late },
        { status: u.status, check_in_at: u.check_in_at, minutes_late: u.minutes_late },
        tx
      );
      
      return u;
    });

    // Bug 35 (Critical): Sync the assignment state so workers don't bypass attendance
    await assignmentService.update(
      input.assignment_id,
      { status: AssignmentStatus.IN_PROGRESS },
      actorId,
      actorRole,
      null,
      true // internalBypass = true
    );

    return this.toDto(updated, await this.enrichContext(updated));
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

    // `checkerIsSelfScoped: false` preserves this module's existing behaviour —
    // checker is cross-hotel here, unchanged. The change is that
    // regional_manager no longer matches the self-scoped branch: the previous
    // `role !== 'admin' && role !== 'manager' && role !== 'checker'` test
    // narrowed an RM to its own attendance rows, while the
    // `role === 'manager'` filter below skipped its hotel_group narrowing —
    // a 200 with the wrong rows in both directions. ADR-030 §3 C-26 grants RM
    // `✓ᶜ` on attendance.
    if (isSelfScopedRole(actor.role, { checkerIsSelfScoped: false })) {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    // Epic 5 PR 5.5 (ADR-024, retired M-4): a scope-bound manager's list is
    // constrained to the hotels in their PR 5.4 `scope` claim — hotel scope for
    // a Hotel Manager, hotel_group for a Regional Manager. Admin and checker
    // remain cross-hotel (unchanged); worker is already own-worker-scoped above.
    if (isScopedManagerRole(actor.role)) {
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

    // Batched: one query each for the whole page, never one per row. Without
    // these the checker app could only render the tail of a cuid where a
    // worker's name belongs.
    const workerIds = [...new Set(records.map((r) => r.worker_id))];
    const hotelIds = [...new Set(records.map((r) => r.hotel_id))];
    const verifierIds = [...new Set(records.map((r) => r.verified_by_id).filter((v): v is string => !!v))];

    const [workers, hotels, verifiers] = await Promise.all([
      workerIds.length
        ? this.prisma.user.findMany({ where: { id: { in: workerIds } }, select: AttendanceService.PERSON_SELECT })
        : [],
      hotelIds.length
        ? this.prisma.hotel.findMany({ where: { id: { in: hotelIds } }, select: AttendanceService.HOTEL_SELECT })
        : [],
      verifierIds.length
        ? this.prisma.user.findMany({ where: { id: { in: verifierIds } }, select: AttendanceService.PERSON_SELECT })
        : [],
    ]);
    const workerById = new Map(workers.map((w) => [w.id, w]));
    const hotelById = new Map(hotels.map((h) => [h.id, h]));
    const verifierById = new Map(verifiers.map((v) => [v.id, v]));

    return {
      data: records.map((r) => {
        const verifier = r.verified_by_id ? verifierById.get(r.verified_by_id) : undefined;
        return this.toDto(r, {
          worker: workerById.get(r.worker_id) ?? null,
          hotel: hotelById.get(r.hotel_id) ?? null,
          verifiedByName: verifier ? `${verifier.first_name} ${verifier.last_name}`.trim() : null,
        });
      }),
      total,
    };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<AttendanceDto> {
    const record = await this.prisma.attendance.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Attendance record not found');

    if (isSelfScopedRole(actor.role, { checkerIsSelfScoped: false })) {
      if (record.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this attendance record');
      }
    } else if (isScopedManagerRole(actor.role)) {
      // IDOR fix (2026-08-08): list()/update() in this same file already
      // scope a manager/regional_manager to their own hotel/hotel_group
      // claim -- getById() never did, so a manager could read any single
      // attendance record platform-wide by id.
      const inScope = await isHotelInScope(actor.scope ?? null, record.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot access this attendance record');
      }
    }

    return this.toDto(record, await this.enrichContext(record));
  }

  async update(
    id: string,
    input: UpdateAttendanceInput,
    actorId: string,
    actorRole: string,
    actorScope: UserScope | null = null,
    actorIp?: string
  ): Promise<AttendanceDto> {
    const record = await this.prisma.attendance.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Attendance record not found');

    // Epic 5 PR 5.5 (ADR-024, retired M-4): a scope-bound manager may only
    // mutate attendance for hotels in their scope claim. Checked before any
    // mutation. Admin/checker/worker branches below are unchanged.
    if (isScopedManagerRole(actorRole)) {
      const inScope = await isHotelInScope(actorScope, record.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot access this attendance record');
      }
    }

    const isWorker = isSelfScopedRole(actorRole, { checkerIsSelfScoped: false });

    if (isWorker) {
      if (record.worker_id !== actorId) {
        throw new ForbiddenError('Cannot modify another worker\'s attendance');
      }
      // Workers may only set check_out_at and notes
      if (
        input.status !== undefined ||
        input.minutes_late !== undefined ||
        input.minutes_worked !== undefined ||
        input.is_verified !== undefined ||
        input.check_in_at !== undefined
      ) {
        throw new ForbiddenError('Workers may only set check_out_at and notes');
      }
      if (record.check_in_at === null) {
        throw new ConflictError('Must check in before checking out');
      }
      if (record.check_out_at !== null) {
        throw new ConflictError('Already checked out');
      }

      // Checkout geofence fix (2026-08-08): checkIn() enforces a geofence
      // (verifyGeofence / isGeofenceConfigured, lines ~68-89) so a worker
      // must be on-site to start a shift; checkout enforced nothing at all,
      // letting a worker check in on-site, leave, and check out from
      // anywhere -- undermining the entire point of the check-in geofence.
      // Same required-when-configured shape as checkIn, not optional: an
      // optional check here would ship infrastructure nobody could rely on
      // until every caller opts in.
      if (input.check_out_at !== undefined) {
        if (input.latitude !== undefined && input.longitude !== undefined) {
          const verification = await geoService.verifyGeofence(
            actorId,
            { hotel_id: record.hotel_id, latitude: input.latitude, longitude: input.longitude },
            actorRole,
            actorIp,
            record.id
          );
          if (verification.status === 'verified' && !verification.insideRadius) {
            await this.logAudit(actorId, actorRole, 'CHECK_OUT_DENIED_GEOFENCE', 'ATTENDANCE', record.id, {
              distance_meters: verification.distanceMeters,
            });
            throw new ForbiddenError('Check-out denied: outside the hotel geofence');
          }
        } else if (await geoService.isGeofenceConfigured(record.hotel_id)) {
          await this.logAudit(actorId, actorRole, 'CHECK_OUT_DENIED_GEOFENCE', 'ATTENDANCE', record.id, {
            reason: 'location_not_supplied',
          });
          throw new ForbiddenError('Location permission is required to check out at this hotel');
        }
      }
    }

    const data: Prisma.AttendanceUpdateInput = {};

    // 2026-08-13 fix: resolved BEFORE the check_out_at block below so that
    // if a manager corrects both in the same request, the auto-computed
    // minutes_worked uses the CORRECTED check-in time, not the stale stored
    // one. Manager-only -- the isWorker guard above already rejects
    // check_in_at from a worker-submitted request.
    const effectiveCheckInAt =
      !isWorker && input.check_in_at !== undefined ? new Date(input.check_in_at) : record.check_in_at;

    // check_in_at itself is written by the manager-only block further down
    // (`data.check_in_at = effectiveCheckInAt`); writing it here as well was a
    // redundant second assignment of the same value.
    const effectiveCheckOutAt =
      input.check_out_at !== undefined ? (isWorker ? new Date() : new Date(input.check_out_at)) : record.check_out_at;

    if (input.check_out_at !== undefined) {
      // Time-manipulation fix (2026-08-08): a worker's own check-out time was
      // taken verbatim from the request body and used unchanged to compute
      // minutes_worked -- unlike checkIn(), which only ever uses server time
      // (`new Date()`, line ~91). A worker could submit an arbitrary future
      // (or past) check_out_at to inflate or deflate their own paid minutes.
      // A manager correcting a record after the fact is a distinct, already
      // more-trusted action (same tier as the minutes_worked/status override
      // below) and keeps using the value they supplied.
      data.check_out_at = isWorker ? new Date() : new Date(input.check_out_at);
    }

    if ((input.check_in_at !== undefined || input.check_out_at !== undefined) && effectiveCheckInAt && effectiveCheckOutAt) {
      data.minutes_worked = Math.max(
        0,
        Math.floor((effectiveCheckOutAt.getTime() - effectiveCheckInAt.getTime()) / 60000)
      );
    }

    if (input.notes !== undefined) data.notes = input.notes;

    // Manager-only fields
    if (!isWorker) {
      if (input.status !== undefined) data.status = input.status as AttendanceStatus;
      if (input.check_in_at !== undefined) data.check_in_at = effectiveCheckInAt;
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

      await this.logAudit(
        actorId,
        actorRole,
        'UPDATE_ATTENDANCE',
        'ATTENDANCE',
        id,
        { worker_id: record.worker_id },
        undefined,
        {
          status: record.status,
          check_out_at: record.check_out_at,
          minutes_worked: record.minutes_worked,
          is_verified: record.is_verified,
        },
        {
          status: u.status,
          check_out_at: u.check_out_at,
          minutes_worked: u.minutes_worked,
          is_verified: u.is_verified,
        },
        tx
      );

      return u;
    });
    // Bug 35 (Critical): Sync the assignment state so workers don't bypass attendance
    if (input.check_out_at !== undefined && record.check_out_at === null) {
      try {
        await assignmentService.update(
          record.assignment_id,
          { status: AssignmentStatus.COMPLETED },
          actorId,
          actorRole,
          actorScope,
          true // internalBypass = true
        );
      } catch (err: any) {
        // If it's already COMPLETED or CANCELLED, ignore the conflict
        if (!(err instanceof ConflictError)) throw err;
      }
    }

    return this.toDto(updated, await this.enrichContext(updated));
  }
}

export const attendanceService = new AttendanceService();
