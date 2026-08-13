import { WorkerGeoCheckin } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isHotelInScope } from '../../middleware/permissions.js';
// Imported from lib/scope.js rather than the middleware re-export: these are
// pure role predicates with no I/O, and suites that jest.mock the permissions
// middleware (to stub isHotelInScope's DB read) would otherwise have to stub
// them too, coupling every such suite to this module's import list.
import { isScopedManagerRole, isSelfScopedRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import { haversineDistanceMeters } from './distance.js';
import { GEOFENCE_RADIUS_METERS } from './types.js';
import type { CheckinInput, GeoCheckinDto, ListCheckinsQuery } from './types.js';

// IF-GEO-DISTANCE-CHECK's result for callers outside this module (Attendance):
// a discriminated outcome rather than a thrown error, so a caller can tell
// "hotel has no coordinates configured yet" (not_configured -- GD-14 leaves
// this not-yet-applicable, not a failure) apart from "verified, and outside
// the radius" (which a caller may choose to fail closed on).
export type GeofenceVerification =
  | { status: 'not_configured' }
  | { status: 'verified'; insideRadius: boolean; distanceMeters: number; checkin: WorkerGeoCheckin };

export class GeoService extends BaseService {
  // GD-14: lets Attendance decide, before it even asks the worker's device
  // for a location fix, whether the geofence check is applicable to this
  // hotel at all -- without this, a worker who simply denies location
  // permission would produce the same "no coordinates supplied" shape as a
  // hotel that has none configured, silently bypassing the geofence.
  async isGeofenceConfigured(hotelId: string): Promise<boolean> {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { latitude: true, longitude: true },
    });
    return !!hotel && hotel.latitude !== null && hotel.longitude !== null;
  }

  // ---------------------------------------------------------------------------
  // IF-GEO-DISTANCE-CHECK (TREQ-GEO-001/004/005/006, RULE-GEO-001/002/004)
  // ---------------------------------------------------------------------------
  // Shared by GeoService.checkIn (worker-facing "Verify Location") and
  // Attendance's check-in (GD-14 backend-attendance <-> backend-geo wiring):
  // the single place that reads hotel coordinates, computes the haversine
  // distance, persists the WorkerGeoCheckin row (backend-geo-owned per
  // OD-GEO-002 -- Attendance never writes this table itself), and audit-logs
  // the result (OD-GEO-007, never including raw lat/long per OD-GEO-005).
  async verifyGeofence(
    workerId: string,
    input: CheckinInput,
    actorRole: string,
    actorIp?: string,
    // OD-GEO-010: only ever supplied by AttendanceService's own
    // checkIn()/checkOut(), which already knows the Attendance row this
    // check belongs to -- never derived from client input, so the public
    // CheckinSchema deliberately has no attendance_id field a worker could
    // spoof to attach a checkin to someone else's shift.
    attendanceId?: string
  ): Promise<GeofenceVerification> {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: input.hotel_id },
      select: { latitude: true, longitude: true },
    });

    // OD-GEO-004: admin-only manual entry -- coordinates may simply not be
    // set up yet for this hotel. Not a failure; callers treat the geofence
    // check as not-yet-applicable rather than fail-closed on it.
    if (!hotel || hotel.latitude === null || hotel.longitude === null) {
      // 2026-08-13 fix (E2E integration audit): this returned with no record
      // of any kind. OD-GEO-007 requires every distance-check result to be
      // audit-logged, but the one outcome that produced NO WorkerGeoCheckin
      // row -- and so had no row to hang an audit entry off -- also produced
      // no audit entry, leaving the skip completely untraceable. After the
      // fact there was no way to distinguish "this hotel had no geofence, so
      // the check was skipped" from "the check never ran", which is exactly
      // the question an audit of a disputed check-in has to answer.
      //
      // Deliberately does NOT persist the submitted coordinates. There is no
      // geofence to evaluate them against, so storing device location here
      // would be collecting personal location data with no processing purpose
      // (the module already bars latitude/longitude from audit details
      // entirely, OD-GEO-005). Recording that a check was requested and
      // skipped is the audit requirement; the coordinates are not.
      //
      // Anchored to the HOTEL rather than WORKER_GEO_CHECKIN: no checkin row
      // exists, and inventing an id for one would imply a stored coordinate
      // record that is intentionally absent.
      await this.logAudit(
        workerId,
        actorRole,
        'GEOFENCE_CHECK_SKIPPED',
        'HOTEL',
        input.hotel_id,
        {
          reason: 'not_configured',
          ...(attendanceId ? { attendance_id: attendanceId } : {}),
        },
        actorIp
      );
      return { status: 'not_configured' };
    }

    const distanceMeters = haversineDistanceMeters(
      input.latitude,
      input.longitude,
      hotel.latitude,
      hotel.longitude
    );
    const insideRadius = distanceMeters <= GEOFENCE_RADIUS_METERS;

    // TREQ-GEO-004: actual device coordinates are captured and stored at
    // every check, regardless of pass/fail.
    const checkin = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.workerGeoCheckin.create({
        data: {
          worker_id: workerId,
          hotel_id: input.hotel_id,
          attendance_id: attendanceId ?? null,
          latitude: input.latitude,
          longitude: input.longitude,
          distance_meters: distanceMeters,
          inside_radius: insideRadius,
        },
      });

      // OD-GEO-007: every distance-check result (pass or fail) is audit-logged,
      // distinct from Attendance's own CHECK_IN/UPDATE_ATTENDANCE audit rows.
      // Never includes latitude/longitude in the audit details (OD-GEO-005).
      await this.logAudit(
        workerId,
        actorRole,
        'GEOFENCE_CHECK',
        'WORKER_GEO_CHECKIN',
        rec.id,
        {
          hotel_id: input.hotel_id,
          distance_meters: distanceMeters,
          inside_radius: insideRadius,
        },
        actorIp,
        undefined,
        undefined,
        tx
      );

      return rec;
    });

    return { status: 'verified', insideRadius, distanceMeters, checkin };
  }

  // GD-14/OD-GEO-003: fails closed. Missing hotel coordinates -> NotFoundError
  // (no clock event, no coordinate write, per TREQ-GEO-006) rather than
  // silently allowing or defaulting to "inside radius." This is the
  // worker-facing "Verify Location" endpoint's own fail-closed contract --
  // distinct from verifyGeofence()'s not_configured outcome used by callers
  // (Attendance) for whom the geofence check is not yet applicable.
  //
  // RULE-DOC-08-equivalent: workerId is always the authenticated caller's own
  // identity (self-scoped self-checkin), never a client-supplied field --
  // enforced in controller.ts from req.auth.userId, mirroring Documents'
  // provenance discipline. A manager-on-behalf-of-worker actor is not part of
  // GD-14's confirmed scope (only self-checkin is named by TREQ-GEO-004).
  async checkIn(
    workerId: string,
    input: CheckinInput,
    actorRole: string,
    actorIp?: string
  ): Promise<GeoCheckinDto> {
    const result = await this.verifyGeofence(workerId, input, actorRole, actorIp);

    if (result.status === 'not_configured') {
      throw new NotFoundError('Hotel coordinates are not configured; geofence check unavailable');
    }

    return this.toDto(result.checkin);
  }

  // ---------------------------------------------------------------------------
  // IF-GEO-ListCheckins / IF-GEO-GetCheckin
  // ---------------------------------------------------------------------------
  // OD-GEO-005: admin/manager see only the computed distance/pass-fail
  // result (this.toDto never surfaces latitude/longitude). Manager access is
  // scoped to hotels in their own scope claim, mirroring
  // AttendanceService.list()'s identical manager hotel-scope pattern. Worker
  // access is self-scoped (own checkins only).
  async listCheckins(
    query: ListCheckinsQuery,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ data: GeoCheckinDto[]; total: number }> {
    const where: {
      worker_id?: string;
      hotel_id?: string | { in: string[] };
      hotel?: { hotel_group_id: string };
      attendance_id?: string;
    } = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.attendance_id ? { attendance_id: query.attendance_id } : {}),
    };

    // isSelfScopedRole()/isScopedManagerRole() rather than literal role strings:
    // a `role !== 'admin' && role !== 'manager'` test MATCHED regional_manager,
    // silently narrowing an RM to its own check-ins, while the
    // `role === 'manager'` scope filter below SKIPPED it — so an RM received a
    // 200 with the wrong rows on both counts. ADR-030 §3 grants RM the same
    // operational capability set as Manager at group scope (D-5), and
    // isHotelInScope()/the nested hotel_group filter already serve a
    // hotel_group claim correctly.
    if (isSelfScopedRole(actor.role)) {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    // Review fix: single nested-relation filter, matching
    // AttendanceService.list()'s identical manager hotel_group-scope shape
    // (attendance/service.ts:159) -- no separate hotel.findMany() round-trip.
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

    const [records, total] = await Promise.all([
      this.prisma.workerGeoCheckin.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { checked_at: 'desc' },
      }),
      this.prisma.workerGeoCheckin.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getCheckin(
    id: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<GeoCheckinDto> {
    const record = await this.prisma.workerGeoCheckin.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('Geofence check-in not found');

    if (isSelfScopedRole(actor.role)) {
      if (record.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this geofence check-in');
      }
    } else if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, record.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot access this geofence check-in');
      }
    }

    return this.toDto(record);
  }

  // RULE-GEO-003/OD-GEO-005: distance_meters + inside_radius only. Never
  // latitude/longitude, worker-facing or manager/admin-facing alike.
  private toDto(c: WorkerGeoCheckin): GeoCheckinDto {
    return {
      id: c.id,
      worker_id: c.worker_id,
      hotel_id: c.hotel_id,
      attendance_id: c.attendance_id,
      distance_meters: c.distance_meters,
      inside_radius: c.inside_radius,
      checked_at: c.checked_at.toISOString(),
    };
  }
}

export const geoService = new GeoService();
