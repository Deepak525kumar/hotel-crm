import bcrypt from 'bcryptjs';
import { BaseService } from '../../lib/base-service.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import { BCRYPT_ROUNDS, ROLE_PERMISSIONS } from '../../config/constants.js';
import { logger } from '../../lib/logger.js';
import { bumpTokenGeneration } from '../auth/service.js';
import {
  CreateUserRequest,
  UpdateUserRequest,
  UpdateUserProfileRequest,
  UpdateUserRoleRequest,
  ListUsersQuery,
} from './types.js';
import { resolveNonAdminScopeFilter, isWorkerInGroupScope, isScopedManagerRole } from '../../lib/scope.js';
import { canCreateRole, createRoleDenialMessage } from '../../lib/role-hierarchy.js';
import type { UserScope } from '../../lib/jwt.js';
import type { AuthContext } from '../../lib/types.js';
// ADR-065 (Universal Onboarding Gate): createUser() below auto-creates the
// linked EmploymentRecord for every non-admin account. No existing import
// cycle risk -- employee-management/service.ts imports hr/service.ts, but
// neither imports users/service.ts.
import { employeeManagementService } from '../employee-management/service.js';

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
        created_by_id: true,
      },
    });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    // Read-side counterpart of updateUser's scope check: a manager/RM could
    // otherwise read any user's full profile platform-wide (a read-only
    // IDOR), holding `users:read` with no route-level scope gate. This lack of
    // a route-level scope gate is an accepted, intentional exception to the
    // platform's defense-in-depth pattern because the generic route middleware
    // cannot express the self-read exemption or target-role constraints below.
    // `checker` is deliberately left unscoped here, matching its documented
    // cross-hotel bypass elsewhere in this module (isSelfScopedRole).
    // Self-read is exempt (a manager viewing their OWN profile, e.g. the
    // /users/:id detail page they now have a nav link to) — same exemption
    // as updateUser's target-role/scope check.
    if (isScopedManagerRole(actorRole) && userId !== actorId) {
      if (user.role !== 'WORKER' && user.role !== 'CHECKER') {
        throw new ForbiddenError('User not in your scope');
      }
      // 2026-08-13 fix: a freshly-created worker/checker has no
      // EmploymentRecord yet (created separately, later, via POST
      // /employees) -- isWorkerInGroupScope has nothing to check against and
      // always denies, so the manager/RM who JUST created this account could
      // never view the profile they were redirected to. The creator is
      // exempted from the scope check for their own creation, closing the
      // gap without reopening an IDOR: only the actual creator gets this,
      // not every manager who happens to share a scope, and it stops
      // mattering the moment a real EmploymentRecord exists (the branch
      // below still runs for everyone else, and for the creator too once
      // isWorkerInGroupScope would itself resolve true).
      if (user.created_by_id !== actorId) {
        const inScope = await isWorkerInGroupScope(actorScope, userId);
        if (!inScope) throw new ForbiddenError('User not in your scope');
      }
    }

    await this.logAudit(actorId, actorRole, 'VIEW', 'USER', userId, {}, ip);
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped). created_by_id is authorization-internal
    // (used only in the scope check above) and never sent to the client.
    return {
      ...user,
      role: user.role.toLowerCase(),
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
      deleted_at: undefined,
      created_by_id: undefined,
    };
  }

  async createUser(data: CreateUserRequest, actor: AuthContext, ip?: string) {
    const actorId = actor.userId;
    const actorRole = actor.role;
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictError('Email already registered');

    // RULE A (project-owner decision, 2026-08-12): create is 1-level-down
    // ONLY — admin->regional_manager, regional_manager->manager,
    // manager->worker|checker, worker/checker->nobody. See
    // lib/role-hierarchy.ts.
    //
    // This SUPERSEDES the HOTFIX-AUTH-003 guard that stood here, which only
    // blocked a non-admin from minting an `admin` and said nothing about any
    // other target role. It is strictly stronger: `admin` is now creatable by
    // NOBODY (it is not one-level-down from anything), so the old guard's
    // property is subsumed rather than dropped.
    //
    // The route gate (routes.ts) admits the three creator roles; THIS is the
    // check that decides which role each of them may mint, and it is the only
    // place that decision is made for account creation.
    if (!canCreateRole(actorRole, data.role)) {
      throw new ForbiddenError(createRoleDenialMessage(actorRole, data.role));
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
        // 2026-08-13 fix: closes the gap where a manager/RM who just
        // created a worker/checker account could not view that profile
        // afterward (getUser()'s scope check has nothing to check against
        // until an EmploymentRecord exists, which happens later) — see
        // getUser()'s own comment.
        created_by_id: actorId,
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

    // ADR-065 (Universal Onboarding Gate, ratified 2026-08-11): every
    // non-Admin account -- Worker, Checker, Manager, AND Regional Manager --
    // gets an EmploymentRecord (Pending) the moment the account exists, so
    // the new user can self-service their own onboarding immediately on
    // first login, with no separate "Start onboarding" step for anyone.
    // Delegates to employeeManagementService.createEmployee() rather than
    // duplicating its RULE A / per-role target-scope logic: `actor` here has
    // ALREADY passed canCreateRole() above for this exact (actorRole,
    // data.role) pair, so createEmployee()'s own identical check is
    // redundant defense-in-depth, not a second gate that could disagree.
    // employee_id is server-generated (never user-supplied -- there is no
    // manual creation form anymore) from the new user's own id, which is
    // already globally unique, so no separate uniqueness check is needed.
    //
    // Best-effort, like generateDefaultContract() below it in the call
    // chain: a failure here must not roll back the just-created User account
    // (the account is real and useful on its own -- login, profile -- even
    // if onboarding setup hiccups). Logged loudly rather than silently
    // swallowed; an admin can always create the missing record by hand via
    // the pre-existing POST /employees route if this ever happens.
    if (role !== 'ADMIN') {
      try {
        await employeeManagementService.createEmployee(actor, {
          user_id: user.id,
          employee_id: `EMP-${user.id.slice(-10).toUpperCase()}`,
          job_title: data.job_title!,
          start_date: data.start_date!,
          employment_type: data.employment_type!,
        });
      } catch (error) {
        logger.error('user_create_employment_record_failed', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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

    const newIsActive = data.is_active ?? user.is_active;

    // ADR-031 D-4 (C-5): a deactivation must invalidate already-issued access
    // tokens atomically with the state change itself — a bump committed
    // separately from its trigger could be lost, leaving a deactivated user
    // holding a valid token. `role` no longer flows through this method at
    // all (see UpdateUserSchema's comment) — updateUserRole is the sole
    // trigger for a role-change bump.
    const shouldBump = newIsActive === false && user.is_active !== false;

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
      await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { action: 'token_generation_bumped', reason: 'deactivation' }, ip);
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

    // IDOR fix (2026-08-08): mirrors updateUser's C-15/SIR-AUTH-019 target-
    // role check, missing here entirely -- isWorkerInGroupScope alone only
    // verifies GROUP membership, never the target's ROLE, so a manager/RM
    // in-group could tamper with another manager's, RM's, or admin's profile
    // (name/phone/is_active) as long as that target happened to carry an
    // EmploymentRecord in the same group. Self-edit is exempt, same as
    // updateUser: a manager editing their OWN profile isn't "modifying a
    // manager account" in the sense this guard exists to block, and it
    // would otherwise incorrectly deny a manager/RM who (unlike a worker)
    // may have no EmploymentRecord at all to resolve a group from.
    if (actorRole !== 'admin' && userId !== actorId) {
      if (user.role !== 'WORKER' && user.role !== 'CHECKER') {
        throw new ForbiddenError('Only admins can modify manager or admin accounts');
      }
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
  //
  // Person-centric assignment redesign (2026-08-07): this is now the SOLE
  // write path for Hotel.manager_user_id, HotelGroup.regional_manager_user_id,
  // and EmploymentRecord.hotel_group_id/primary_hotel_id. `updateUser` (PUT
  // /users/:id) no longer accepts `role` at all, closing the data-integrity
  // bug where a role change via that endpoint could leave a stale manager/RM
  // pointer behind. See UpdateUserRoleSchema's comment for the payload shape.
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

    // Target-assignment payload validation, at the boundary: a hotel_id is
    // only meaningful for the manager role, a hotel_group_id only for
    // regional_manager (or as a worker/checker's EmploymentRecord group).
    // Reject a mismatched pairing rather than silently ignoring it -- a
    // caller sending { role: 'worker', hotel_id } has misunderstood the API
    // and should be told, not have the field quietly dropped.
    //
    // Deliberately NOT requiring hotel_id/hotel_group_id when assigning
    // manager/regional_manager: the vacancy model (2026-08-06) established
    // that a hotel/group may sit vacant and, symmetrically, a manager may
    // hold the role without a current posting. Demoting an RM to plain
    // manager, or promoting a worker ahead of deciding their hotel, are both
    // legitimate -- forcing a hotel_id here would make the first impossible.
    // The assignment is simply skipped when no target is supplied.
    if (data.hotel_id && newRole !== 'MANAGER') {
      throw new ValidationError('hotel_id is only valid when assigning the manager role', [
        { field: 'hotel_id', message: 'Only valid when role is manager' },
      ]);
    }
    if (data.hotel_group_id && newRole !== 'REGIONAL_MANAGER' && newRole !== 'WORKER' && newRole !== 'CHECKER') {
      throw new ValidationError('hotel_group_id is only valid for regional_manager, worker, or checker', [
        { field: 'hotel_group_id', message: 'Not valid for this role' },
      ]);
    }
    if (data.primary_hotel_id && newRole !== 'WORKER' && newRole !== 'CHECKER') {
      throw new ValidationError('primary_hotel_id is only valid for worker or checker', [
        { field: 'primary_hotel_id', message: 'Only valid for worker or checker' },
      ]);
    }

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

      // Vacate this user's OWN prior manager/RM slot whenever they are
      // leaving that role — covers both "moving away" (any newRole) and, for
      // MANAGER -> REGIONAL_MANAGER in one call, ensures the stale hotel
      // manager slot is cleared in the SAME transaction as the new RM
      // assignment below (never left dangling between two separate calls).
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
      // being demoted/transitioning away, mirroring the RM branch above --
      // this guard never existed before (Hotel.manager_user_id had no
      // ownership check at all), so a demoted MANAGER could silently keep a
      // hotel's manager_user_id pointing at them with no actual manager
      // authority. Also covers the same-hotel transfer case below (a
      // MANAGER being reassigned to a DIFFERENT hotel in the same call):
      // the OLD hotel is vacated here (reason TRANSFERRED), and the NEW
      // hotel is assigned further down.
      if (user.role === 'MANAGER' && (newRole !== 'MANAGER' || data.hotel_id !== undefined)) {
        const managedHotels = await tx.hotel.findMany({
          where: { manager_user_id: userId },
          select: { id: true },
        });
        const isTransferringAway = newRole === 'MANAGER';
        for (const hotel of managedHotels) {
          // If staying MANAGER, only vacate hotels OTHER than the target
          // (i.e. an actual transfer); if leaving MANAGER entirely, vacate
          // every hotel this user currently manages.
          if (isTransferringAway && hotel.id === data.hotel_id) continue;
          await tx.hotel.update({
            where: { id: hotel.id },
            data: {
              manager_user_id: null,
              manager_assigned_at: null,
              manager_vacated_at: now,
              manager_vacancy_reason: isTransferringAway ? 'TRANSFERRED' : 'DEMOTED',
            },
          });
          await tx.hotelManagerAssignmentHistory.updateMany({
            where: { hotel_id: hotel.id, manager_user_id: userId, unassigned_at: null },
            data: { unassigned_at: now, unassigned_by_id: actorId, reason: isTransferringAway ? 'TRANSFERRED' : 'DEMOTED' },
          });
        }
      }

      // ── New assignment: role = manager ──────────────────────────────────
      if (newRole === 'MANAGER' && data.hotel_id) {
        // Lock the target hotel row before reading/writing it — closes the
        // TOCTOU window between this read and the write below (two
        // concurrent assignments targeting the same hotel must serialize,
        // not both believe the slot is free).
        await tx.$queryRaw`SELECT id FROM "Hotel" WHERE id = ${data.hotel_id} FOR UPDATE`;
        const targetHotel = await tx.hotel.findUnique({ where: { id: data.hotel_id } });
        if (!targetHotel || targetHotel.deleted_at) {
          throw new NotFoundError('Target hotel not found');
        }
        // One manager per hotel, enforced here at the service level — Hotel.
        // manager_user_id has no DB unique constraint (unlike HotelGroup.
        // regional_manager_user_id, which is @unique), so this business rule
        // must be checked explicitly rather than relying on the schema.
        if (targetHotel.manager_user_id && targetHotel.manager_user_id !== userId) {
          throw new ConflictError('Hotel already has a different manager assigned');
        }

        if (targetHotel.manager_user_id !== userId) {
          await tx.hotel.update({
            where: { id: data.hotel_id },
            data: {
              manager_user_id: userId,
              manager_assigned_at: now,
              manager_vacated_at: null,
              manager_vacancy_reason: null,
            },
          });
          await tx.hotelManagerAssignmentHistory.create({
            data: {
              hotel_id: data.hotel_id,
              manager_user_id: userId,
              assigned_at: now,
              assigned_by_id: actorId,
            },
          });
        }
      }

      // ── New assignment: role = regional_manager ─────────────────────────
      if (newRole === 'REGIONAL_MANAGER' && data.hotel_group_id) {
        await tx.$queryRaw`SELECT id FROM "HotelGroup" WHERE id = ${data.hotel_group_id} FOR UPDATE`;
        const targetGroup = await tx.hotelGroup.findUnique({ where: { id: data.hotel_group_id } });
        if (!targetGroup) {
          throw new NotFoundError('Target hotel group not found');
        }
        // regional_manager_user_id IS @unique in the schema, but the
        // business rule is still checked explicitly here (rather than
        // relying on the DB to reject with an opaque unique-violation) so
        // the caller gets a clean ConflictError, consistent with the manager
        // branch above.
        if (targetGroup.regional_manager_user_id && targetGroup.regional_manager_user_id !== userId) {
          throw new ConflictError('Hotel group already has a different regional manager assigned');
        }

        if (targetGroup.regional_manager_user_id !== userId) {
          // If this same user currently manages a DIFFERENT group, vacate it
          // first (transfer, mirroring the manager branch's own-hotel
          // transfer handling).
          const ownedGroup = await tx.hotelGroup.findUnique({
            where: { regional_manager_user_id: userId },
            select: { id: true },
          });
          if (ownedGroup && ownedGroup.id !== data.hotel_group_id) {
            await tx.hotelGroup.update({
              where: { id: ownedGroup.id },
              data: {
                regional_manager_user_id: null,
                regional_manager_assigned_at: null,
                regional_manager_vacated_at: now,
                regional_manager_vacancy_reason: 'TRANSFERRED',
              },
            });
            await tx.regionalManagerAssignmentHistory.updateMany({
              where: { hotel_group_id: ownedGroup.id, regional_manager_user_id: userId, unassigned_at: null },
              data: { unassigned_at: now, unassigned_by_id: actorId, reason: 'TRANSFERRED' },
            });
          }

          await tx.hotelGroup.update({
            where: { id: data.hotel_group_id },
            data: {
              regional_manager_user_id: userId,
              regional_manager_assigned_at: now,
              regional_manager_vacated_at: null,
              regional_manager_vacancy_reason: null,
            },
          });
          await tx.regionalManagerAssignmentHistory.create({
            data: {
              hotel_group_id: data.hotel_group_id,
              regional_manager_user_id: userId,
              assigned_at: now,
              assigned_by_id: actorId,
            },
          });
        }
      }

      // ── worker/checker: EmploymentRecord.hotel_group_id (existing
      // eligibility semantics, unchanged) + primary_hotel_id (new,
      // display/default-selection only — never read by roster-scope.ts) ──
      if ((newRole === 'WORKER' || newRole === 'CHECKER') && (data.hotel_group_id !== undefined || data.primary_hotel_id !== undefined)) {
        const employmentRecord = await tx.employmentRecord.findUnique({ where: { user_id: userId }, select: { id: true } });
        if (!employmentRecord) {
          throw new ValidationError('This worker has no employment record yet. Please onboard them via Employee Management before assigning a hotel group.', [
            { field: 'hotel_group_id', message: 'Worker must have an employment record before a hotel group can be assigned' },
          ]);
        }
        await tx.employmentRecord.update({
          where: { id: employmentRecord.id },
          data: {
            ...(data.hotel_group_id !== undefined ? { hotel_group_id: data.hotel_group_id } : {}),
            ...(data.primary_hotel_id !== undefined ? { primary_hotel_id: data.primary_hotel_id } : {}),
          },
        });
      }

      // ── Invariant: one user holds at most ONE organizational posting ──
      //
      // Asserted on the END STATE rather than trusted from the branches
      // above. Those vacate/assign branches are conditional on the incoming
      // role, so each is individually correct but none of them proves the
      // combination is. This check does, and it runs inside the same
      // transaction -- a violation rolls the whole thing back rather than
      // committing a user who is simultaneously a Hotel Manager and a
      // Regional Manager.
      //
      // Deliberately a read-back, not a re-derivation from `data`: it catches
      // a stale row this call did not touch (pre-existing bad data, or a
      // direct database write) as well as a logic error introduced here
      // later. Hotel.manager_user_id has no unique constraint, so the
      // database cannot enforce this itself -- see auth/service.ts's
      // resolveScope(), which has to tolerate the multi-hotel case for the
      // same reason.
      const [managedHotels, managedGroup] = await Promise.all([
        tx.hotel.findMany({ where: { manager_user_id: userId }, select: { id: true } }),
        tx.hotelGroup.findFirst({
          where: { regional_manager_user_id: userId },
          select: { id: true },
        }),
      ]);

      if (managedHotels.length > 0 && managedGroup) {
        throw new ConflictError(
          'A user cannot hold both a Hotel Manager and a Regional Manager posting'
        );
      }
      if (managedHotels.length > 1) {
        throw new ConflictError('A user cannot manage more than one hotel');
      }
      // A posting must match the role that authorizes it: resolveScope()
      // mints a JWT scope claim straight from these columns, so a worker left
      // pointing at a hotel would carry manager scope.
      if (managedHotels.length > 0 && newRole !== 'MANAGER') {
        throw new ConflictError(
          `A ${newRole} cannot hold a Hotel Manager posting`
        );
      }
      if (managedGroup && newRole !== 'REGIONAL_MANAGER') {
        throw new ConflictError(
          `A ${newRole} cannot hold a Regional Manager posting`
        );
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
