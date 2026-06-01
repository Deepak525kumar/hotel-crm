import * as argon2 from 'argon2';
import { BaseService } from '../../lib/base-service.js';
import { signTokens, verifyRefreshToken } from '../../lib/jwt.js';
import {
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  SignupRequest,
  LoginRequest,
  RefreshTokenRequest,
  UpdateProfileRequest,
} from './validation.js';

export class AuthService extends BaseService {
  async signup(data: SignupRequest) {
    const { email, password, first_name, last_name, phone, hotel_ids, role } = data;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictError(`User with email ${email} already exists`);
    }

    const passwordHash = await argon2.hash(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        password_hash: passwordHash,
        first_name,
        last_name,
        phone: phone || null,
        role: (role?.toUpperCase() || 'WORKER') as 'WORKER' | 'CHECKER' | 'MANAGER' | 'ADMIN',
        hotel_ids: hotel_ids || [],
        permissions: this.getDefaultPermissions(role || 'worker'),
        is_active: true,
      },
    });

    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
      hotel_ids: user.hotel_ids,
      permissions: user.permissions,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    logger.info('User registered successfully', {
      user_id: user.id,
      email: user.email,
      role: user.role,
    });

    return this.formatAuthResponse(user, tokens);
  }

  async login(data: LoginRequest) {
    const { email, password } = data;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.is_active || user.deleted_at) {
      throw new UnauthorizedError('Account is disabled');
    }

    const isPasswordValid = await argon2.verify(user.password_hash, password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
      hotel_ids: user.hotel_ids,
      permissions: user.permissions,
    });

    await this.prisma.session.create({
      data: {
        user_id: user.id,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    logger.info('User logged in successfully', {
      user_id: user.id,
      email: user.email,
    });

    return this.formatAuthResponse(user, tokens);
  }

  async refreshToken(data: RefreshTokenRequest) {
    const { refresh_token } = data;

    const payload = verifyRefreshToken(refresh_token);
    if (!payload) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.is_active || user.deleted_at) {
      throw new UnauthorizedError('User not found or account is disabled');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        user_id: user.id,
        refresh_token,
      },
    });

    if (!session) {
      throw new UnauthorizedError('Session not found');
    }

    if (new Date() > session.expires_at) {
      await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedError('Refresh token expired');
    }

    const tokens = signTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
      hotel_ids: user.hotel_ids,
      permissions: user.permissions,
    });

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    logger.info('Access token refreshed', { user_id: user.id });

    return this.formatTokenResponse(tokens);
  }

  async logout(userId: string) {
    await this.prisma.session.deleteMany({
      where: { user_id: userId },
    });

    logger.info('User logged out', { user_id: userId });
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this.formatUserResponse(user);
  }

  async updateProfile(userId: string, data: UpdateProfileRequest) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        first_name: data.first_name !== undefined ? data.first_name : user.first_name,
        last_name: data.last_name !== undefined ? data.last_name : user.last_name,
        phone: data.phone !== undefined ? data.phone : user.phone,
        profile_photo_url:
          data.profile_photo_url !== undefined ? data.profile_photo_url : user.profile_photo_url,
        updated_at: new Date(),
      },
    });

    logger.info('User profile updated', { user_id: userId });

    return this.formatUserResponse(updatedUser);
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Soft delete: mark user as deleted
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });

    // Invalidate all sessions
    await this.prisma.session.deleteMany({
      where: { user_id: userId },
    });

    // Log the deletion action
    await this.prisma.auditLog.create({
      data: {
        actor_id: userId,
        actor_role: user.role.toLowerCase(),
        action: 'DELETE',
        resource_type: 'USER',
        resource_id: userId,
        details: {
          reason: 'Account self-deletion',
          deleted_at: new Date().toISOString(),
        },
      },
    });

    logger.info('User account deleted', { user_id: userId, email: user.email });

    return {
      status: 'success',
      message: 'Account deleted successfully',
    };
  }

  async exportUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Collect all user-related data
    const userProfile = this.formatUserResponse(user);

    const sessions = await this.prisma.session.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        expires_at: true,
        created_at: true,
      },
    });

    // Role-specific data based on user role
    let roleSpecificData: Record<string, any> = {};

    if (user.role === 'WORKER') {
      const tasks = await this.prisma.task.findMany({
        where: { assigned_to_worker_id: userId },
        select: {
          id: true,
          description: true,
          status: true,
          priority: true,
          created_at: true,
          completed_at: true,
        },
      });

      const ratings = await this.prisma.rating.findMany({
        where: { worker_id: userId },
        select: {
          id: true,
          score: true,
          comment: true,
          created_at: true,
        },
      });

      const contracts = await this.prisma.contract.findMany({
        where: { worker_id: userId },
        select: {
          id: true,
          contract_number: true,
          start_date: true,
          end_date: true,
          position: true,
          status: true,
        },
      });

      const documents = await this.prisma.workerDocument.findMany({
        where: { worker_id: userId, deleted_at: null },
        select: {
          id: true,
          document_type: true,
          document_name: true,
          file_size: true,
          expiry_date: true,
          created_at: true,
        },
      });

      const payroll = await this.prisma.payroll.findMany({
        where: { worker_id: userId, deleted_at: null },
        select: {
          id: true,
          pay_period_start: true,
          pay_period_end: true,
          gross_salary: true,
          gross_currency: true,
          status: true,
          created_at: true,
        },
      });

      roleSpecificData = {
        tasks,
        ratings,
        contracts,
        documents,
        payroll,
      };
    }

    if (user.role === 'MANAGER') {
      const hotels = await this.prisma.hotel.findMany({
        where: { id: { in: user.hotel_ids } },
        select: {
          id: true,
          name: true,
          city: true,
          created_at: true,
        },
      });

      roleSpecificData = {
        hotels,
      };
    }

    // Log the data export
    await this.prisma.auditLog.create({
      data: {
        actor_id: userId,
        actor_role: user.role.toLowerCase(),
        action: 'EXPORT',
        resource_type: 'USER',
        resource_id: userId,
        details: {
          reason: 'GDPR data export request',
          exported_at: new Date().toISOString(),
        },
      },
    });

    logger.info('User data exported', { user_id: userId, email: user.email });

    return {
      user: userProfile,
      sessions,
      ...roleSpecificData,
      exported_at: new Date().toISOString(),
    };
  }

  private getDefaultPermissions(role: string): string[] {
    const permissions: Record<string, string[]> = {
      admin: ['admin:*'],
      manager: [
        'hotels:read:own',
        'rooms:read:own',
        'rooms:create:own',
        'rooms:update:own',
        'rooms:delete:own',
        'tasks:read:own',
        'tasks:create:own',
        'tasks:update:own',
        'hr:read:own',
        'hr:create:own',
        'hr:update:own',
        'staffing:read:own',
        'staffing:create:own',
        'staffing:update:own',
        'notifications:read:own',
        'analytics:read:own',
      ],
      checker: [
        'rooms:read:own',
        'tasks:read:own',
        'quality:create',
        'quality:update:own',
        'quality:read:own',
        'ratings:create',
        'notifications:read:own',
        'leaderboard:read:own',
      ],
      worker: [
        'tasks:read:own',
        'tasks:update:own',
        'tasks:start:own',
        'tasks:complete:own',
        'tasks:upload-photos:own',
        'profile:read:own',
        'profile:update:own',
        'notifications:read:own',
        'leaderboard:read:own',
        'ratings:read:own',
        'contracts:read:own',
        'documents:read:own',
        'payroll:read:own',
      ],
    };

    return permissions[role] || permissions.worker;
  }

  private formatAuthResponse(user: any, tokens: any) {
    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        profile_photo_url: user.profile_photo_url,
        role: user.role.toLowerCase(),
        hotel_ids: user.hotel_ids,
        is_active: user.is_active,
        created_at: user.created_at.toISOString(),
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  private formatTokenResponse(tokens: any) {
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    };
  }

  private formatUserResponse(user: any) {
    return {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      profile_photo_url: user.profile_photo_url,
      role: user.role.toLowerCase(),
      hotel_ids: user.hotel_ids,
      is_active: user.is_active,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString(),
    };
  }
}

export const authService = new AuthService();
