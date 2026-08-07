import { BaseService } from '../../lib/base-service.js';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import {
  CreateHotelRequest, UpdateHotelRequest,
  ListHotelsQuery,
  CreateHotelGroupRequest, UpdateHotelGroupRequest,
  ListHotelGroupsQuery,
} from './types.js';
import { resolveNonAdminScopeFilter, isScopedManagerRole } from '../../lib/scope.js';
import { listEligibleHotelIds } from '../../lib/roster-scope.js';
import type { UserScope } from '../../lib/jwt.js';

export class CrmService extends BaseService {
  // ── Hotels ─────────────────────────────────────────────────────────────────

  async listHotels(query: ListHotelsQuery, actorRole: string, actorId?: string) {
    const { page, limit, search, is_active, country, hotel_group_id } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (is_active !== undefined) where['is_active'] = is_active === 'true';
    if (country) where['country'] = { equals: country, mode: 'insensitive' };
    if (hotel_group_id) where['hotel_group_id'] = hotel_group_id;
    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Non-admins/managers see only active hotels. `regional_manager` counts as
    // a manager here (ADR-030 §3 C-05, D-5): an RM administers its group's
    // hotels and must see an inactive one for the same reason a Hotel Manager
    // must — it was omitted from this allowlist while `manager` was present.
    if (actorRole !== 'admin' && !isScopedManagerRole(actorRole)) {
      where['is_active'] = true;
    }

    // `worker` is roster-scoped to their eligible hotels (ADR-022/024, the
    // same group-grain model `resolveHotelAccess()`'s worker-roster branch
    // uses for the DETAIL route) — without this, widening the route's role
    // gate to admit `worker` (product decision, 2026-08-05, C-05) would leak
    // every active hotel on the platform to every worker, a strictly worse
    // outcome than the 403 it replaces. `checker` is NOT scoped here,
    // matching its documented cross-hotel bypass on the detail route
    // (`resolveHotelAccess()`, PATCH-04 §4c) — checker sees every hotel on
    // both routes, by design.
    if (actorRole === 'worker') {
      const eligibleHotelIds = actorId ? await listEligibleHotelIds(actorId) : [];
      where['id'] = { in: eligibleHotelIds };
    }

    const [hotels, total] = await Promise.all([
      this.prisma.hotel.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, city: true, country: true,
          address: true, timezone: true, is_active: true,
          created_at: true, updated_at: true,
        },
      }),
      this.prisma.hotel.count({ where }),
    ]);

    return {
      hotels,
      pagination: {
        page, per_page: limit, total,
        total_pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_prev: page > 1,
      },
    };
  }

  async getHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: hotelId },
    });
    if (!hotel) throw new NotFoundError('Hotel not found');

    await this.logAudit(actorId, actorRole, 'VIEW', 'HOTEL', hotelId, {}, ip);
    return hotel;
  }

  async createHotel(data: CreateHotelRequest, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.create({
      data: {
        name: data.name,
        city: data.city,
        country: data.country,
        address: data.address,
        timezone: data.timezone,
        latitude: data.latitude,
        longitude: data.longitude,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotel.id, { action: 'create', name: hotel.name }, ip);
    return hotel;
  }

  // Person-centric assignment redesign (2026-08-07): this method no longer
  // touches Hotel.manager_user_id (or its assigned_at/vacated_at/
  // vacancy_reason companions) at all -- that write path moved exclusively
  // to users/service.ts#updateUserRole (PUT /users/:id/role). Previously
  // this method AND updateUserRole could both write manager_user_id, and
  // only updateUserRole had correct vacate-on-demotion logic -- the split
  // write path was the source data-integrity bug this redesign fixes. The
  // lock-ordering concerns documented on the old version of this method
  // (User-then-Hotel, re-read-under-lock) no longer apply here since this
  // method no longer locks or writes any User row.
  async updateHotel(hotelId: string, data: UpdateHotelRequest, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');

    if (data.hotel_group_id !== undefined && data.hotel_group_id !== null) {
      await this.assertHotelGroupExists(data.hotel_group_id);
    }

    const result = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: {
        name: data.name ?? hotel.name,
        city: data.city ?? hotel.city,
        country: data.country ?? hotel.country,
        address: data.address ?? hotel.address,
        timezone: data.timezone ?? hotel.timezone,
        is_active: data.is_active ?? hotel.is_active,
        accepting_jobs: data.accepting_jobs ?? hotel.accepting_jobs,
        // `undefined` (field omitted) leaves the existing value; `null`
        // (field explicitly sent) clears the assignment.
        hotel_group_id: data.hotel_group_id === undefined ? hotel.hotel_group_id : data.hotel_group_id,
        latitude: data.latitude ?? hotel.latitude,
        longitude: data.longitude ?? hotel.longitude,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, { fields: Object.keys(data) }, ip);
    return result;
  }

  // Epic 5 PR 5.3 (ADR-023): validates a hotel-group assignment references an
  // existing group before writing, mirroring assertRegionalManagerExists
  // below. HotelGroup has no soft-delete field (ADR-023's decided shape), so
  // existence is the only check needed.
  private async assertHotelGroupExists(hotelGroupId: string): Promise<void> {
    const hotelGroup = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!hotelGroup) {
      throw new ValidationError('hotel_group_id does not reference an existing hotel group', [
        { field: 'hotel_group_id', message: 'Hotel group not found' },
      ]);
    }
  }

  // Person-centric assignment redesign (2026-08-07): the manager-role check
  // formerly here (assertHotelManagerExists) moved into
  // users/service.ts#updateUserRole, the sole write path for
  // Hotel.manager_user_id now.

  async deleteHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');

    // Soft-delete: deactivate and record deletion timestamp
    await this.prisma.hotel.update({ where: { id: hotelId }, data: { is_active: false, deleted_at: new Date() } });
    await this.logAudit(actorId, actorRole, 'DELETE', 'HOTEL', hotelId, { name: hotel.name }, ip);
  }

  // ── Hotel Groups (Epic 5 PR 5.2, ADR-023) ───────────────────────────────────
  // Additive alongside Hotel CRUD above. Nothing in the request pipeline reads
  // hotel_group_id/manager_user_id for authorization scoping yet — that lands
  // at PR 5.4 (scope-claim issuance) / PR 5.5 (authz flip), per ADR-024.

  // Person-centric assignment redesign (2026-08-07): the RM-role check
  // formerly here (assertRegionalManagerExists) moved into
  // users/service.ts#updateUserRole, the sole write path for
  // HotelGroup.regional_manager_user_id now.

  // ADR-030 PR-4 (D-7, C-08): previously unscoped — any manager listed every
  // hotel group regardless of their own. Filters, does not deny (D-7): a
  // scoped manager/regional_manager just sees their own group's row.
  // Default-deny shape (security review FIND-01): admin is the only
  // explicit bypass, not a `{manager, regional_manager}` allowlist — any
  // other role reaching this method is scope-resolved, not implicitly
  // trusted. See the matching note in users/service.ts listUsers.
  async listHotelGroups(query: ListHotelGroupsQuery, actor: { role: string; scope: UserScope | null }) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (actor.role !== 'admin') {
      const scopeFilter = await resolveNonAdminScopeFilter(actor.role, actor.scope);
      if (scopeFilter.kind === 'deny') {
        where['id'] = '__none__';
      } else if (scopeFilter.kind === 'group') {
        where['id'] = scopeFilter.hotelGroupId;
      }
    }

    const [hotelGroups, total] = await Promise.all([
      this.prisma.hotelGroup.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.hotelGroup.count({ where }),
    ]);

    return {
      hotelGroups,
      pagination: {
        page, per_page: limit, total,
        total_pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_prev: page > 1,
      },
    };
  }

  // ADR-030 PR-4 (D-7, C-08): single-resource fetch, so "filter" isn't
  // expressible — an out-of-scope group now denies (403), matching the
  // existing checkHotelAccess() convention for single-hotel fetches.
  // Default-deny shape (security review FIND-01): see listHotelGroups above.
  async getHotelGroup(
    hotelGroupId: string,
    actorId: string,
    actorRole: string,
    actorScope: UserScope | null,
    ip?: string
  ) {
    const hotelGroup = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!hotelGroup) throw new NotFoundError('Hotel group not found');

    if (actorRole !== 'admin') {
      const scopeFilter = await resolveNonAdminScopeFilter(actorRole, actorScope);
      const inScope = scopeFilter.kind === 'group' && scopeFilter.hotelGroupId === hotelGroupId;
      if (!inScope) throw new ForbiddenError('Hotel group not in your scope');
    }

    await this.logAudit(actorId, actorRole, 'VIEW', 'HOTEL_GROUP', hotelGroupId, {}, ip);
    return hotelGroup;
  }

  // Person-centric assignment redesign (2026-08-07): no longer accepts or
  // writes regional_manager_user_id at all — a HotelGroup is created RM-less
  // (a legitimate transitional state, mirroring Hotel's existing
  // no-manager-yet vacancy model) and the RM is assigned afterward via
  // users/service.ts#updateUserRole.
  async createHotelGroup(data: CreateHotelGroupRequest, actorId: string, actorRole: string, ip?: string) {
    const hotelGroup = await this.prisma.hotelGroup.create({
      data: {
        name: data.name,
        billing_info: data.billing_info,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroup.id, { action: 'create', name: hotelGroup.name }, ip);
    return hotelGroup;
  }

  // Person-centric assignment redesign (2026-08-07): no longer touches
  // HotelGroup.regional_manager_user_id (or its assigned_at/vacated_at/
  // vacancy_reason companions) at all -- that write path moved exclusively
  // to users/service.ts#updateUserRole. The lock-ordering / RM-transfer
  // concerns documented on the old version of this method no longer apply
  // since this method no longer locks or writes any User row.
  async updateHotelGroup(hotelGroupId: string, data: UpdateHotelGroupRequest, actorId: string, actorRole: string, ip?: string) {
    const existing = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!existing) throw new NotFoundError('Hotel group not found');

    const result = await this.prisma.hotelGroup.update({
      where: { id: hotelGroupId },
      data: {
        name: data.name ?? existing.name,
        billing_info: data.billing_info ?? existing.billing_info,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroupId, { fields: Object.keys(data) }, ip);
    return result;
  }

  /**
   * Reverses deleteHotel(). Admin-only, mirroring the delete it undoes.
   *
   * Added 2026-08-07: deleteHotel() sets BOTH is_active=false and deleted_at,
   * but nothing could clear deleted_at again -- updateHotel() never touches
   * that column, so flipping is_active back through the edit form left the
   * hotel half-restored. That mattered because the two columns are read
   * inconsistently across the codebase: CRM's own getHotel()/listHotels()
   * ignore deleted_at entirely (so the hotel still appeared in lists), while
   * job-requests/service.ts:152,483 and users/service.ts:514 reject a hotel
   * with deleted_at set. The result was a hotel that looked present but
   * silently could not take work requests or a manager assignment, with no
   * way back.
   */
  async reactivateHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');

    if (hotel.is_active && hotel.deleted_at === null) {
      throw new ConflictError('Hotel is already active');
    }

    // Clear both columns together. Clearing only one is exactly the
    // half-restored state described above.
    const result = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: { is_active: true, deleted_at: null },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, {
      action: 'reactivate',
      name: hotel.name,
    }, ip);

    return result;
  }

  async deleteHotelGroup(hotelGroupId: string, actorId: string, actorRole: string, ip?: string) {
    const hotelGroup = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!hotelGroup) throw new NotFoundError('Hotel group not found');

    // Hard delete: HotelGroup carries no soft-delete field in ADR-023's decided
    // shape. Hotel.hotel_group_id is onDelete: SetNull, so member hotels are
    // safely detached, not cascaded.
    await this.prisma.hotelGroup.delete({ where: { id: hotelGroupId } });
    await this.logAudit(actorId, actorRole, 'DELETE', 'HOTEL_GROUP', hotelGroupId, { name: hotelGroup.name }, ip);
  }
}

export const crmService = new CrmService();
