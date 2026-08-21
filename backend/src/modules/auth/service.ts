import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Prisma, PrismaClient, UserRole, OutboxTransport, NotificationType, OutboxSourceModule } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { signTokens, verifyRefreshToken, UserScope } from '../../lib/jwt.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  TooManyRequestsError,
} from '../../lib/errors.js';
import { ROLE_PERMISSIONS, BCRYPT_ROUNDS, PASSWORD_RESET_TOKEN_TTL_MINUTES } from '../../config/constants.js';
import { getEnv } from '../../config/env.js';
import { SignupRequest, LoginRequest, UpdateProfileRequest, PasswordResetRequestInput, PasswordResetConfirmInput } from './validation.js';
import { AuthResponse, AuditLogQuery, AuditLogEntryDto } from './types.js';
import { notificationService } from '../notifications/service.js';
import { logger } from '../../lib/logger.js';

// ADR-031 D-4 (PR-4): the sole seam through which `User.token_generation` may
// be incremented. `backend-auth` is the authoritative writer (ADR-017,
// state-user); other modules (e.g. backend-users) call this from inside
// their own transaction rather than incrementing the column directly, so
// there is never a second, uncoordinated writer of this revocation state.
// Takes a transaction client so the caller can commit the bump atomically
// with the state change that motivates it (C-5) — a bump committed
// separately from its trigger could be lost, leaving a valid pre-demotion
// token live.
export async function bumpTokenGeneration(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { token_generation: { increment: 1 } },
  });
}

