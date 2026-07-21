import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { BaseService } from '../../lib/base-service.js';
import { signTokens, verifyRefreshToken, UserScope } from '../../lib/jwt.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} from '../../lib/errors.js';
import { ROLE_PERMISSIONS, BCRYPT_ROUNDS, PASSWORD_RESET_TOKEN_TTL_MINUTES } from '../../config/constants.js';
import { SignupRequest, LoginRequest, RefreshTokenRequest, UpdateProfileRequest, PasswordResetRequestInput, PasswordResetConfirmInput } from './validation.js';
import { AuthResponse } from './types.js';

export class AuthService extends BaseService {
  // SECURITY (OQ-AUTH-15): only a SHA-256 digest of the refresh token is ever
  // persisted (same pattern as PasswordResetToken.token_hash below) — a
  // database read (backup, replica, injection) no longer yields a token an
  // attacker can replay against POST /auth/refresh or /auth/logout.
  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
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

    const group = await this.prisma.hotelGroup.findFirst({
      where: { regional_manager_user_id: userId },
      select: { id: true },
    });
    if (group) {
      return { type: 'hotel_group', hotel_group_id: group.id };
    }

    const hotel = await this.prisma.hotel.findFirst({
      where: { manager_user_id: userId },
      select: { id: true },
    });
    if (hotel) {
      return { type: 'hotel', hotel_id: hotel.id };
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
    const permissions = ROLE_PERMISSIONS['WORKER'] ?? [];

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
    });

    const scope = await this.resolveScope(user.id, user.role);
    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      permissions: user.permissions,
      scope,
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
        permissions: user.permissions,
        is_active: user.is_active,
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at?.toISOString(),
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  async login(data: LoginRequest, ip?: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user || user.deleted_at) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!user.is_active) {
      throw new ForbiddenError('Account is disabled');
    }

    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const scope = await this.resolveScope(user.id, user.role);
    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      permissions: user.permissions,
      scope,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: this.hashRefreshToken(tokens.refresh_token),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.logAudit(user.id, user.role, 'LOGIN', 'USER', user.id, { email: user.email }, ip);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone ?? undefined,
        profile_photo_url: user.profile_photo_url ?? undefined,
        role: user.role.toLowerCase(),
        permissions: user.permissions,
        is_active: user.is_active,
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at?.toISOString(),
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  async refreshToken(data: RefreshTokenRequest): Promise<Pick<AuthResponse, 'access_token' | 'refresh_token' | 'expires_in'>> {
    const payload = verifyRefreshToken(data.refresh_token);
    if (!payload) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const session = await this.prisma.session.findFirst({
      where: { refresh_token: this.hashRefreshToken(data.refresh_token), user_id: payload.sub },
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
      permissions: user.permissions,
      scope,
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
        permissions: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!user) throw new NotFoundError('User not found');
    return { ...user, role: user.role.toLowerCase() };
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

    // Invalidate any still-outstanding tokens from earlier requests so at
    // most one reset token is ever valid for an account at a time (security
    // review FIND-02: shrinks standing attack surface from stale tokens).
    await this.prisma.passwordResetToken.deleteMany({
      where: { user_id: user.id, used_at: null },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash,
        expires_at: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000),
      },
    });

    await this.logAudit(user.id, user.role, 'MODIFY', 'USER', user.id, { action: 'password_reset_requested' }, ip);

    // Delivering `rawToken` to the account holder's inbox depends on the
    // email-transport capability, which is not yet implemented anywhere in
    // the platform (NotificationService.sendEmail throws NotImplementedError;
    // tracked separately as SIR-NOTIF-007 / SIR-AUTH-005). Wiring that
    // transport is out of this hotfix's bounded scope (backend-auth only).
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

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { password_hash } }),
      this.prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { used_at: new Date() } }),
      this.prisma.session.deleteMany({ where: { user_id: user.id } }),
    ]);

    await this.logAudit(user.id, user.role, 'MODIFY', 'USER', user.id, { action: 'password_reset_completed' }, ip);
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
      },
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
        updated_at: true,
      },
    });

    await this.logAudit(userId, user.role, 'MODIFY', 'USER', userId, { fields: Object.keys(data) }, ip);
    return { ...updated, role: updated.role.toLowerCase() };
  }
}

export const authService = new AuthService();
