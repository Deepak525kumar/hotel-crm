import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the Prisma client before any imports that use it
const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  session: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => mockPrisma,
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-x',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AuthService } from '../modules/auth/service.js';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService();
  });

  describe('signup', () => {
    it('throws ConflictError when email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'test@test.com' });

      await expect(
        service.signup({ email: 'test@test.com', password: 'password123', first_name: 'A', last_name: 'B' })
      ).rejects.toMatchObject({ name: 'ConflictError', message: 'Email already registered' });
    });

    it('creates user and returns tokens on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_1',
        email: 'new@test.com',
        first_name: 'John',
        last_name: 'Doe',
        role: 'WORKER',
        permissions: ['hotels:read'],
        is_active: true,
        created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.signup({
        email: 'new@test.com',
        password: 'password123',
        first_name: 'John',
        last_name: 'Doe',
      });

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.user.email).toBe('new@test.com');
      expect(result.user.role).toBe('worker');
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.session.create).toHaveBeenCalledTimes(1);
    });

    it('assigns ROLE_PERMISSIONS based on role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_2',
        email: 'admin@test.com',
        first_name: 'Admin',
        last_name: 'User',
        role: 'ADMIN',
        permissions: ['admin:*'],
        is_active: true,
        created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.signup({
        email: 'admin@test.com',
        password: 'password123',
        first_name: 'Admin',
        last_name: 'User',
        role: 'admin',
      });

      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string; permissions: string[] } }>;
      expect(createCall[0]?.data.role).toBe('ADMIN');
      expect(createCall[0]?.data.permissions).toContain('admin:*');
    });
  });

  describe('login', () => {
    it('throws UnauthorizedError when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'pw' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });

    it('throws ForbiddenError when account is disabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'disabled@test.com',
        password_hash: '$2a$12$invalid',
        is_active: false,
        deleted_at: null,
        role: 'WORKER',
        permissions: [],
      });

      await expect(
        service.login({ email: 'disabled@test.com', password: 'pw' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('throws UnauthorizedError on wrong password', async () => {
      // bcrypt hash of "correctpassword"
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@test.com',
        password_hash: '$2a$12$notthehashofwrongpassword111111111111',
        is_active: true,
        deleted_at: null,
        role: 'WORKER',
        permissions: [],
      });

      await expect(
        service.login({ email: 'user@test.com', password: 'wrongpassword' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });
  });

  describe('logout', () => {
    it('deletes all sessions when no refresh token provided', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.logout('user_1');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user_1' },
      });
    });

    it('deletes specific session when refresh token provided', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.logout('user_1', 'specific-refresh-token');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user_1', refresh_token: 'specific-refresh-token' },
      });
    });
  });

  describe('getCurrentUser', () => {
    it('returns user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user@test.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: null,
        profile_photo_url: null,
        role: 'WORKER',
        permissions: [],
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getCurrentUser('user_1');

      expect(result.id).toBe('user_1');
      expect(result.role).toBe('worker');
    });

    it('throws NotFoundError when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentUser('nonexistent')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });
  });
});