export class AuthService extends BaseService {
  // SECURITY (OQ-AUTH-15): only a SHA-256 digest of the refresh token is ever
  // persisted (same pattern as PasswordResetToken.token_hash below) — a
  // database read (backup, replica, injection) no longer yields a token an
  // attacker can replay against POST /auth/refresh or /auth/logout.
  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * SPEC-AUTH-001 TREQ-AUTH-007 (2026-08-08): records one failed login
   * against a KNOWN account and escalates by notification once the
   * consecutive-failure threshold is crossed.
   *
   * The notify path never blocks (TRULE-AUTH-002: "notify and never block")
   * -- crossing AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD only decides when to
   * raise the alert, exactly as before. ADR-070 (2026-08-21) adds a SECOND,
   * higher threshold (AUTH_LOGIN_THROTTLE_THRESHOLD, default 10, always
   * above the notify threshold so the alert fires first): crossing it DOES
   * set login_locked_until, which login() reads to reject further attempts
   * for a bounded window. See ADR-070 §3 for why this is throttling, not
   * the lockout TREQ-AUTH-007 rules out -- it is time-bounded and
   * self-clearing, never a manual/admin action.
   *
   * Fires EXACTLY at the threshold (`=== threshold`, not `>=`), so a
   * sustained attack produces one notification per streak rather than one
   * per attempt after the fifth -- the alert is the signal, and repeating it
   * every attempt would bury it. A successful login resets the streak, so a
   * later attack can alert again.
   *
   * Best-effort on the notification: the audit write and the counter are the
   * durable record, so a notification failure is logged and swallowed rather
   * than converted into a login-endpoint 500 (the same posture
   * calendar/service.ts's own manager-notify already uses).
   */
  private async recordFailedLogin(
    user: { id: string; role: UserRole; email: string; failed_login_count: number; failed_login_since: Date | null },
    reason: string,
    ip?: string
  ): Promise<void> {
    const streakStartedAt = user.failed_login_since ?? new Date();

    // Consecutive-failure streaks persist until a successful login resets them;
    // there is intentionally no time-based expiry window here. 3 failures today
    // and 2 more three months later still sum to a threshold-crossing streak of
    // 5 -- this is deliberate (TRULE-AUTH-002's "notify and never block" makes
    // the notification the only cost of a stale streak, and a slow,
    // low-and-slow credential-guessing attempt spread over months is exactly
    // the pattern a rolling window would hide). A future SPEC-AUTH-001
    // amendment could add one; until then, do not assume a rolling window
    // exists when reasoning about this counter.
    //
    // `increment` rather than a read-computed `failed_login_count: nextCount`:
    // two concurrent failed attempts (a real scenario -- it's the exact
    // shape a credential-guessing script produces) would otherwise both read
    // the same starting count and one increment would be lost, which both
    // undercounts the streak and can suppress the threshold-crossing
    // notification entirely. `increment` is a single atomic UPDATE ... SET
    // x = x + 1, so no attempt is dropped under concurrency.
    // `failed_login_since` keeps the read-then-write (best-effort) shape --
    // it only feeds the notification's "since <time>" text, so a race
    // occasionally overwriting it with a slightly later timestamp is
    // cosmetic, not a correctness or security concern.
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failed_login_count: { increment: 1 }, failed_login_since: streakStartedAt },
      select: { failed_login_count: true },
    });
    const nextCount = updated.failed_login_count;

    await this.logAudit(user.id, user.role, 'LOGIN_FAILED', 'USER', user.id, {
      email: user.email,
      reason,
      consecutive_failures: nextCount,
    }, ip);

    // ADR-070: fires once per streak (`=== throttleThreshold`, mirroring the
    // notify check below), not on every attempt past it -- continuing to
    // hammer an already-throttled account does not keep pushing the window
    // out; only a fresh streak (after a successful login resets the count)
    // can re-trigger it. A separate update, not folded into the `increment`
    // write above, for the same reason the notify path below is separate:
    // this only needs to run once, on the single attempt that crosses the
    // threshold, not be part of every attempt's atomic increment.
    const throttleThreshold = getEnv().AUTH_LOGIN_THROTTLE_THRESHOLD;
    if (nextCount === throttleThreshold) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { login_locked_until: new Date(Date.now() + getEnv().AUTH_LOGIN_THROTTLE_DURATION_MS) },
      });
    }

    const threshold = getEnv().AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD;
    if (nextCount !== threshold) return;

    try {
      await this.notifyRepeatedFailedLogins(user, nextCount, streakStartedAt);
    } catch (error) {
      logger.error('auth_failed_login_notify_failed', { userId: user.id, error });
    }
  }

  /**
   * Resolves who hears about a repeated-failure streak.
   *
   * The worker's responsible manager is their Hotel Group's Regional Manager
   * -- the same EmploymentRecord -> HotelGroup -> regional_manager_user_id
   * chain calendar/service.ts and hr/service.ts already established.
   *
   * Unlike those, this falls back to ADMINS when no RM resolves. Their
   * best-effort/no-fallback posture suits a routine operational alert about
   * a worker; a credential-guessing attempt is a security signal, and the
   * accounts most worth attacking (admins, managers) are exactly the ones
   * with no EmploymentRecord and therefore no RM. Silently dropping the
   * alert for precisely those accounts would defeat the requirement.
   */
  private async notifyRepeatedFailedLogins(
    user: { id: string; email: string },
    attempts: number,
    since: Date
  ): Promise<void> {
    const record = await this.prisma.employmentRecord.findUnique({
      where: { user_id: user.id },
      select: { hotel_group_id: true },
    });

    let recipientIds: string[] = [];
    if (record?.hotel_group_id) {
      const group = await this.prisma.hotelGroup.findUnique({
        where: { id: record.hotel_group_id },
        select: { regional_manager_user_id: true },
      });
      if (group?.regional_manager_user_id) recipientIds = [group.regional_manager_user_id];
    }

    if (recipientIds.length === 0) {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, is_active: true, deleted_at: null },
        select: { id: true },
      });
      recipientIds = admins.map((a) => a.id);
    }

    // Never notify the account holder themself: if the attempts are an
    // attacker, the alert should not go to a mailbox the attacker is trying
    // to reach; if they are the legitimate user fumbling their password,
    // they already know.
    recipientIds = recipientIds.filter((id) => id !== user.id);
    if (recipientIds.length === 0) return;

    for (const recipientId of recipientIds) {
      await notificationService.enqueue({
        recipientId,
        type: NotificationType.REPEATED_FAILED_LOGINS,
        title: 'Repeated failed logins',
        message: `${attempts} consecutive failed login attempts for ${user.email} since ${since.toISOString()}.`,
        // Deliberately no password/credential material, and no IP: this
        // payload reaches a push transport.
        data: { user_id: user.id, attempts, since: since.toISOString() },
        transports: [OutboxTransport.PUSH],
        sourceModule: OutboxSourceModule.AUTH,
        producerService: 'AuthService',
      });
    }
  }

  // Flattens the UserScope union into the two nullable id fields the user
  // payload carries (AuthUser.scope_hotel_id/scope_hotel_group_id). A
  // 'global' (admin) scope intentionally yields both null -- an admin is not
  // bound to any one hotel or group, which is exactly what "no id" means
  // here; the frontend distinguishes admin by role, not by these fields.
  private static flattenScope(scope: UserScope | null): {
    scope_hotel_id: string | null;
    scope_hotel_group_id: string | null;
  } {
    if (scope?.type === 'hotel') {
      return { scope_hotel_id: scope.hotel_id, scope_hotel_group_id: null };
    }
    if (scope?.type === 'hotel_group') {
      return { scope_hotel_id: null, scope_hotel_group_id: scope.hotel_group_id };
    }
    return { scope_hotel_id: null, scope_hotel_group_id: null };
  }

  // PR 5.4 (ADR-023 §6 / ADR-025 §4): resolves the JWT scope claim from
  // read-only manager-association lookups. backend-auth never writes
  // Hotel/HotelGroup rows or manager assignments — this method only reads
  // them. Precedence: admin (global, no DB read) > regional manager
  // (hotel_group, broader scope wins) > hotel manager (hotel) > null.
  private async resolveScope(userId: string, role: string): Promise<UserScope | null> {
    if (role.toLowerCase() === 'admin') {
      return { type: 'global' };
    }

    // findUnique, not findFirst: HotelGroup.regional_manager_user_id is a
    // unique FK (Regional Manager V1 Decision 1 — one group per RM), so at
    // most one row can ever match. Before this constraint existed, findFirst
    // silently picked one of an RM's groups arbitrarily if they held several.
    const group = await this.prisma.hotelGroup.findUnique({
      where: { regional_manager_user_id: userId },
      select: { id: true },
    });
    if (group) {
      return { type: 'hotel_group', hotel_group_id: group.id };
    }

    // Deterministic ordering (2026-08-07). Unlike
    // HotelGroup.regional_manager_user_id above, Hotel.manager_user_id has NO
    // unique constraint (schema.prisma) -- nothing at the database level stops
    // one user from being manager of several hotels. This findFirst carried
    // no orderBy, so a manager in that state got an ARBITRARY hotel as their
    // JWT scope, and the row Postgres happened to return could differ between
    // logins: the same person could silently gain and lose access to a hotel
    // just by re-authenticating.
    //
    // That is the identical defect already fixed one branch up for Regional
    // Managers (see the findUnique comment above, which records findFirst
    // "silently picked one of an RM's groups arbitrarily"). The RM case was
    // closed by a unique FK; this one cannot be, because multi-hotel
    // management may become a real requirement.
    //
    // Ordering by id makes the choice stable and repeatable rather than
    // dependent on physical row order. It does NOT make picking one of
    // several correct -- it makes the current behaviour deterministic and
    // auditable while the product question stays open. The service layer
    // enforces one hotel per manager on the write path
    // (users/service.ts#updateUserRole), but pre-existing rows and any direct
    // database write can still violate it, so this read must stay total.
    const hotels = await this.prisma.hotel.findMany({
      where: { manager_user_id: userId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (hotels.length > 0) {
      if (hotels.length > 1) {
        logger.warn(
          'auth_scope_multi_hotel_manager: manager is assigned to multiple hotels; ' +
            'JWT scope covers only the lowest-id hotel. Hotel.manager_user_id has no ' +
            'unique constraint, so this state is reachable despite the service-layer ' +
            'one-hotel rule.',
          {
            user_id: userId,
            hotel_ids: hotels.map((h) => h.id),
            scope_hotel_id: hotels[0]!.id,
          }
        );
      }
      return { type: 'hotel', hotel_id: hotels[0]!.id };
    }

    return null;
  }

  async signup(data: SignupRequest, ip?: string): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    // SECURITY (HOTFIX-AUTH-001): public self-signup is always a non-privileged
    // WORKER. The server determines the role; client input is never trusted for
    // privilege assignment. Elevation happens only through the authenticated
    // users module under RBAC.
    const role = 'WORKER' as const;

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password_hash,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        role,
      },
    });

    const scope = await this.resolveScope(user.id, user.role);
    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      scope,
      // ADR-031 D-2/D-4: mirrored from the row; verified on every request
      // (middleware/auth.ts, unconditional as of PR-7).
      token_generation: user.token_generation,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: this.hashRefreshToken(tokens.refresh_token),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.logAudit(user.id, user.role, 'SIGNUP', 'USER', user.id, { email: user.email }, ip);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone ?? undefined,
        profile_photo_url: user.profile_photo_url ?? undefined,
        role: user.role.toLowerCase(),
        // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
        // stored column (dropped).
        permissions: ROLE_PERMISSIONS[user.role] ?? [],
        is_active: user.is_active,
        // Same field as login()/getCurrentUser() -- always null here, not a
        // stub: this row was just created in the transaction above, so no
        // EmploymentRecord can exist for it yet (that only comes from the
        // authorized-creator path, users/service.ts#createUser, not this
        // public self-signup one).
        employment_status: null,
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at?.toISOString(),
        // Reuses the SAME `scope` already resolved above for the JWT -- no
        // second DB lookup, and no chance of the payload and the token
        // disagreeing about which hotel/group this user is bound to.
        ...AuthService.flattenScope(scope),
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  async login(data: LoginRequest, ip?: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user || user.deleted_at) {
      // No counter to increment and no manager to notify: there is no
      // account. Audited with a null actor_id so the attempt is still
      // visible to a security review (an unknown-email spray is exactly the
      // pattern worth seeing), while the RESPONSE stays byte-identical to
      // the wrong-password branch below -- TREQ-AUTH-007 monitoring must not
      // become an account-existence oracle.
      await this.logAudit(null, null, 'LOGIN_FAILED', 'USER', 'unknown', {
        email: data.email,
        reason: 'user_not_found',
      }, ip);
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!user.is_active) {
      // Deliberately still a 403 with a distinct message: REQ-AUTH-003
      // specifies this branch explicitly and its own tests assert it, so
      // collapsing it into the generic 401 would be an unrequested change
      // to a specified contract. Recorded as a failed attempt so a disabled
      // account being hammered is still visible.
      await this.recordFailedLogin(user, 'account_disabled', ip);
      throw new ForbiddenError('Account is disabled');
    }

    // ADR-070: checked before the password comparison, not after, so a
    // throttled account doesn't pay the bcrypt cost (or leak comparative
    // timing) on every attempt during the window. Does not call
    // recordFailedLogin -- the streak that caused the throttle already
    // recorded its own audit entries; re-recording every rejected attempt
    // during the window would inflate the count past what actually happened
    // and could itself become a cheap way to keep re-arming the window.
    //
    // KNOWN, DISCLOSED tradeoff (ADR-070 §5): this 429 is distinguishable
    // from the generic 401 above, which narrowly reopens the account-
    // existence oracle that 401's own byte-identical-response comment
    // exists to prevent -- but only after ~10 attempts against one email,
    // bounded by the Nginx edge to ~1/sec, making enumeration impractical.
    // Accepted, not silently dropped; see the ADR before changing this.
    if (user.login_locked_until && user.login_locked_until > new Date()) {
      // `Math.max(1, ...)`: the entry check above and this computation read
      // the clock twice, microseconds apart — in the narrow window where
      // login_locked_until sits between those two reads, a naive
      // subtraction can go to zero or negative, which is not a valid
      // Retry-After delay-seconds value (RFC 7231 §7.1.3) and would show a
      // client "-1s" instead of "try again shortly".
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((user.login_locked_until.getTime() - Date.now()) / 1000)
      );
      await this.logAudit(user.id, user.role, 'LOGIN_THROTTLED', 'USER', user.id, {
        email: user.email,
        retry_after_seconds: retryAfterSeconds,
      }, ip);
      throw new TooManyRequestsError(
        'Too many failed login attempts. Please try again later.',
        retryAfterSeconds
      );
    }

    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      await this.recordFailedLogin(user, 'invalid_password', ip);
      throw new UnauthorizedError('Invalid credentials');
    }

    const scope = await this.resolveScope(user.id, user.role);
    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      scope,
      // ADR-031 D-2/D-4: mirrored from the row; verified on every request
      // (middleware/auth.ts, unconditional as of PR-7).
      token_generation: user.token_generation,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: this.hashRefreshToken(tokens.refresh_token),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // TREQ-AUTH-007: a successful login ends the streak. Conditional so the
    // common case (counter already 0) issues no write at all. Also clears
    // login_locked_until (ADR-070) -- reachable here only in the narrow
    // window between the throttle expiring and a fresh failed attempt
    // re-arming it, since the guard above already rejects while it's live,
    // but cleared defensively so no stale future timestamp can ever survive
    // a successful login.
    if (user.failed_login_count > 0 || user.login_locked_until) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failed_login_count: 0, failed_login_since: null, login_locked_until: null },
      });
    }

    await this.logAudit(user.id, user.role, 'LOGIN', 'USER', user.id, { email: user.email }, ip);

    // 2026-08-13 fix: same missing field as getCurrentUser (see that
    // method's own note) -- without this, the store this response seeds
    // shows a green "Active" badge on My Profile for the moment between
    // login completing and useMe()'s first /auth/me revalidation, for
    // anyone still mid-onboarding.
    const employmentRecord = await this.prisma.employmentRecord.findUnique({
      where: { user_id: user.id },
      select: { status: true },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone ?? undefined,
        profile_photo_url: user.profile_photo_url ?? undefined,
        role: user.role.toLowerCase(),
        // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
        // stored column (dropped).
        permissions: ROLE_PERMISSIONS[user.role] ?? [],
        is_active: user.is_active,
        employment_status: employmentRecord?.status ?? null,
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at?.toISOString(),
        // Reuses the SAME `scope` already resolved above for the JWT -- no
        // second DB lookup, and no chance of the payload and the token
        // disagreeing about which hotel/group this user is bound to.
        ...AuthService.flattenScope(scope),
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  // Security #4 (2026-08-09): takes the raw token as a plain string rather
  // than `RefreshTokenRequest` -- the controller resolves cookie-vs-body
  // before calling this, so the service stays agnostic to where the token
  // came from (same principle as every other service method never seeing
  // request-transport details).
  async refreshToken(rawRefreshToken: string): Promise<Pick<AuthResponse, 'access_token' | 'refresh_token' | 'expires_in'>> {
    const payload = verifyRefreshToken(rawRefreshToken);
    if (!payload) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const session = await this.prisma.session.findFirst({
      where: { refresh_token: this.hashRefreshToken(rawRefreshToken), user_id: payload.sub },
    });
    if (!session || session.expires_at < new Date()) {
      throw new UnauthorizedError('Session expired or not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.is_active || user.deleted_at) {
      throw new UnauthorizedError('User not found or inactive');
    }

    const scope = await this.resolveScope(user.id, user.role);
    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      scope,
      // ADR-031 D-2/D-4: mirrored from the row; verified on every request
      // (middleware/auth.ts, unconditional as of PR-7).
      token_generation: user.token_generation,
    });

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refresh_token: this.hashRefreshToken(tokens.refresh_token),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.deleteMany({
        where: { user_id: userId, refresh_token: this.hashRefreshToken(refreshToken) },
      });
    } else {
      await this.prisma.session.deleteMany({ where: { user_id: userId } });
    }
    await this.logAudit(userId, null, 'LOGOUT', 'USER', userId);
  }

  async getCurrentUser(userId: string) {
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
        // 2026-08-16: read by SessionBootstrap on both clients to pick the
        // initial UI language before first paint. Null here is not "no data"
        // — it means the user has never chosen, and the client should
        // negotiate from device/browser locale instead.
        preferred_language: true,
        created_at: true,
        updated_at: true,
        // 2026-08-13 fix (reported live: My Profile showed a green "Active"
        // badge for a Manager still mid-onboarding, PENDING/Under Review).
        // This endpoint is /auth/me -- what every "My Profile" page and
        // SessionBootstrap read the signed-in user from -- and it never
        // selected the EmploymentRecord at all, so the frontend had no
        // employment_status to prefer and fell back to `is_active`, which is
        // true from the moment the account exists and says nothing about
        // onboarding. Same fix already applied to users/service.ts's
        // listUsers/getUser (see that file's identical note); this endpoint
        // was the one place it was missed, and the one every user's own
        // Profile page depends on.
        employment_record: { 
          select: { 
            status: true,
            primary_hotel: { select: { manager: { select: { first_name: true, last_name: true } } } },
            hotel_group: { select: { regional_manager: { select: { first_name: true, last_name: true } } } },
          } 
        },
        created_by: { select: { first_name: true, last_name: true } },
      },
    });
    if (!user) throw new NotFoundError('User not found');
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    //
    // resolveScope() is re-run here rather than read off the caller's JWT:
    // this endpoint is what SessionBootstrap calls on every page load, and a
    // manager whose hotel assignment changed since their token was issued
    // must see the CURRENT assignment in the UI, not the stale one baked
    // into a token issued up to an access-token lifetime ago.
    const scope = await this.resolveScope(user.id, user.role);
    const { employment_record, created_by, ...rest } = user;
    
    let managerName: string | null = null;
    if (employment_record?.primary_hotel?.manager) {
      managerName = `${employment_record.primary_hotel.manager.first_name} ${employment_record.primary_hotel.manager.last_name}`.trim();
    } else if (employment_record?.hotel_group?.regional_manager) {
      managerName = `${employment_record.hotel_group.regional_manager.first_name} ${employment_record.hotel_group.regional_manager.last_name}`.trim();
    }
    
    const creatorName = created_by ? `${created_by.first_name} ${created_by.last_name}`.trim() : null;

    return {
      ...rest,
      role: user.role.toLowerCase(),
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
      employment_status: employment_record?.status ?? null,
      creator_name: creatorName,
      manager_name: managerName,
      ...AuthService.flattenScope(scope),
    };
  }

  // HOTFIX-AUTH-002 (SIR-AUTH-001): step 1 of 2. Never accepts a new password —
  // only issues a single-use, expiring, unguessable token to the account
  // holder. The server, not the caller, is the sole authority over whether a
  // reset may proceed.
  async requestPasswordReset(data: PasswordResetRequestInput, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user || user.deleted_at || !user.is_active) {
      // Return silently — do not reveal whether the email exists.
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Delivering `rawToken` to the account holder's inbox requires backend-auth
    // to become an OutboxEvent producer (notificationService.enqueue()) — the
    // EMAIL transport itself is live (Epic 7, ADR-029).
    const resetUrl = `${getEnv().FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;

    await this.prisma.$transaction(async (tx) => {
      // Invalidate any still-outstanding tokens from earlier requests so at
      // most one reset token is ever valid for an account at a time (security
      // review FIND-02: shrinks standing attack surface from stale tokens).
      await tx.passwordResetToken.deleteMany({
        where: { user_id: user.id, used_at: null },
      });

      await tx.passwordResetToken.create({
        data: {
          user_id: user.id,
          token_hash,
          expires_at: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000),
        },
      });

      const normalizedRole = user.role ? (user.role.toUpperCase() as UserRole) : null;
      await tx.auditLog.create({
        data: {
          actor_id: user.id,
          actor_role: normalizedRole,
          action: 'MODIFY',
          resource_type: 'USER',
          resource_id: user.id,
          details: { action: 'password_reset_requested' } as Prisma.InputJsonValue,
          ip_address: ip || null,
          timestamp: new Date(),
        },
      });

      await notificationService.enqueue({
        recipientId: user.id,
        type: NotificationType.SYSTEM,
        title: 'Password Reset Request',
        message: `You have requested to reset your password. Click this link to reset it: ${resetUrl}\n\nIf you did not request this, please ignore this email.`,
        transports: [OutboxTransport.EMAIL],
        sourceModule: OutboxSourceModule.AUTH,
        producerService: 'AuthService',
      }, tx);
    });
  }

  // HOTFIX-AUTH-002 (SIR-AUTH-001): step 2 of 2. Requires the raw token issued
  // by requestPasswordReset as proof of email ownership; rejects anything
  // else (forged, guessed, expired, or already-used tokens) with the same
  // generic error so no signal is leaked about which failure mode occurred.
  async confirmPasswordReset(data: PasswordResetConfirmInput, ip?: string): Promise<void> {
    const token_hash = crypto.createHash('sha256').update(data.token).digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { token_hash } });
    if (!resetToken || resetToken.used_at || resetToken.expires_at < new Date()) {
      throw new UnauthorizedError('Invalid or expired reset token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: resetToken.user_id } });
    if (!user || user.deleted_at || !user.is_active) {
      throw new UnauthorizedError('Invalid or expired reset token');
    }

    const password_hash = await bcrypt.hash(data.new_password, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      // Prevent TOCTOU race conditions by checking used_at is still null atomically
      const tokenUpdate = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, used_at: null },
        data: { used_at: new Date() }
      });
      if (tokenUpdate.count === 0) {
        throw new UnauthorizedError('Invalid or expired reset token');
      }
      
      await tx.user.update({ where: { id: user.id }, data: { password_hash } });
      await tx.session.deleteMany({ where: { user_id: user.id } });
      // ADR-031 D-4: post-compromise lockout extends to already-issued access
      // tokens, not just Session rows, which this path already deleted above.
      await bumpTokenGeneration(tx, user.id);
    });

    await this.logAudit(user.id, user.role, 'MODIFY', 'USER', user.id, { action: 'password_reset_completed' }, ip);
    await this.logAudit(user.id, user.role, 'MODIFY', 'USER', user.id, { action: 'token_generation_bumped', reason: 'password_reset_completed' }, ip);
  }

  // ADR-031 D-4 (PR-4): Admin-only "log out everywhere" — bumps
  // token_generation without touching Session rows (that's `logout`'s job,
  // deliberately left alone per D-4's table). Distinct from a demotion or
  // deactivation bump: there is no other state change to be transactional
  // with, so this stands alone as its own atomic unit.
  async revokeAllSessions(userId: string, actorId: string, actorRole: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    await bumpTokenGeneration(this.prisma, userId);
    await this.logAudit(actorId, actorRole, 'MODIFY', 'USER', userId, { action: 'token_generation_bumped', reason: 'admin_revoke_all_sessions' }, ip);
  }

  async updateProfile(userId: string, data: UpdateProfileRequest, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at) throw new NotFoundError('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        first_name: data.first_name ?? user.first_name,
        last_name: data.last_name ?? user.last_name,
        phone: data.phone ?? user.phone,
        profile_photo_url: data.profile_photo_url ?? user.profile_photo_url,
        // Deliberately NOT the `data.x ?? user.x` idiom used above. That
        // pattern cannot distinguish "key absent" from "key present and
        // null", and for this field the difference is the whole feature:
        // an explicit null clears the preference and hands the user back to
        // device-locale negotiation, whereas `?? user.preferred_language`
        // would silently treat that clear as "leave unchanged" and make the
        // preference impossible to unset. Keyed off `in` so only an actually
        // supplied key writes.
        ...('preferred_language' in data
          ? { preferred_language: data.preferred_language ?? null }
          : {}),
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        profile_photo_url: true,
        role: true,
        is_active: true,
        preferred_language: true,
        updated_at: true,
      },
    });

    await this.logAudit(userId, user.role, 'MODIFY', 'USER', userId, { fields: Object.keys(data) }, ip);
    // ADR-031 D-1/M-3 (PR-7): derived from ROLE_PERMISSIONS[role], not a
    // stored column (dropped).
    return { ...updated, role: updated.role.toLowerCase(), permissions: ROLE_PERMISSIONS[updated.role] ?? [] };
  }

  // ADR-016: backend-auth is the authoritative writer of AuditLog and owns
  // any read interface over it. Generic, caller-agnostic query -- no code
  // path here ever calls prisma.auditLog.create/update/delete (writes stay
  // exclusively on BaseService.logAudit's own path, used platform-wide).
  // Bounded/paginated, matching ConsentService.getAuditHistory's and
  // RetentionService.getDeletionAuditLog's identical guardrail. AuditLog's
  // existing indexes (schema.prisma:995-1000: actor_id, action,
  // resource_type, resource_id, timestamp, [resource_type, resource_id])
  // already cover every filter combination below -- no new index required.
  async getAuditTrail(
    query: AuditLogQuery
  ): Promise<{ data: AuditLogEntryDto[]; total: number }> {
    const where = {
      ...(query.actor_id ? { actor_id: query.actor_id } : {}),
      // Normalized the same way BaseService.logAudit writes it -- uppercase
      // string coerced to the UserRole enum -- so a caller-supplied lowercase
      // role string (e.g. "admin") still matches stored rows.
      ...(query.actor_role ? { actor_role: query.actor_role.toUpperCase() as UserRole } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resource_type ? { resource_type: query.resource_type } : {}),
      ...(query.resource_id ? { resource_id: query.resource_id } : {}),
      ...(query.from || query.to
        ? {
            timestamp: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        // KNOWN GAP, not fixed here: two rows sharing the exact same
        // `timestamp` have no defined relative order (single-column sort
        // only). Same latent gap as HR's/Consent's own `created_at`/
        // `decided_at`-only orderBy clauses -- a repo-wide pattern, not
        // unique to this interface. Fix would be a secondary `{ id: 'desc' }`
        // tiebreaker; backlogged as a repo-wide pass rather than a one-off
        // fix here, so this interface doesn't silently diverge in shape
        // from its siblings.
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: entries.map((e) => this.toAuditLogEntryDto(e)),
      total,
    };
  }

  private toAuditLogEntryDto(entry: {
    id: string;
    actor_id: string | null;
    actor_role: string | null;
    action: string;
    resource_type: string;
    resource_id: string;
    old_values: unknown;
    new_values: unknown;
    details: unknown;
    ip_address: string | null;
    timestamp: Date;
  }): AuditLogEntryDto {
    return {
      id: entry.id,
      actor_id: entry.actor_id,
      actor_role: entry.actor_role,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      old_values: entry.old_values,
      new_values: entry.new_values,
      details: entry.details,
      ip_address: entry.ip_address,
      timestamp: entry.timestamp.toISOString(),
    };
  }
}

export const authService = new AuthService();
