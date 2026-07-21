import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'node:crypto';

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
  passwordResetToken: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // PR 5.4 (ADR-023 §6 / ADR-025 §4): AuthService.resolveScope reads these
  // read-only association tables when issuing an access token. Default to
  // "no association" (null) so existing tests that don't care about scope
  // are unaffected; dedicated coverage lives in auth-scope-claim.test.ts.
  hotelGroup: {
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) as jest.MockedFunction<(...args: any[]) => any>,
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

    it('assigns the non-privileged WORKER role and permissions on legitimate signup', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_2', email: 'worker@test.com', first_name: 'Work', last_name: 'Er',
        role: 'WORKER', permissions: [], is_active: true, created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.signup({
        email: 'worker@test.com', password: 'password123', first_name: 'Work', last_name: 'Er',
      });

      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string; permissions: string[] } }>;
      expect(createCall[0]?.data.role).toBe('WORKER');
      expect(createCall[0]?.data.permissions).not.toContain('admin:*');
      expect(createCall[0]?.data.permissions).toEqual(
        expect.arrayContaining(['hotels:read', 'rooms:read', 'tasks:read', 'notifications:read'])
      );
    });

    // HOTFIX-AUTH-001: privilege-escalation regression suite. The server must
    // never honour a client-supplied role on public signup — every injected
    // role must collapse to a non-privileged WORKER account.
    it.each([
      ['admin', 'admin:*'],
      ['manager', 'staffing:write'],
      ['checker', 'quality:write'],
      ['regional_manager', 'admin:*'],
    ])('ignores injected role "%s" and never grants privileged permissions', async (injectedRole: string, privilegedPerm: string) => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_x', email: 'attacker@test.com', first_name: 'Mal', last_name: 'Ory',
        role: 'WORKER', permissions: [], is_active: true, created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.signup({
        email: 'attacker@test.com', password: 'password123', first_name: 'Mal', last_name: 'Ory',
        // Simulate an attacker bypassing the schema and injecting a privileged role.
        role: injectedRole,
      } as any);

      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string; permissions: string[] } }>;
      expect(createCall[0]?.data.role).toBe('WORKER');
      expect(createCall[0]?.data.permissions).not.toContain(privilegedPerm);
      expect(createCall[0]?.data.permissions).not.toContain('admin:*');
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

    it('deletes specific session when refresh token provided (looked up by hash, not raw value)', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.logout('user_1', 'specific-refresh-token');

      const expectedHash = crypto.createHash('sha256').update('specific-refresh-token').digest('hex');
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user_1', refresh_token: expectedHash },
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

  // HOTFIX-AUTH-002: the previous single-step `resetPassword(email, new_password)`
  // let anyone who knew a victim's email overwrite their password with no proof
  // of account ownership. This regression suite covers the replacement two-step,
  // server-issued single-use token flow (request -> confirm).
  describe('requestPasswordReset', () => {
    const activeUser = {
      id: 'user_1',
      email: 'victim@test.com',
      role: 'WORKER',
      is_active: true,
      deleted_at: null,
    };

    it('silently succeeds for an unknown email (no account enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.requestPasswordReset({ email: 'nobody@test.com' })
      ).resolves.toBeUndefined();
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('silently succeeds without issuing a token for a disabled account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, is_active: false });

      await service.requestPasswordReset({ email: activeUser.email });
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('silently succeeds without issuing a token for a soft-deleted account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, deleted_at: new Date() });

      await service.requestPasswordReset({ email: activeUser.email });
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('invalidates any prior outstanding tokens before issuing a new one', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestPasswordReset({ email: activeUser.email });

      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { user_id: activeUser.id, used_at: null },
      });
      const deleteOrder = (mockPrisma.passwordResetToken.deleteMany as jest.Mock).mock.invocationCallOrder[0];
      const createOrder = (mockPrisma.passwordResetToken.create as jest.Mock).mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('creates a hashed, expiring, single-use token for a known active user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestPasswordReset({ email: activeUser.email }, '127.0.0.1');

      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const createCall = (mockPrisma.passwordResetToken.create as jest.Mock).mock.calls[0] as Array<{
        data: { user_id: string; token_hash: string; expires_at: Date };
      }>;
      expect(createCall[0]?.data.user_id).toBe(activeUser.id);
      // The raw token is never persisted — only a hash, and it must not be a
      // trivially-guessable/short value.
      expect(createCall[0]?.data.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(createCall[0]?.data.expires_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('never overwrites password_hash directly, even if new_password is injected into the request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.passwordResetToken.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Simulate an attacker bypassing the schema (which no longer declares
      // new_password on the request step) and injecting it directly.
      await service.requestPasswordReset({
        email: activeUser.email,
        new_password: 'Attacker123',
      } as any);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('confirmPasswordReset', () => {
    const activeUser = {
      id: 'user_1',
      email: 'victim@test.com',
      role: 'WORKER',
      is_active: true,
      deleted_at: null,
    };
    const validRawToken = 'a'.repeat(64);
    const validTokenRecord = {
      id: 'prt_1',
      user_id: activeUser.id,
      token_hash: require('node:crypto').createHash('sha256').update(validRawToken).digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      used_at: null,
    };

    it('performs a valid password reset and invalidates all sessions', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: activeUser.id } })
      );
      expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: validTokenRecord.id }, data: expect.objectContaining({ used_at: expect.any(Date) }) })
      );
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { user_id: activeUser.id } });
    });

    it('rejects a random/forged token that was never issued', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset({ token: 'totally-forged-random-token', new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validTokenRecord,
        expires_at: new Date(Date.now() - 60 * 1000),
      });

      await expect(
        service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a reused token (token replay)', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validTokenRecord,
        used_at: new Date(),
      });

      await expect(
        service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a token belonging to a deleted or deactivated account', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, is_active: false });

      await expect(
        service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an unauthorized reset attempt with no valid token in the system', async () => {
      // No request step was ever performed for this user (no token was ever
      // issued) -- the original vulnerability let anyone reset a password by
      // email alone; confirming now unconditionally requires a real token.
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset({ token: 'guess', new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });
  });
});
