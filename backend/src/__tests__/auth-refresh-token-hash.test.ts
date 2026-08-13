import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'node:crypto';

/**
 * Security-regression test for OQ-AUTH-15 (SPEC-AUTH-001).
 *
 * `Session.refresh_token` previously stored the raw, bearer-usable refresh
 * token. Anyone with read access to the row (DB backup, replica, logging,
 * injection) could replay it against POST /auth/refresh or /auth/logout.
 * `AuthService` now persists only a SHA-256 digest — the same
 * hash-at-rest pattern already used for `PasswordResetToken.token_hash` —
 * and hashes the caller-supplied token before every lookup.
 */

const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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
  // login() reads this (read-only) to populate the response's
  // employment_status field (2026-08-13 fix). Defaults to null, which
  // leaves this suite's refresh-token-hash assertions unaffected.
  employmentRecord: {
    findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  },
  // PR 5.4: AuthService.resolveScope reads these (read-only) during
  // login/signup/refreshToken to compute the JWT scope claim. Default
  // (unmocked) resolution returns undefined→null scope, which leaves this
  // suite's refresh-token-hash assertions unaffected.
  hotelGroup: {
    // findUnique, not findFirst — see auth.test.ts's identical note.
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    // resolveScope() uses findMany + orderBy id as of 2026-08-07 (deterministic
    // scope for a manager assigned to multiple hotels). Defaults to [] --
    // these suites are not about scope resolution.
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
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

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

describe('AuthService refresh-token hash-at-rest (OQ-AUTH-15)', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService();
  });

  it('never persists the raw refresh token on login', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@test.com',
      password_hash: await (await import('bcryptjs')).default.hash('password123', 4),
      first_name: 'A',
      last_name: 'B',
      role: 'WORKER',
      permissions: [],
      is_active: true,
      deleted_at: null,
      created_at: new Date(),
    });
    mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = await service.login({ email: 'user@test.com', password: 'password123' });

    const createCall = (mockPrisma.session.create as jest.Mock).mock.calls[0] as Array<{ data: { refresh_token: string } }>;
    const storedValue = createCall[0]?.data.refresh_token;

    expect(storedValue).not.toBe(result.refresh_token);
    expect(storedValue).toBe(sha256(result.refresh_token));
  });

  it('looks up the session by the hash of the caller-supplied refresh token, not the raw value', async () => {
    const rawToken = 'a-raw-refresh-token-value';
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 'sess_1',
      user_id: 'user_1',
      expires_at: new Date(Date.now() + 60_000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@test.com',
      role: 'WORKER',
      permissions: [],
      is_active: true,
      deleted_at: null,
    });
    mockPrisma.session.update.mockResolvedValue({});

    const { signRefreshToken } = await import('../lib/jwt.js');
    const token = signRefreshToken('user_1');

    await service.refreshToken(token);

    expect(mockPrisma.session.findFirst).toHaveBeenCalledWith({
      where: { refresh_token: sha256(token), user_id: 'user_1' },
    });

    const updateCall = (mockPrisma.session.update as jest.Mock).mock.calls[0] as Array<{ data: { refresh_token: string } }>;
    expect(updateCall[0]?.data.refresh_token).not.toBe(token);
    expect(updateCall[0]?.data.refresh_token).not.toBe(rawToken);
  });

  it('deletes a session on logout by the hash of the supplied refresh token', async () => {
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await service.logout('user_1', 'specific-refresh-token');

    expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'user_1', refresh_token: sha256('specific-refresh-token') },
    });
  });
});
