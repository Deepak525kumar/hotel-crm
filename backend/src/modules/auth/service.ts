import bcrypt from 'bcryptjs';
import { BaseService } from '../../lib/base-service.js';
import { signTokens, verifyRefreshToken } from '../../lib/jwt.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} from '../../lib/errors.js';
import { ROLE_PERMISSIONS, BCRYPT_ROUNDS } from '../../config/constants.js';
import { SignupRequest, LoginRequest, RefreshTokenRequest, UpdateProfileRequest, PasswordResetRequest } from './validation.js';
import { AuthResponse } from './types.js';

export class AuthService extends BaseService {
  async signup(data: SignupRequest, ip?: string): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new ConflictError('Email already registered');
    }

    const password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const role = (data.role?.toUpperCase() ?? 'WORKER') as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN';
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
    });

    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      permissions: user.permissions,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.logAudit(user.id, user.role.toLowerCase(), 'SIGNUP', 'USER', user.id, { email: user.email }, ip);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        profile_photo_url: user.profile_photo_url,
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

    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      permissions: user.permissions,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.logAudit(user.id, user.role.toLowerCase(), 'LOGIN', 'USER', user.id, { email: user.email }, ip);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        profile_photo_url: user.profile_photo_url,
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
      where: { refresh_token: data.refresh_token, user_id: payload.sub },
    });
    if (!session || session.expires_at < new Date()) {
      throw new UnauthorizedError('Session expired or not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.is_active || user.deleted_at) {
      throw new UnauthorizedError('User not found or inactive');
    }

    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role.toLowerCase(),
      permissions: user.permissions,
    });

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refresh_token: tokens.refresh_token,
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
        where: { user_id: userId, refresh_token: refreshToken },
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

  async resetPassword(data: PasswordResetRequest, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user || user.deleted_at || !user.is_active) {
      // Return silently — do not reveal whether email exists
      return;
    }

    const password_hash = await bcrypt.hash(data.new_password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password_hash },
    });

    await this.prisma.session.deleteMany({ where: { user_id: user.id } });
    await this.logAudit(user.id, user.role.toLowerCase(), 'MODIFY', 'USER', user.id, { action: 'password_reset' }, ip);
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

    await this.logAudit(userId, user.role.toLowerCase(), 'MODIFY', 'USER', userId, { fields: Object.keys(data) }, ip);
    return { ...updated, role: updated.role.toLowerCase() };
  }
}

export const authService = new AuthService();
