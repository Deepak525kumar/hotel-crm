import bcrypt from 'bcryptjs';
import { BaseService } from '../../lib/base-service.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../lib/errors.js';
import { ROLE_PERMISSIONS, BCRYPT_ROUNDS } from '../../config/constants.js';
import { CreateUserRequest, UpdateUserRequest, ListUsersQuery } from './types.js';

export class UserService extends BaseService {
  async listUsers(query: ListUsersQuery) {
    const { page, limit, role, hotel_id, search, is_active } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deleted_at: null };

    if (role) where['role'] = role.toUpperCase();
    if (is_active !== undefined) where['is_active'] = is_active === 'true';
    if (hotel_id) where['hotel_workers'] = { some: { hotel_id, status: 'ACTIVE' } };
    if (search) {
      where['OR'] = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          phone: true,
          profile_photo_url: true,
          role: true,
          permissions: true,
          is_active: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u: { id: string; email: string; first_name: string; last_name: string; phone: string | null; profile_photo_url: string | null; role: string; permissions: string[]; is_active: boolean; created_at: Date; updated_at: Date }) => ({ ...u, role: u.role.toLowerCase() })),
      pagination: {
        page,
        per_page: limit,
        total,
        total_pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_prev: page > 1,
      },
    };
  }

  async getUser(userId: string, actorId: string, actorRole: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        profile_photo_url: true,
        role: true,
        permissions: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    await this.logAudit(actorId, actorRole, 'VIEW', 'USER', userId, {}, ip);
    return { ...user, role: user.role.toLowerCase(), deleted_at: undefined };
  }

  async createUser(data: CreateUserRequest, actorId: string, actorRole: string, ip?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictError('Email already registered');

    const password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const role = data.role.toUpperCase() as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN';
    const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['WORKER'];

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password_hash,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        role,
        permissions: permissions ?? [],
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        role: true,
        permissions: true,
        is_active: true,
        created_at: true,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', user.id, { action: 'create', email: user.email }, ip);
    return { ...user, role: user.role.toLowerCase() };
  }

  async updateUser(userId: string, data: UpdateUserRequest, actorId: string, actorRole: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    // Prevent non-admins from elevating to admin
    if (data.role === 'admin' && actorRole !== 'admin') {
      throw new ForbiddenError('Only admins can assign admin role');
    }

    const newRole = data.role ? (data.role.toUpperCase() as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN') : user.role;
    const permissions = data.role ? (ROLE_PERMISSIONS[newRole] ?? user.permissions) : user.permissions;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        first_name: data.first_name ?? user.first_name,
        last_name: data.last_name ?? user.last_name,
        phone: data.phone ?? user.phone,
        role: newRole,
        permissions: permissions ?? user.permissions,
        is_active: data.is_active ?? user.is_active,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        role: true,
        permissions: true,
        is_active: true,
        updated_at: true,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { fields: Object.keys(data) }, ip);
    return { ...updated, role: updated.role.toLowerCase() };
  }

  async deleteUser(userId: string, actorId: string, actorRole: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');
    if (userId === actorId) throw new ForbiddenError('Cannot delete your own account');

    await this.prisma.user.update({
      where: { id: userId },
      data: { deleted_at: new Date(), is_active: false },
    });

    await this.logAudit(actorId, actorRole, 'DELETE', 'USER', userId, { email: user.email }, ip);
  }
}

export const userService = new UserService();
