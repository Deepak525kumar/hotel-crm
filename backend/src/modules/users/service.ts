import bcrypt from 'bcryptjs';
import { BaseService } from '../../lib/base-service.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../lib/errors.js';
import { BCRYPT_ROUNDS, ROLE_PERMISSIONS } from '../../config/constants.js';
import { bumpTokenGeneration } from '../auth/service.js';
import {
  CreateUserRequest,
  UpdateUserRequest,
  UpdateUserProfileRequest,
  UpdateUserRoleRequest,
  ListUsersQuery,
} from './types.js';
import { resolveNonAdminScopeFilter, isWorkerInGroupScope, isScopedManagerRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';

export class UserService extends BaseService {
  // ADR-030 PR-4 (D-7, C-14): GET /users was previously unscoped for
  // manager/regional_manager — any manager could list every user regardless
  // of hotel/group. `actor` is optional so existing internal callers (none
  // currently) keep compiling; the controller always passes it.
  async listUsers(query: ListUsersQuery, actor?: { role: string; scope?: UserScope | null }) {
    const { page, limit, role, hotel_id, search, is_active } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deleted_at: null };

    if (role) where['role'] = role.toUpperCase();
    if (is_active !== undefined) where['is_active'] = is_active === 'true';

    // Resolve the explicit ?hotel_id filter (if any) to its group, same as
    // before PR-4 — kept separate from the scope filter below so the two can
    // be reconciled rather than one silently overwriting the other.
    let targetGroupId: string | undefined;
    if (hotel_id) {
      const hotel = await this.prisma.hotel.findUnique({
        where: { id: hotel_id },
        select: { hotel_group_id: true },
      });
      targetGroupId = hotel?.hotel_group_id ?? '__none__';
    }

    // Default-deny shape (security review finding FIND-01, ADR-030 PR-4):
    // admin is the only explicit bypass; every other actor — manager,
    // regional_manager, or any role added to this route's guard in the
    // future without a matching update here — is scope-resolved, not
    // allowlisted by role name. `resolveNonAdminScopeFilter` enforces (and
    // logs) the invariant that a non-admin actor never resolves to global
    // scope, rather than silently bypassing on that "shouldn't occur" case.
    if (actor && actor.role !== 'admin') {
      const scopeFilter = await resolveNonAdminScopeFilter(actor.role, actor.scope ?? null);
      if (scopeFilter.kind === 'deny') {
        where['id'] = '__none__';
      } else {
        // An explicit ?hotel_id outside the actor's own scope must not widen
        // it — deny rather than let the client-supplied filter win.
        if (targetGroupId && targetGroupId !== scopeFilter.hotelGroupId) {
          where['id'] = '__none__';
        } else {
          targetGroupId = scopeFilter.hotelGroupId;
        }
      }
    }

    if (targetGroupId) {
      where['employment_record'] = { hotel_group_id: targetGroupId, status: 'ACTIVE' };
    }
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
          is_active: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
      // stored column (dropped).
      users: users.map((u: { id: string; email: string; first_name: string; last_name: string; phone: string | null; profile_photo_url: string | null; role: string; is_active: boolean; created_at: Date; updated_at: Date }) => ({ ...u, role: u.role.toLowerCase(), permissions: ROLE_PERMISSIONS[u.role] ?? [] })),
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

  async getUser(userId: string, actorId: string, actorRole: string, actorScope: UserScope | null, ip?: string) {
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
        is_active: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
      },
    });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    // Read-side counterpart of updateUser's scope check: a manager/RM could
    // otherwise read any user's full profile platform-wide (a read-only
    // IDOR), holding `users:read` with no route-level scope gate. `checker`
    // is deliberately left unscoped here, matching its documented
    // cross-hotel bypass elsewhere in this module (isSelfScopedRole).
    // Self-read is exempt (a manager viewing their OWN profile, e.g. the
    // /users/:id detail page they now have a nav link to) — same exemption
    // as updateUser's target-role/scope check.
    if (isScopedManagerRole(actorRole) && userId !== actorId) {
      if (user.role !== 'WORKER' && user.role !== 'CHECKER') {
        throw new ForbiddenError('User not in your scope');
      }
      const inScope = await isWorkerInGroupScope(actorScope, userId);
      if (!inScope) throw new ForbiddenError('User not in your scope');
    }

    await this.logAudit(actorId, actorRole, 'VIEW', 'USER', userId, {}, ip);
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    return { ...user, role: user.role.toLowerCase(), permissions: ROLE_PERMISSIONS[user.role] ?? [], deleted_at: undefined };
  }

  async createUser(data: CreateUserRequest, actorId: string, actorRole: string, ip?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictError('Email already registered');

    // SECURITY (HOTFIX-AUTH-003): assigning a privileged role is a server-side
    // authority decision, not a caller-supplied one. The authenticated admin-
    // creation workflow is role-gated to {admin, manager} at the route, but a
    // manager must not be able to mint an ADMIN account through this path.
    // Mirror the elevation guard already enforced on updateUser: only an admin
    // may assign the admin role. Preserves the legitimate admin-creates-admin
    // and manager-creates-worker/checker/manager workflows.
    if (data.role === 'admin' && actorRole !== 'admin') {
      throw new ForbiddenError('Only admins can assign admin role');
    }

    const password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const role = data.role.toUpperCase() as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN' | 'REGIONAL_MANAGER';

    // ADR-031 D-1/D-4 (PR-4): permissions are derived request-time from
    // ROLE_PERMISSIONS[role] — this write path no longer computes or
    // persists a snapshot into User.permissions.
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password_hash,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        role,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        role: true,
        is_active: true,
        created_at: true,
      },
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', user.id, { action: 'create', email: user.email }, ip);
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    return { ...user, role: user.role.toLowerCase(), permissions: ROLE_PERMISSIONS[user.role] ?? [] };
  }

  async updateUser(
    userId: string,
    data: UpdateUserRequest,
    actorId: string,
    actorRole: string,
    actorScope: UserScope | null,
    ip?: string
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    // ADR-030 PR-1 (C-15 / SIR-AUTH-019): the pre-existing guard below only
    // checked the incoming role, never the target's current one — a non-admin
    // actor sending a payload with no `role` field at all sailed straight
    // through against a user whose current role is already ADMIN. Non-admins
    // may not modify an existing admin account at all, regardless of payload.
    if (actorRole !== 'admin' && user.role === 'ADMIN') {
      throw new ForbiddenError('Only admins can modify admin accounts');
    }

    // Prevent non-admins from elevating to admin
    if (data.role === 'admin' && actorRole !== 'admin') {
      throw new ForbiddenError('Only admins can assign admin role');
    }

    // This is the flag-off (default) legacy path — it never had a scope
    // check at all, so a manager/regional_manager reachable at the route
    // (`requireRole(['admin','manager','regional_manager'])`) could update
    // or deactivate any non-admin user platform-wide — the same bug class
    // fixed for assignments in PR #344. Product decision (2026-08-06): a
    // scoped manager/RM may only edit worker/checker targets, and only ones
    // already on their group's roster (an EmploymentRecord assigned to a
    // hotel_group) — never another admin/manager/RM, and never a worker who
    // hasn't been onboarded yet (that's an Admin-only action until then).
    // Self-edit is exempt from the target-role/scope check below (a manager
    // editing their OWN name/phone isn't "modifying a manager account" in
    // the sense that rule is guarding against) — `data.role`/elevation are
    // already blocked above regardless of actor/target.
    // Kept as `actorRole !== 'admin'` (deny-list), not isScopedManagerRole
    // (allow-list): this route is admin/manager/RM-only today, but a
    // deny-list fails safe if a future role were ever added to it, where an
    // allow-list would silently skip the check for that new role.
    if (actorRole !== 'admin' && userId !== actorId) {
      if (user.role !== 'WORKER' && user.role !== 'CHECKER') {
        throw new ForbiddenError('Only admins can modify manager or admin accounts');
      }
      const inScope = await isWorkerInGroupScope(actorScope, userId);
      if (!inScope) throw new ForbiddenError('User not in your scope');
    }

    const newRole = data.role ? (data.role.toUpperCase() as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN') : user.role;
    const newIsActive = data.is_active ?? user.is_active;

    // ADR-031 D-4 (C-5): a role change or deactivation must invalidate
    // already-issued access tokens atomically with the state change itself —
    // a bump committed separately from its trigger could be lost, leaving a
    // demoted/deactivated user holding a valid token.
    const shouldBump = newRole !== user.role || (newIsActive === false && user.is_active !== false);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: userId },
        data: {
          first_name: data.first_name ?? user.first_name,
          last_name: data.last_name ?? user.last_name,
          // Empty string is a real, non-null value for the @unique phone
          // column — passing it through collides with any other user who
          // also has no phone number, surfacing as a false "already exists".
          phone: data.phone !== undefined ? (data.phone?.trim() || null) : user.phone,
          role: newRole,
          is_active: newIsActive,
        },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          phone: true,
          role: true,
          is_active: true,
          updated_at: true,
        },
      });
      if (shouldBump) {
        await bumpTokenGeneration(tx, userId);
      }
      return result;
    });

    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { fields: Object.keys(data) }, ip);
    if (shouldBump) {
      await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { action: 'token_generation_bumped', reason: newRole !== user.role ? 'role_change' : 'deactivation' }, ip);
    }
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    return { ...updated, role: updated.role.toLowerCase(), permissions: ROLE_PERMISSIONS[updated.role] ?? [] };
  }

  // ADR-030 D-4a/D-4: the profile-only half of the PUT /users/:id split
  // (used once FEATURE_GD02_MATRIX is on). No `role` parameter exists on
  // this method at all — there is no field for an elevation guard to police,
  // because the code path cannot express a role change (the schema already
  // enforced that at the boundary, UpdateUserProfileSchema.strict()).
  async updateUserProfile(
    userId: string,
    data: UpdateUserProfileRequest,
    actorId: string,
    actorRole: string,
    actorScope: UserScope | null,
    ip?: string
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    // A scoped manager/regional_manager may only touch a profile within
    // their own group — mirrors the HR module's identical worker-scope
    // check (isWorkerInGroupScope), reused here rather than duplicated.
    if (actorRole !== 'admin') {
      const inScope = await isWorkerInGroupScope(actorScope, userId);
      if (!inScope) throw new ForbiddenError('User not in your scope');
    }

    const newIsActive = data.is_active ?? user.is_active;
    const shouldBump = newIsActive === false && user.is_active !== false;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: userId },
        data: {
          first_name: data.first_name ?? user.first_name,
          last_name: data.last_name ?? user.last_name,
          // See updateUser: empty string must not hit the @unique phone column.
          phone: data.phone !== undefined ? (data.phone?.trim() || null) : user.phone,
          is_active: newIsActive,
        },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          phone: true,
          role: true,
          is_active: true,
          updated_at: true,
        },
      });
      if (shouldBump) {
        await bumpTokenGeneration(tx, userId);
      }
      return result;
    });

    await this.logAudit(actorId, actorRole, 'UPDATE_PROFILE', 'USER', userId, { fields: Object.keys(data) }, ip);
    if (shouldBump) {
      await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { action: 'token_generation_bumped', reason: 'deactivation' }, ip);
    }
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    return { ...updated, role: updated.role.toLowerCase(), permissions: ROLE_PERMISSIONS[updated.role] ?? [] };
  }

  // ADR-030 D-4a: the Admin-only role-assignment half of the split
  // (PUT /users/:id/role). Carries forward the C-15 fix (SIR-AUTH-019): the
  // target's CURRENT role is checked, not merely the incoming value — an
  // admin-only route makes this defense-in-depth rather than a live gap
  // (only admin ever reaches this method), but the check costs nothing to
  // keep and documents the invariant explicitly.
  async updateUserRole(userId: string, data: UpdateUserRoleRequest, actorId: string, actorRole: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    if (actorRole !== 'admin' && user.role === 'ADMIN') {
      throw new ForbiddenError('Only admins can modify admin accounts');
    }
    if (actorRole !== 'admin') {
      throw new ForbiddenError('Only admins can assign roles');
    }

    const newRole = data.role.toUpperCase() as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN' | 'REGIONAL_MANAGER';

    // ADR-031 D-4 (C-5): the token_generation bump commits in the same
    // transaction as the role write, so a demotion can never be committed
    // without also invalidating the demoted user's already-issued access
    // token.
    //
    // Vacancy model (2026-08-06, supersedes Regional Manager V1 Decision 11's
    // "transfer OR remove" block): a Hotel Group / Hotel no longer requires
    // an immediate replacement before its RM/manager can be demoted --
    // demoting instead auto-clears the assignment (vacancy reason DEMOTED)
    // and records it in the paired *AssignmentHistory table, rather than
    // throwing ConflictError. The TOCTOU-closing shape is unchanged: the
    // group/hotel lookup and clear still happen inside this transaction,
    // after the row lock below, not as a separate unlocked pre-check.
    //
    // Lock order is User FIRST, then HotelGroup/Hotel — always, in both this
    // method and `crm/service.ts#updateHotelGroup`/`updateHotel` (which lock
    // the outgoing/incoming manager's User rows for their own
    // token_generation bump). Two operations that both touch User and
    // HotelGroup/Hotel but disagree on ordering is exactly how a
    // demote-vs-transfer race becomes a deadlock instead of a clean
    // serialization; all call sites acquire in this same order so Postgres
    // always serializes them, never deadlocks.
    const updated = await this.prisma.$transaction(async (tx) => {
      // Row lock on the target user — blocks a concurrent transfer's own
      // User-row lock (crm/service.ts) until this transaction commits or
      // rolls back, closing the race window entirely.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const now = new Date();

      if (user.role === 'REGIONAL_MANAGER' && newRole !== 'REGIONAL_MANAGER') {
        const ownedGroup = await tx.hotelGroup.findUnique({
          where: { regional_manager_user_id: userId },
          select: { id: true },
        });
        if (ownedGroup) {
          await tx.hotelGroup.update({
            where: { id: ownedGroup.id },
            data: {
              regional_manager_user_id: null,
              regional_manager_assigned_at: null,
              regional_manager_vacated_at: now,
              regional_manager_vacancy_reason: 'DEMOTED',
            },
          });
          await tx.regionalManagerAssignmentHistory.updateMany({
            where: { hotel_group_id: ownedGroup.id, regional_manager_user_id: userId, unassigned_at: null },
            data: { unassigned_at: now, unassigned_by_id: actorId, reason: 'DEMOTED' },
          });
        }
      }

      // Same demotion-vacates-the-assignment behavior for a Hotel Manager
      // being demoted, mirroring the RM branch above -- this guard never
      // existed before (Hotel.manager_user_id had no ownership check at
      // all), so a demoted MANAGER could silently keep a hotel's
      // manager_user_id pointing at them with no actual manager authority.
      if (user.role === 'MANAGER' && newRole !== 'MANAGER') {
        const managedHotels = await tx.hotel.findMany({
          where: { manager_user_id: userId },
          select: { id: true },
        });
        for (const hotel of managedHotels) {
          await tx.hotel.update({
            where: { id: hotel.id },
            data: {
              manager_user_id: null,
              manager_assigned_at: null,
              manager_vacated_at: now,
              manager_vacancy_reason: 'DEMOTED',
            },
          });
          await tx.hotelManagerAssignmentHistory.updateMany({
            where: { hotel_id: hotel.id, manager_user_id: userId, unassigned_at: null },
            data: { unassigned_at: now, unassigned_by_id: actorId, reason: 'DEMOTED' },
          });
        }
      }

      const result = await tx.user.update({
        where: { id: userId },
        data: { role: newRole },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          phone: true,
          role: true,
          is_active: true,
          updated_at: true,
        },
      });
      await bumpTokenGeneration(tx, userId);
      return result;
    });

    await this.logAudit(actorId, actorRole, 'UPDATE_ROLE', 'USER', userId, { new_role: newRole }, ip);
    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { action: 'token_generation_bumped', reason: 'role_change' }, ip);
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    return { ...updated, role: updated.role.toLowerCase(), permissions: ROLE_PERMISSIONS[updated.role] ?? [] };
  }

  async deleteUser(userId: string, actorId: string, actorRole: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');
    if (userId === actorId) throw new ForbiddenError('Cannot delete your own account');

    // ADR-031 D-4 (C-5): bump commits with the soft delete itself — a
    // deleted account must never remain authorizable on its already-issued
    // access token (SIR-USERS-015, emergency-removal case).
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { deleted_at: new Date(), is_active: false },
      });
      await bumpTokenGeneration(tx, userId);
    });

    await this.logAudit(actorId, actorRole, 'DELETE', 'USER', userId, { email: user.email }, ip);
    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { action: 'token_generation_bumped', reason: 'soft_delete' }, ip);
  }
}

export const userService = new UserService();
