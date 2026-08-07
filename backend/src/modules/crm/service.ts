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
    const { page, limit, search, is_active, country, hotel_group_id, include_deleted } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    // Deleted entities are invisible to normal operational reads (2026-08-07).
    // Before this, deleted_at was written by deleteHotel() and read by NOTHING
    // in CRM, so a "deleted" hotel still appeared in every list and picker
    // while job-requests and manager assignment silently rejected it.
    //
    // Admin-only opt-in, for the archived/restore view. A non-admin cannot
    // widen their own visibility by passing the flag.
    const includeDeleted = include_deleted === 'true' && actorRole === 'admin';
    if (!includeDeleted) where['deleted_at'] = null;
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

  async getHotel(
    hotelId: string,
    actorId: string,
    actorRole: string,
    ip?: string,
    includeDeleted = false
  ) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: hotelId },
    });
    if (!hotel) throw new NotFoundError('Hotel not found');
    // A deleted hotel reads as absent to everyone except an admin explicitly
    // looking at the archive -- 404 rather than 403, so its existence is not
    // disclosed to callers who should not see it.
    if (hotel.deleted_at && !(includeDeleted && actorRole === 'admin')) {
      throw new NotFoundError('Hotel not found');
    }

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

  /**
   * ACTIVE -> DEACTIVATED. Temporary and reversible: the hotel still exists
   * and we intend to use it again. It keeps appearing in admin views and
   * reports; only operational availability stops.
   */
  async deactivateHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');
    if (hotel.deleted_at) throw new ConflictError('Restore this hotel before deactivating it');
    if (!hotel.is_active) throw new ConflictError('Hotel is already deactivated');

    const result = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: { is_active: false },
    });
    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, { action: 'deactivate', name: hotel.name }, ip);
    return result;
  }

  /** DEACTIVATED -> ACTIVE. The inverse of deactivateHotel(). */
  async reactivateHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');
    if (hotel.deleted_at) throw new ConflictError('Restore this hotel before reactivating it');
    if (hotel.is_active) throw new ConflictError('Hotel is already active');

    const result = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: { is_active: true },
    });
    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, { action: 'reactivate', name: hotel.name }, ip);
    return result;
  }

  /**
   * -> DELETED. Permanent removal from operations, history preserved.
   *
   * Distinct from DEACTIVATED in kind, not just degree: a deleted hotel
   * disappears from every operational list, picker and assignment flow (see
   * the deleted_at filters in listHotels/getHotel), and returns only through
   * an explicit admin restore. Deactivation is a Tuesday-to-Thursday pause;
   * deletion means we are done with this hotel.
   *
   * Sets is_active=false alongside deleted_at so the two columns can never
   * disagree -- a deleted-but-active row is not a state this model has.
   *
   * Never removes the row. True row removal, if it is ever needed, belongs in
   * a separate PURGE operation with stronger authentication rather than being
   * overloaded onto this one.
   */
  async deleteHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');
    if (hotel.deleted_at) throw new ConflictError('Hotel is already deleted');

    const result = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: { is_active: false, deleted_at: new Date() },
    });
    await this.logAudit(actorId, actorRole, 'DELETE', 'HOTEL', hotelId, { name: hotel.name }, ip);
    return result;
  }

  /**
   * DELETED -> ACTIVE. Admin restore from the archived view.
   *
   * Clears both columns together. Clearing only deleted_at would leave the
   * hotel restored-but-deactivated, and clearing only is_active was the
   * original bug: the edit form could flip is_active while deleted_at stayed
   * set, producing a hotel visible in CRM lists but rejected by work requests
   * and manager assignment.
   */
  async restoreHotel(hotelId: string, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');
    if (!hotel.deleted_at) throw new ConflictError('Hotel is not deleted');

    const result = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: { is_active: true, deleted_at: null },
    });
    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, { action: 'restore', name: hotel.name }, ip);
    return result;
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
    const { page, limit, include_deleted } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    // See listHotels(): deleted groups are invisible to operational reads,
    // with an admin-only opt-in for the archived view.
    const includeDeleted = include_deleted === 'true' && actor.role === 'admin';
    if (!includeDeleted) where['deleted_at'] = null;
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
    ip?: string,
    includeDeleted = false
  ) {
    const hotelGroup = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!hotelGroup) throw new NotFoundError('Hotel group not found');
    // See getHotel(): a deleted group reads as absent, 404 not 403.
    if (hotelGroup.deleted_at && !(includeDeleted && actorRole === 'admin')) {
      throw new NotFoundError('Hotel group not found');
    }

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

  /** ACTIVE -> DEACTIVATED for a group. Mirrors deactivateHotel(). */
  async deactivateHotelGroup(hotelGroupId: string, actorId: string, actorRole: string, ip?: string) {
    const group = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!group) throw new NotFoundError('Hotel group not found');
    if (group.deleted_at) throw new ConflictError('Restore this hotel group before deactivating it');
    if (!group.is_active) throw new ConflictError('Hotel group is already deactivated');

    const result = await this.prisma.hotelGroup.update({
      where: { id: hotelGroupId },
      data: { is_active: false },
    });
    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroupId, { action: 'deactivate', name: group.name }, ip);
    return result;
  }

  /** DEACTIVATED -> ACTIVE for a group. */
  async reactivateHotelGroup(hotelGroupId: string, actorId: string, actorRole: string, ip?: string) {
    const group = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!group) throw new NotFoundError('Hotel group not found');
    if (group.deleted_at) throw new ConflictError('Restore this hotel group before reactivating it');
    if (group.is_active) throw new ConflictError('Hotel group is already active');

    const result = await this.prisma.hotelGroup.update({
      where: { id: hotelGroupId },
      data: { is_active: true },
    });
    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroupId, { action: 'reactivate', name: group.name }, ip);
    return result;
  }

  /**
   * -> DELETED for a group. Soft, as of 2026-08-07.
   *
   * BEHAVIOUR CHANGE: this previously issued a hard `prisma.hotelGroup.delete`,
   * destroying the row and detaching every member hotel via
   * Hotel.hotel_group_id's ON DELETE SET NULL -- irreversible, and it silently
   * orphaned hotels. It is now a soft delete matching Hotel's, so history
   * survives and an admin can restore.
   *
   * Member hotels keep their hotel_group_id: the group still exists, it is
   * simply out of operation. That is what makes restore meaningful -- a hard
   * delete could not put the hotels back.
   *
   * True row removal, if ever needed, belongs in a separate PURGE operation.
   */
  async deleteHotelGroup(hotelGroupId: string, actorId: string, actorRole: string, ip?: string) {
    const group = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!group) throw new NotFoundError('Hotel group not found');
    if (group.deleted_at) throw new ConflictError('Hotel group is already deleted');

    const result = await this.prisma.hotelGroup.update({
      where: { id: hotelGroupId },
      data: { is_active: false, deleted_at: new Date() },
    });
    await this.logAudit(actorId, actorRole, 'DELETE', 'HOTEL_GROUP', hotelGroupId, { name: group.name }, ip);
    return result;
  }

  /** DELETED -> ACTIVE for a group. Admin restore from the archived view. */
  async restoreHotelGroup(hotelGroupId: string, actorId: string, actorRole: string, ip?: string) {
    const group = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!group) throw new NotFoundError('Hotel group not found');
    if (!group.deleted_at) throw new ConflictError('Hotel group is not deleted');

    const result = await this.prisma.hotelGroup.update({
      where: { id: hotelGroupId },
      data: { is_active: true, deleted_at: null },
    });
    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroupId, { action: 'restore', name: group.name }, ip);
    return result;
  }

}

export const crmService = new CrmService();
