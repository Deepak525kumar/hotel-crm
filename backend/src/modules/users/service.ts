import bcrypt from 'bcryptjs';
import { EmploymentStatus, OutboxTransport, NotificationType, OutboxSourceModule } from '@prisma/client';
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
import { resolveNonAdminScopeFilter, isWorkerInGroupScope, isManagerInGroupScope, isScopedManagerRole, isHotelInScope } from '../../lib/scope.js';
import { canCreateRole, createRoleDenialMessage } from '../../lib/role-hierarchy.js';
import type { UserScope } from '../../lib/jwt.js';
import type { AuthContext } from '../../lib/types.js';
// ADR-065 (Universal Onboarding Gate): createUser() below auto-creates the
// linked EmploymentRecord for every non-admin account. No existing import
// cycle risk -- employee-management/service.ts imports hr/service.ts, but
// neither imports users/service.ts.
import { employeeManagementService } from '../employee-management/service.js';
import { notificationService } from '../notifications/service.js';
import type { DatabaseTransaction } from '../../lib/db.js';
import { getEnv } from '../../config/env.js';
import { generateProfilePhotoKey, guessPhotoMimeType } from './photo.js';
import { getStorageClient } from '../documents/storage.js';

// The uploaded photo's bytes, as multer's memoryStorage hands them to the
// controller (req.file) -- mirrors documents/controller.ts's own inline
// shape for the same reason: no disk write, no separate DTO for a 3-field
// pass-through.
export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export class UserService extends BaseService {
  // ADR-030 PR-4 (D-7, C-14): GET /users was previously unscoped for
  // manager/regional_manager — any manager could list every user regardless
  // of hotel/group. `actor` is optional so existing internal callers (none
  // currently) keep compiling; the controller always passes it.
  async listUsers(query: ListUsersQuery, actor?: { role: string; userId?: string; scope?: UserScope | null }) {
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
      if (!where['AND']) where['AND'] = [];
      (where['AND'] as any[]).push({
        OR: [
          { employment_record: { hotel_group_id: targetGroupId } },
          { managed_hotels: { some: { hotel_group_id: targetGroupId } } },
          // 2026-08-24: a not-yet-approved applicant has hotel_group_id = null
          // until activation (ADR-065 Decision 2), so the first branch excluded
          // it and a Manager could not see the Worker/Checker they had just
          // created — the account appeared to vanish from the Users tab
          // immediately after a successful create.
          //
          // target_hotel_group_id is set at creation from the CREATING actor's
          // own scope, so it answers "whose applicant is this" for exactly the
          // window in which hotel_group_id cannot. Guarded on
          // `hotel_group_id: null` so this matches ONLY pre-approval records —
          // an activated worker is always matched by their real group above,
          // never by a stale target.
          {
            employment_record: {
              hotel_group_id: null,
              target_hotel_group_id: targetGroupId,
            },
          },
        ]
      });
    }

    // A Hotel Manager's group-grain filter above (needed because
    // EmploymentRecord scoping is group-, not hotel-grain) also matches
    // OTHER manager/regional_manager accounts in the same group -- their
    // peers and their own RM, neither of whom report to them. Only a
    // Regional Manager legitimately manages every hotel manager in their
    // group, so this exclusion applies to 'manager' only.
    if (actor && actor.role === 'manager') {
      if (!where['AND']) where['AND'] = [];
      (where['AND'] as any[]).push({
        OR: [
          { role: { notIn: ['MANAGER', 'REGIONAL_MANAGER'] } },
          ...(actor.userId ? [{ id: actor.userId }] : []),
        ],
      });
    }
    if (search) {
      if (!where['AND']) where['AND'] = [];
      (where['AND'] as any[]).push({
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ]
      });
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
          profile_photo_key: true,
          role: true,
          is_active: true,
          created_at: true,
          updated_at: true,
          // 2026-08-13: `is_active` is the ACCOUNT flag (can this person sign
          // in) and is true from the moment the account is created. It says
          // nothing about onboarding. Surfacing it alone made a brand-new,
          // un-onboarded user read as a green "Active" in the users list --
          // actively misleading to a reviewer, who means employment status by
          // "active". The employment status is returned alongside it so the
          // UI can show the one that actually answers that question.
          employment_record: { select: { status: true } },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
      // stored column (dropped).
      users: users.map(
        ({ employment_record, profile_photo_key, ...u }) => ({
          ...u,
          role: u.role.toLowerCase(),
          permissions: ROLE_PERMISSIONS[u.role] ?? [],
          // Flattened to a scalar rather than passed through as a nested
          // relation: consumers need "what is this person's employment
          // status", not a join shape they have to unwrap. Null means no
          // EmploymentRecord exists (an admin, or a pre-ADR-065 account) --
          // deliberately distinct from any status value, so the UI can tell
          // "not applicable" apart from "pending".
          employment_status: employment_record?.status ?? null,
          // Never the raw S3 key -- see auth/types.ts's AuthUser.has_profile_photo.
          has_profile_photo: profile_photo_key != null,
        })
      ),
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
        profile_photo_key: true,
        role: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        created_by_id: true,
        // See listUsers' note: `is_active` is the account flag and is true
        // from creation, so it cannot answer "has this person completed
        // onboarding". Returned alongside it, flattened below.
        employment_record: { select: { status: true } },
        managed_hotels: { select: { id: true } },
        managed_hotel_groups: { select: { id: true } },
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
      // 2026-08-13 fix (reported: RM creates a Manager, is redirected to
      // their profile, and gets "Failed to load this user. They may have
      // been removed."). The creator-exemption below this block was added
      // for exactly this redirect-after-create case, but it only ran AFTER
      // the role check two lines down — which throws immediately for any
      // role other than WORKER/CHECKER, before the exemption is ever
      // reached. A Regional Manager legitimately creates Manager accounts
      // too (RULE A, lib/role-hierarchy.ts), so that role check rejected the
      // RM's own creation before checking who created it.
      //
      // Checking self-creation FIRST, and unconditionally, closes this
      // without reopening an IDOR: canCreateRole() already gated which
      // target roles this actor was allowed to create (lib/role-hierarchy.ts,
      // enforced in createUser()), so "I created this account" is proof the
      // account's role was one this actor was authorized to onboard in the
      // first place — no separate role allowlist is needed for a
      // self-created target. A manager/RM viewing an account they did NOT
      // create still falls through to the original WORKER/CHECKER + group-
      // scope check below.
      if (user.created_by_id !== actorId) {
        if (user.role === 'MANAGER') {
          const inScope = await isManagerInGroupScope(actorScope, userId);
          if (!inScope) throw new ForbiddenError('User not in your scope');
        } else if (user.role === 'WORKER' || user.role === 'CHECKER') {
          const inScope = await isWorkerInGroupScope(actorScope, userId);
          if (!inScope) throw new ForbiddenError('User not in your scope');
        } else {
          throw new ForbiddenError('User not in your scope');
        }
      }
    }

    await this.logAudit(actorId, actorRole, 'VIEW', 'USER', userId, {}, ip);
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped). created_by_id is authorization-internal
    // (used only in the scope check above) and never sent to the client.
    const { employment_record, profile_photo_key, ...rest } = user;
    return {
      ...rest,
      role: user.role.toLowerCase(),
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
      // Null = no EmploymentRecord (admin, or a pre-ADR-065 account), which
      // is distinct from any status value — see listUsers' note.
      employment_status: employment_record?.status ?? null,
      // Never the raw S3 key -- see auth/types.ts's AuthUser.has_profile_photo.
      has_profile_photo: profile_photo_key != null,
      deleted_at: undefined,
      created_by_id: undefined,
    };
  }

  /**
   * Bytes for the stable GET /users/:id/photo route. Deliberately calls
   * getUser() first rather than duplicating its scope check: "can this actor
   * view the photo" is exactly "can this actor view the profile", so any
   * ForbiddenError/NotFoundError it throws applies unchanged here.
   */
  async getUserPhoto(userId: string, actorId: string, actorRole: string, actorScope: UserScope | null) {
    await this.getUser(userId, actorId, actorRole, actorScope);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { profile_photo_key: true } });
    if (!user?.profile_photo_key) throw new NotFoundError('Profile photo not found');
    const storage = await getStorageClient();
    const buffer = await storage.download(user.profile_photo_key);
    return { buffer, mimeType: guessPhotoMimeType(user.profile_photo_key) };
  }

  async createUser(data: CreateUserRequest, actor: AuthContext, ip: string | undefined, photo: UploadedPhoto) {
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

    // Mandatory profile photo: every account created through this path gets
    // a real photo, uploaded straight to S3 -- never a client-supplied URL
    // (see auth/service.ts#updateProfile for why that field was removed
    // instead of reused). Uploaded AFTER the User row exists, since the key
    // embeds user.id, and BEFORE the EmploymentRecord step below, using the
    // exact same delete-the-row-and-let-the-caller-retry compensating
    // pattern that step already established for its own failure mode.
    const photoKey = generateProfilePhotoKey(user.id, photo.originalname);
    try {
      const storage = await getStorageClient();
      await storage.upload(photoKey, photo.buffer, photo.mimetype);
      await this.prisma.user.update({ where: { id: user.id }, data: { profile_photo_key: photoKey } });
    } catch (error) {
      logger.error('user_create_photo_upload_failed', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await this.prisma.user.delete({ where: { id: user.id } });
      } catch (cleanupError) {
        logger.error('user_create_rollback_failed', {
          userId: user.id,
          email: user.email,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
      throw new ConflictError('Account could not be created: uploading the profile photo failed. Please try again.');
    }

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
    // NOT best-effort (2026-08-13 audit finding). This previously swallowed
    // the error on the reasoning that "the account is useful on its own" --
    // which is false for a non-admin: with no EmploymentRecord they cannot
    // upload documents, cannot submit onboarding, and cannot be approved.
    // They could log in and do nothing, while the manager who created them
    // saw a success response. That is a stranded account nobody knows is
    // broken.
    //
    // The failure now propagates, AND the orphaned User row is removed so the
    // caller can simply retry: leaving it behind would make the retry fail on
    // the unique-email check, turning a transient error into a permanently
    // unusable email address. Deleted rather than soft-deleted -- this
    // account never existed as far as the operator is concerned.
    if (role !== 'ADMIN') {
      try {
        await employeeManagementService.createEmployee(actor, {
          user_id: user.id,
          employee_id: `EMP-${user.id.slice(-10).toUpperCase()}`,
          job_title: data.job_title!,
          start_date: data.start_date!,
          employment_type: data.employment_type!,
          // Threaded through explicitly: omitting it here is what silently
          // disabled the work-permit requirement platform-wide.
          work_permit_required: data.work_permit_required ?? false,
          // Same failure mode, same fix: the intended assignment reaches
          // createEmployee as a TARGET, not as live scope (ADR-065 Decision 2
          // -- an application holds no operational scope until it is approved
          // and assigned). createEmployee still validates and may override
          // these against the creating actor's own scope; passing them only
          // supplies the case it cannot infer, an Admin creating a Regional
          // Manager, where the Admin has no group of their own to copy.
          ...(data.hotel_group_id ? { target_hotel_group_id: data.hotel_group_id } : {}),
          ...(data.hotel_id ? { target_primary_hotel_id: data.hotel_id } : {}),
        });
      } catch (error) {
        logger.error('user_create_employment_record_failed', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          await this.prisma.user.delete({ where: { id: user.id } });
        } catch (cleanupError) {
          // Compensation failed too -- now there IS an orphan. Log loudly with
          // both errors so it is recoverable by hand rather than invisible.
          logger.error('user_create_rollback_failed', {
            userId: user.id,
            email: user.email,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
        // The photo uploaded moments ago is now unreferenced -- best-effort
        // cleanup, logged rather than thrown: the User row is already gone,
        // so a failure here leaves an orphaned S3 object, not a broken
        // account.
        try {
          await (await getStorageClient()).delete(photoKey);
        } catch (photoCleanupError) {
          logger.error('user_create_rollback_photo_cleanup_failed', {
            userId: user.id,
            photoKey,
            error: photoCleanupError instanceof Error ? photoCleanupError.message : String(photoCleanupError),
          });
        }
        // 2026-08-13 fix (reported: "error message when a user is created
        // from a manager id"). This used to be a fixed, opaque sentence, so
        // the ACTUAL cause -- almost always an authorization/scope condition
        // the creator can fix, e.g. "Manager must have a scoped hotel_id to
        // create an application" for a manager who heads no hotel yet -- was
        // replaced by "please try again", which is exactly the wrong advice:
        // retrying an unscoped manager fails identically every time.
        //
        // Rethrow the underlying error when it is one of our own typed
        // errors (they carry deliberately user-facing messages and the right
        // status code); fall back to the generic sentence only for genuinely
        // unexpected failures, where the message may not be safe to surface.
        if (error instanceof ForbiddenError || error instanceof ConflictError || error instanceof ValidationError) {
          throw error;
        }
        throw new ConflictError(
          'Account could not be created: setting up the onboarding record failed. Please try again.',
        );
      }
    }

    // Welcome email: the caller (admin/manager/RM) chose this password in
    // the creation form above -- see this function's own CreateUserSchema
    // comment; there is no server-generated temp password or forced-change
    // flow (a deliberate, narrower choice than the industry-standard pattern,
    // made explicitly to avoid the larger surface a forced-first-login-change
    // screen would need across web + both mobile apps). Best-effort: a
    // notification failure must not undo an otherwise-successful account
    // creation, unlike the EmploymentRecord failure above, which does --
    // losing a welcome email is recoverable (resend, or the admin relays the
    // password directly); losing onboarding eligibility is not.
    //
    // Review finding (2026-08-22): the password must NEVER land in `message`
    // or `data`. GET /notifications and the notification-detail page (which
    // dumps every key of `data` as a labeled row -- see
    // frontend/app/(protected)/notifications/[id]/page.tsx) both return a
    // Notification row's full content to its owner, forever. Unlike a
    // password-reset token (single-use, TTL'd), this password does not
    // expire on its own, so either field would leave it durably queryable
    // via the recipient's own notification history for as long as the row
    // exists. `message` is the in-app-safe summary; `emailText` (below) is
    // written to the EMAIL OutboxEvent's own `payload` column instead --
    // never returned by any self-service endpoint -- and is what
    // EmailTransportHandler actually sends.
    try {
      // getEnv() belongs INSIDE this try, not above it: this whole block is
      // best-effort by design (see the comment above), and getEnv() throwing
      // -- e.g. a caller/test environment that never called loadEnv() -- must
      // be swallowed exactly like a failed enqueue() call, not propagate and
      // fail account creation. Caught by create-hierarchy-authz.test.ts
      // during review: that suite exercises createUser()'s ALLOW paths
      // without mocking config/env.js at all, which a getEnv() call sitting
      // above this try block would have broken.
      const loginUrl = `${getEnv().FRONTEND_URL || 'http://localhost:3000'}/login`;
      await notificationService.enqueue({
        recipientId: user.id,
        type: NotificationType.ACCOUNT_CREATED,
        title: 'Your account has been created',
        message: `An account has been created for you on ${data.email}. Check your email for your login password.`,
        emailText:
          `An account has been created for you on ${data.email}. ` +
          `Temporary password: ${data.password}

` +
          `Log in at ${loginUrl} and change this password soon.`,
        transports: [OutboxTransport.EMAIL],
        sourceModule: OutboxSourceModule.USERS,
        producerService: 'UserService',
      });
    } catch (error) {
      logger.error('user_create_welcome_email_enqueue_failed', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped). has_profile_photo is unconditionally true --
    // reaching this line means the upload above already succeeded.
    return {
      ...user,
      role: user.role.toLowerCase(),
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
      has_profile_photo: true,
    };
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

  /**
   * Changes the account's email. Admin and Regional Manager only (enforced at
   * the route); a Regional Manager may only reach users inside their own group.
   *
   * Email is the login identifier, which makes this three things at once and
   * all three matter:
   *
   *  - A uniqueness change. Checked explicitly so a collision is a 409 rather
   *    than a raw Prisma unique-constraint 500.
   *  - A credential change. Existing sessions are revoked (token generation
   *    bumped, the same mechanism deactivation uses) so the account cannot stay
   *    signed in on a device under an address its owner no longer controls.
   *  - A security event. Notified to the user, their hotel's manager and their
   *    group's regional manager, and emailed to BOTH the old and the new
   *    address -- the old one especially, since a hostile change is otherwise
   *    completely silent to the person losing the account.
   */
  async updateUserEmail(
    userId: string,
    data: { email: string },
    actorId: string,
    actorRole: string,
    actorScope: UserScope | null,
    ip?: string
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        deleted_at: true,
      },
    });
    // Matches updateUser: a soft-deleted account is not addressable. Without
    // this, a deleted user's address could be reassigned and the deleted
    // account notified.
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    // Same guard updateUser and updateUserRole both carry, and for a sharper
    // reason here: email is the password-reset channel, so changing an admin's
    // address and then requesting a reset to it is a complete account
    // takeover. Scope alone is not sufficient protection -- it only holds
    // while admins have no EmploymentRecord, which is a convention, not an
    // invariant this method can rely on.
    if (actorRole !== 'admin' && user.role === 'ADMIN') {
      throw new ForbiddenError('Only admins can modify admin accounts');
    }

    const nextEmail = data.email.trim().toLowerCase();
    const previousEmail = user.email;

    // A no-op must not revoke sessions or fire a security notification.
    if (nextEmail === previousEmail) {
      return { ...user, role: user.role.toLowerCase(), permissions: ROLE_PERMISSIONS[user.role] ?? [] };
    }

    if (isScopedManagerRole(actorRole)) {
      const inScope = await isWorkerInGroupScope(actorScope, userId);
      if (!inScope) {
        throw new ForbiddenError('You can only change the email of users in your own group');
      }
    }

    const clash = await this.prisma.user.findUnique({ where: { email: nextEmail } });
    if (clash && clash.id !== userId) {
      throw new ConflictError('That email address is already in use');
    }

    // Resolved before the transaction so the supervisor lookups do not sit
    // inside it: the enqueues below must be transactional, the reads need not
    // be.
    const supervisorIds = await this.resolveEmailChangeSupervisors(userId);

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
          where: { id: userId },
          data: { email: nextEmail },
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

        // Enqueued INSIDE the transaction, the convention every other
        // security-relevant producer here follows (auth's password reset,
        // consent, hr, quality). Outside it, a crash between commit and
        // enqueue would change the sign-in address and notify nobody -- the
        // exact silent takeover this fan-out exists to make visible.
        await this.enqueueEmailChangeNotifications(
          { id: user.id, first_name: user.first_name, last_name: user.last_name, role: user.role },
          previousEmail,
          nextEmail,
          supervisorIds,
          tx
        );

        return result;
      });
    } catch (error) {
      // The uniqueness probe above is check-then-write: two concurrent changes
      // to the same address both pass it and the second loses on the unique
      // constraint. Without this the caller gets a raw 500 for what is a
      // perfectly ordinary conflict.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictError('That email address is already in use');
      }
      throw error;
    }

    await this.logAudit(
      actorId,
      actorRole,
      'MODIFY',
      'USER',
      userId,
      { action: 'email_changed', token_generation_bumped: true },
      ip,
      // The addresses are the whole point of the record, but they are PII:
      // they go in the audit trail's old/new values, not in `details`, which
      // is the field surfaced most widely.
      { email: previousEmail },
      { email: nextEmail }
    );

    return { ...updated, role: updated.role.toLowerCase(), permissions: ROLE_PERMISSIONS[updated.role] ?? [] };
  }

  /**
   * Everyone with a legitimate interest in a colleague's sign-in address
   * changing: the manager of their primary hotel and the regional manager of
   * their group.
   *
   * A Set, because one person can hold both postings and must not be told
   * twice.
   */
  private async resolveEmailChangeSupervisors(userId: string): Promise<string[]> {
    const record = await this.prisma.employmentRecord.findUnique({
      where: { user_id: userId },
      select: { hotel_group_id: true, primary_hotel_id: true },
    });

    const ids = new Set<string>();
    if (record?.primary_hotel_id) {
      const hotel = await this.prisma.hotel.findUnique({
        where: { id: record.primary_hotel_id },
        select: { manager_user_id: true },
      });
      if (hotel?.manager_user_id) ids.add(hotel.manager_user_id);
    }
    if (record?.hotel_group_id) {
      const group = await this.prisma.hotelGroup.findUnique({
        where: { id: record.hotel_group_id },
        select: { regional_manager_user_id: true },
      });
      if (group?.regional_manager_user_id) ids.add(group.regional_manager_user_id);
    }
    // A manager who is also the subject already gets the two messages below.
    ids.delete(userId);
    return [...ids];
  }

  /** Enqueued within the caller's transaction -- see the call site. */
  private async enqueueEmailChangeNotifications(
    user: { id: string; first_name: string; last_name: string; role: string },
    previousEmail: string,
    nextEmail: string,
    supervisorIds: string[],
    tx: DatabaseTransaction
  ): Promise<void> {
    const name = `${user.first_name} ${user.last_name}`.trim();
    const title = 'Account email changed';
    
    const isMobileUser = user.role === 'WORKER' || user.role === 'CHECKER';
    const newEmailTransports = isMobileUser ? [OutboxTransport.EMAIL, OutboxTransport.PUSH] : [OutboxTransport.EMAIL];

    // The user, in-app and by email at the NEW address (the default
    // resolution, since the record now holds it).
    await notificationService.enqueue(
      {
        recipientId: user.id,
        type: NotificationType.USER_EMAIL_CHANGED,
        title,
        message: `Your sign-in email was changed to ${nextEmail}. You have been signed out on all devices and will need to sign in again.`,
        data: { previous_email: previousEmail, new_email: nextEmail },
        transports: newEmailTransports,
        sourceModule: OutboxSourceModule.USERS,
        producerService: 'UserService',
      },
      tx
    );

    // ...and again, pinned to the OLD address. Without emailTo this second
    // message would resolve `to` at send time and land at the new address as
    // well -- telling whoever now holds the account what they already know,
    // and telling the previous owner nothing. This is the one message that
    // makes a hostile change visible to the person losing access.
    await notificationService.enqueue(
      {
        recipientId: user.id,
        type: NotificationType.USER_EMAIL_CHANGED,
        title,
        message: `The sign-in email for this account was changed to ${nextEmail}. If you did not expect this, contact an administrator immediately.`,
        transports: newEmailTransports,
        emailTo: previousEmail,
        sourceModule: OutboxSourceModule.USERS,
        producerService: 'UserService',
      },
      tx
    );

    for (const recipientId of supervisorIds) {
      await notificationService.enqueue(
        {
          recipientId,
          type: NotificationType.USER_EMAIL_CHANGED,
          title,
          message: `The email address for ${name} was changed from ${previousEmail} to ${nextEmail}.`,
          data: { user_id: user.id },
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.USERS,
          producerService: 'UserService',
        },
        tx
      );
    }
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
  async updateUserRole(userId: string, data: UpdateUserRoleRequest, actorId: string, actorRole: string, actorScope: UserScope | null, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    if (actorRole !== 'admin' && user.role === 'ADMIN') {
      throw new ForbiddenError('Only admins can modify admin accounts');
    }
    
    // Role Hierarchy & Privilege Escalation Checks
    if (actorRole === 'regional_manager') {
      if (user.role === 'REGIONAL_MANAGER') {
        throw new ForbiddenError('Regional managers cannot modify other regional manager accounts');
      }
      const newRole = data.role.toUpperCase();
      if (newRole === 'ADMIN' || newRole === 'REGIONAL_MANAGER') {
        throw new ForbiddenError('Regional managers cannot assign the admin or regional_manager roles');
      }
    } else if (actorRole !== 'admin') {
      throw new ForbiddenError('Only admins and regional managers can assign roles');
    }

    const newRole = data.role.toUpperCase() as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN' | 'REGIONAL_MANAGER';

    // ADR-065 Decision 2: no operational scope before the application is
    // approved. The assignment half of this endpoint writes
    // Hotel.manager_user_id / HotelGroup.regional_manager_user_id directly --
    // live scope, not a target -- and consulted the employment record nowhere,
    // so a PENDING (or REJECTED, or DEACTIVATED) account could be made the
    // acting manager of a hotel or group with a single call, straight past the
    // onboarding gate. Verified reproducible before this guard: status PENDING,
    // 200, HotelGroup.regional_manager_user_id set, status still PENDING.
    //
    // Scoped to the assignment, not the whole call: changing someone's ROLE
    // while their application is in flight is legitimate (an admin correcting
    // worker -> checker before approval). It is only handing them a live
    // posting that has to wait. An account with no employment record at all
    // (admin, or a pre-ADR-065 account) is unaffected.
    if (data.hotel_id || data.hotel_group_id) {
      const record = await this.prisma.employmentRecord.findUnique({
        where: { user_id: userId },
        select: { status: true },
      });
      // Blocks only on a status we positively know is not ACTIVE. A real row
      // always carries one (it is selected above and non-null in the schema),
      // so this is not a weakening in production -- it just declines to infer
      // "not approved" from an absent field.
      if (record?.status && record.status !== EmploymentStatus.ACTIVE) {
        throw new ConflictError(
          `Cannot assign a hotel or group to an account whose application is ${record.status}; approve it first`
        );
      }
    }

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

    if (actorRole === 'regional_manager') {
      let targetInScope = false;
      if (user.role === 'MANAGER') {
        targetInScope = await isManagerInGroupScope(actorScope, userId);
      } else if (user.role === 'WORKER' || user.role === 'CHECKER') {
        targetInScope = await isWorkerInGroupScope(actorScope, userId);
      }
      // Exempt the creator (redirect-after-create flow) so they can assign
      // a hotel to a MANAGER they just created (who inherently has no hotel yet).
      if (!targetInScope && user.created_by_id !== actorId) {
        throw new ForbiddenError('User is not in your scope');
      }

      if (data.hotel_id) {
        const hotelInScope = await isHotelInScope(actorScope, data.hotel_id);
        if (!hotelInScope) {
          throw new ForbiddenError('Cannot assign a hotel outside your scope');
        }
      }
      if (data.primary_hotel_id) {
        const hotelInScope = await isHotelInScope(actorScope, data.primary_hotel_id);
        if (!hotelInScope) {
          throw new ForbiddenError('Cannot assign a primary hotel outside your scope');
        }
      }
      if (data.hotel_group_id) {
        if (actorScope?.type !== 'hotel_group' || actorScope.hotel_group_id !== data.hotel_group_id) {
          throw new ForbiddenError('Cannot assign a group outside your scope');
        }
      }
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

      // PROMOTION/DEMOTION SCOPE DESYNC fix (2026-08-13 audit). A role change
      // that does NOT carry an explicit hotel_group_id left the
      // EmploymentRecord's old scope untouched. Demote a Manager back to
      // WORKER and they silently regained roster access to whatever group
      // they held before the promotion -- bypassing assign() entirely, and
      // potentially a group they no longer work for.
      //
      // Clearing rather than guessing: after a role change with no explicit
      // posting, the correct scope is genuinely unknown, and "no access
      // pending assignment" is the safe reading of unknown. assign() is the
      // deliberate step that grants it back.
      if (
        (newRole === 'WORKER' || newRole === 'CHECKER') &&
        data.hotel_group_id === undefined &&
        data.primary_hotel_id === undefined &&
        user.role !== newRole
      ) {
        const existing = await tx.employmentRecord.findUnique({
          where: { user_id: userId },
          select: { id: true },
        });
        if (existing) {
          await tx.employmentRecord.update({
            where: { id: existing.id },
            data: { hotel_group_id: null, primary_hotel_id: null },
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

    // GHOST EMPLOYEE fix (2026-08-13 audit). This endpoint soft-deleted the
    // User and stopped there: the EmploymentRecord stayed un-deleted, any
    // hotel/group the person headed stayed pointing at them, and their
    // contract stayed valid. The hotel then refused every replacement manager
    // ("Hotel already has a different manager assigned") because the slot was
    // still occupied by a deleted user.
    //
    // employee-management's own delete() already does all of that correctly,
    // so this delegates to it rather than growing a second, divergent copy of
    // the teardown -- the divergence between these two paths IS the bug.
    // Only when an EmploymentRecord exists, which is the case that can ghost;
    // an admin (no record) still takes the plain account soft-delete below.
    const employmentRecord = await this.prisma.employmentRecord.findUnique({
      where: { user_id: userId },
      select: { employee_id: true, deleted_at: true },
    });

    if (employmentRecord && !employmentRecord.deleted_at) {
      await employeeManagementService.delete(
        { userId: actorId, email: '', role: actorRole, permissions: [] },
        employmentRecord.employee_id,
        'Account deleted by administrator',
      );
      // delete() soft-deletes the User and bumps token_generation itself, so
      // returning here avoids doing either twice.
      await this.logAudit(actorId, actorRole, 'DELETE', 'USER', userId, { email: user.email }, ip);
      return;
    }

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
