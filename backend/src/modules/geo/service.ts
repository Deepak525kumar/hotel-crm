import { WorkerGeoCheckin } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import { haversineDistanceMeters } from './distance.js';
import { GEOFENCE_RADIUS_METERS } from './types.js';
import type { CheckinInput, GeoCheckinDto, ListCheckinsQuery } from './types.js';

export class GeoService extends BaseService {
  // ---------------------------------------------------------------------------
  // IF-GEO-DISTANCE-CHECK (TREQ-GEO-001/004/005/006, RULE-GEO-001/002/004)
  // ---------------------------------------------------------------------------
  // GD-14/OD-GEO-003: fails closed. Missing hotel coordinates -> NotFoundError
  // (no clock event, no coordinate write, per TREQ-GEO-006) rather than
  // silently allowing or defaulting to "inside radius."
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
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: input.hotel_id },
      select: { latitude: true, longitude: true },
    });

    // OD-GEO-003 fail-closed: no hotel row, or coordinates not yet set
    // (OD-GEO-004: admin-only manual entry -- may simply not be done yet).
    if (!hotel || hotel.latitude === null || hotel.longitude === null) {
      throw new NotFoundError('Hotel coordinates are not configured; geofence check unavailable');
    }

    const distanceMeters = haversineDistanceMeters(
      input.latitude,
      input.longitude,
      hotel.latitude,
      hotel.longitude
    );
    const insideRadius = distanceMeters <= GEOFENCE_RADIUS_METERS;

    // TREQ-GEO-004: actual device coordinates are captured and stored at
    // every check, regardless of pass/fail -- distinct from TREQ-GEO-006
    // (Attendance's own Start/Close write, which this module does not own,
    // is what's gated by inside_radius; this row is geo's own capture).
    const checkin = await this.prisma.workerGeoCheckin.create({
      data: {
        worker_id: workerId,
        hotel_id: input.hotel_id,
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
      checkin.id,
      {
        hotel_id: input.hotel_id,
        distance_meters: distanceMeters,
        inside_radius: insideRadius,
      },
      actorIp
    );

    return this.toDto(checkin);
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
    } = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
    };

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      where.worker_id = query.worker_id;
    }

    if (actor.role === 'manager') {
      const scope = actor.scope ?? null;
      if (!scope) {
        where.hotel_id = { in: [] };
      } else if (scope.type === 'hotel') {
        where.hotel_id = scope.hotel_id;
      } else if (scope.type === 'hotel_group') {
        const hotels = await this.prisma.hotel.findMany({
          where: { hotel_group_id: scope.hotel_group_id },
          select: { id: true },
        });
        where.hotel_id = { in: hotels.map((h) => h.id) };
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

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      if (record.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this geofence check-in');
      }
    } else if (actor.role === 'manager') {
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
      distance_meters: c.distance_meters,
      inside_radius: c.inside_radius,
      checked_at: c.checked_at.toISOString(),
    };
  }
}

export const geoService = new GeoService();
