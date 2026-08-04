import { BaseService } from '../../lib/base-service.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import {
  CreateHotelRequest, UpdateHotelRequest,
  ListHotelsQuery,
  CreateHotelGroupRequest, UpdateHotelGroupRequest,
  ListHotelGroupsQuery,
} from './types.js';
import { resolveNonAdminScopeFilter, isScopedManagerRole } from '../../lib/scope.js';
import { bumpTokenGeneration } from '../auth/service.js';
import { listEligibleHotelIds } from '../../lib/roster-scope.js';
import type { UserScope } from '../../lib/jwt.js';

export class CrmService extends BaseService {
  // ── Hotels ─────────────────────────────────────────────────────────────────

  async listHotels(query: ListHotelsQuery, actorRole: string, actorId?: string) {
    const { page, limit, search, is_active, country } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (is_active !== undefined) where['is_active'] = is_active === 'true';
    if (country) where['country'] = { equals: country, mode: 'insensitive' };
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
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotel.id, { action: 'create', name: hotel.name }, ip);
    return hotel;
  }

  async updateHotel(hotelId: string, data: UpdateHotelRequest, actorId: string, actorRole: string, ip?: string) {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
    if (!hotel) throw new NotFoundError('Hotel not found');

    if (data.hotel_group_id !== undefined) {
      await this.assertHotelGroupExists(data.hotel_group_id);
    }

    const updated = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: {
        name: data.name ?? hotel.name,
        city: data.city ?? hotel.city,
        country: data.country ?? hotel.country,
        address: data.address ?? hotel.address,
        timezone: data.timezone ?? hotel.timezone,
        is_active: data.is_active ?? hotel.is_active,
        accepting_jobs: data.accepting_jobs ?? hotel.accepting_jobs,
        hotel_group_id: data.hotel_group_id ?? hotel.hotel_group_id,
        latitude: data.latitude ?? hotel.latitude,
        longitude: data.longitude ?? hotel.longitude,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, { fields: Object.keys(data) }, ip);
    return updated;
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

  // Regional Manager V1 Decision 12: the target must ALREADY hold
  // REGIONAL_MANAGER before being assigned to a group. Previously this only
  // checked the user existed, so a WORKER/MANAGER row could be written into
  // regional_manager_user_id with no actual RM authority ever granted (their
  // JWT role stays whatever it was) — an assignment that promotes nothing.
  // Promotion (PUT /users/:id/role) is a separate, ordered, prior step.
  private async assertRegionalManagerExists(regionalManagerUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: regionalManagerUserId } });
    if (!user || user.deleted_at) {
      throw new ValidationError('regional_manager_user_id does not reference an existing user', [
        { field: 'regional_manager_user_id', message: 'User not found' },
      ]);
    }
    if (user.role !== 'REGIONAL_MANAGER') {
      throw new ValidationError('regional_manager_user_id must reference a user already holding the Regional Manager role', [
        { field: 'regional_manager_user_id', message: 'User is not a Regional Manager' },
      ]);
    }
  }

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

  async createHotelGroup(data: CreateHotelGroupRequest, actorId: string, actorRole: string, ip?: string) {
    await this.assertRegionalManagerExists(data.regional_manager_user_id);

    const hotelGroup = await this.prisma.hotelGroup.create({
      data: {
        name: data.name,
        billing_info: data.billing_info,
        regional_manager_user_id: data.regional_manager_user_id,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroup.id, { action: 'create', name: hotelGroup.name }, ip);
    return hotelGroup;
  }

  // Lock-ordering follow-up (post-#339 review, paired with the identical fix
  // in users/service.ts#updateUserRole): this is the RM-transfer path, so it
  // now locks User rows (the outgoing and incoming RM, for the
  // token_generation bump below) in addition to the HotelGroup row it always
  // locked. It MUST acquire in the same order updateUserRole does — User
  // first, then HotelGroup — or a demote racing a transfer deadlocks instead
  // of cleanly serializing. See updateUserRole's comment for the full
  // race/deadlock analysis; this is the other half of that pair.
  async updateHotelGroup(hotelGroupId: string, data: UpdateHotelGroupRequest, actorId: string, actorRole: string, ip?: string) {
    const existing = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!existing) throw new NotFoundError('Hotel group not found');

    const nextRegionalManagerUserId = data.regional_manager_user_id ?? existing.regional_manager_user_id;
    const isTransfer =
      data.regional_manager_user_id !== undefined &&
      data.regional_manager_user_id !== existing.regional_manager_user_id;

    if (data.regional_manager_user_id !== undefined) {
      await this.assertRegionalManagerExists(data.regional_manager_user_id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Lock BOTH RM user rows before the outgoing RM's HotelGroup row, so a
      // concurrent updateUserRole() demotion of either user blocks until this
      // transaction commits (and re-reads a consistent state, not a stale
      // pre-transfer snapshot). Fixed order across both ids (existing, then
      // new) avoids a third deadlock class: two concurrent transfers of the
      // SAME PAIR of users in opposite directions.
      const lockIds = [existing.regional_manager_user_id, nextRegionalManagerUserId]
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .sort();
      for (const id of lockIds) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      }

      // Re-check under lock: the D12 assertion above (assertRegionalManagerExists)
      // ran BEFORE the transaction and BEFORE the row lock, so its result can
      // be stale by the time we hold the lock. Concretely:
      //   1. This call passes assertRegionalManagerExists(u2) — u2 is RM.
      //   2. A concurrent updateUserRole() locks u2's User row first, finds u2
      //      owns no group (true — this transaction hasn't written yet),
      //      demotes u2 to MANAGER, commits.
      //   3. This transaction now acquires its own lock on u2's row and, with
      //      only the STALE outer-scope assertion to go on, writes
      //      regional_manager_user_id = u2 anyway — a HotelGroup pointing at a
      //      MANAGER, the exact invariant violation both fixes exist to
      //      prevent, just via a different interleaving (review follow-up on
      //      #339, second-review pass).
      // Re-reading the new RM's role HERE, after the lock, closes it: by the
      // time this read runs, updateUserRole()'s transaction has either fully
      // committed (role is genuinely MANAGER now, so this correctly throws)
      // or is blocked waiting for the same row lock (so it cannot demote out
      // from under this transaction after this point).
      if (isTransfer) {
        const newManager = await tx.user.findUnique({
          where: { id: nextRegionalManagerUserId },
          select: { role: true, deleted_at: true },
        });
        if (!newManager || newManager.deleted_at || newManager.role !== 'REGIONAL_MANAGER') {
          throw new ValidationError('regional_manager_user_id must reference a user already holding the Regional Manager role', [
            { field: 'regional_manager_user_id', message: 'User is not a Regional Manager' },
          ]);
        }
      }

      const hotelGroup = await tx.hotelGroup.findUnique({ where: { id: hotelGroupId } });
      if (!hotelGroup) throw new NotFoundError('Hotel group not found');

      const result = await tx.hotelGroup.update({
        where: { id: hotelGroupId },
        data: {
          name: data.name ?? hotelGroup.name,
          billing_info: data.billing_info ?? hotelGroup.billing_info,
          regional_manager_user_id: nextRegionalManagerUserId,
        },
      });

      if (isTransfer) {
        // Both the outgoing RM (loses access to this group) and the incoming
        // RM (whose scope claim must now resolve to this group, not
        // whatever they had before) need their already-issued tokens
        // invalidated — otherwise a live token keeps carrying the stale
        // `scope` claim (minted at login/refresh, never re-derived
        // per-request, middleware/auth.ts) for up to JWT_ACCESS_EXPIRY.
        await bumpTokenGeneration(tx, existing.regional_manager_user_id);
        await bumpTokenGeneration(tx, nextRegionalManagerUserId);
      }

      return result;
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroupId, { fields: Object.keys(data) }, ip);
    if (isTransfer) {
      await this.logAudit(
        actorId,
        actorRole,
        'MODIFY',
        'HOTEL_GROUP',
        hotelGroupId,
        {
          action: 'token_generation_bumped',
          reason: 'regional_manager_transfer',
          outgoing_user_id: existing.regional_manager_user_id,
          incoming_user_id: nextRegionalManagerUserId,
        },
        ip
      );
    }
    return updated;
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
