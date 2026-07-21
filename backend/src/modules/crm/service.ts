import { BaseService } from '../../lib/base-service.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import {
  CreateHotelRequest, UpdateHotelRequest,
  ListHotelsQuery,
  CreateHotelGroupRequest, UpdateHotelGroupRequest,
  ListHotelGroupsQuery,
} from './types.js';

export class CrmService extends BaseService {
  // ── Hotels ─────────────────────────────────────────────────────────────────

  async listHotels(query: ListHotelsQuery, actorRole: string) {
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

    // Non-admins/managers see only active hotels
    if (!['admin', 'manager'].includes(actorRole)) {
      where['is_active'] = true;
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

    const updated = await this.prisma.hotel.update({
      where: { id: hotelId },
      data: {
        name: data.name ?? hotel.name,
        city: data.city ?? hotel.city,
        country: data.country ?? hotel.country,
        address: data.address ?? hotel.address,
        timezone: data.timezone ?? hotel.timezone,
        is_active: data.is_active ?? hotel.is_active,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL', hotelId, { fields: Object.keys(data) }, ip);
    return updated;
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

  private async assertRegionalManagerExists(regionalManagerUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: regionalManagerUserId } });
    if (!user || user.deleted_at) {
      throw new ValidationError('regional_manager_user_id does not reference an existing user', [
        { field: 'regional_manager_user_id', message: 'User not found' },
      ]);
    }
  }

  async listHotelGroups(query: ListHotelGroupsQuery) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [hotelGroups, total] = await Promise.all([
      this.prisma.hotelGroup.findMany({
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.hotelGroup.count(),
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

  async getHotelGroup(hotelGroupId: string, actorId: string, actorRole: string, ip?: string) {
    const hotelGroup = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!hotelGroup) throw new NotFoundError('Hotel group not found');

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

  async updateHotelGroup(hotelGroupId: string, data: UpdateHotelGroupRequest, actorId: string, actorRole: string, ip?: string) {
    const hotelGroup = await this.prisma.hotelGroup.findUnique({ where: { id: hotelGroupId } });
    if (!hotelGroup) throw new NotFoundError('Hotel group not found');

    if (data.regional_manager_user_id !== undefined) {
      await this.assertRegionalManagerExists(data.regional_manager_user_id);
    }

    const updated = await this.prisma.hotelGroup.update({
      where: { id: hotelGroupId },
      data: {
        name: data.name ?? hotelGroup.name,
        billing_info: data.billing_info ?? hotelGroup.billing_info,
        regional_manager_user_id: data.regional_manager_user_id ?? hotelGroup.regional_manager_user_id,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'HOTEL_GROUP', hotelGroupId, { fields: Object.keys(data) }, ip);
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
