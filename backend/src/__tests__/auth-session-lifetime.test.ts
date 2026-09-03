import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'node:crypto';

/**
 * Sessions persist like a consumer app's: signed out by an EVENT that means
 * "sign out", never by the calendar.
 *
 * These assertions exist because the bug they cover was invisible. Three
 * call sites (signup, login, refresh) set `Session.expires_at` from a
 * literal `7 * 24 * 60 * 60 * 1000` while the refresh JWT was signed from
 * JWT_REFRESH_EXPIRY. Raising that setting alone changed nothing a user
 * could feel -- refreshToken() rejects on `session.expires_at < new Date()`
 * before the JWT's own expiry matters, so every worker would still have been
 * logged out on day 7, with no failing test and no error to explain it.
 *
 * So these tests deliberately assert the row is DERIVED from the setting,
 * using a value that is neither the old literal nor the current default. A
 * test pinned to "365 days" would pass again the moment someone reintroduced
 * a hardcoded constant that happened to match.
 */

const REFRESH_EXPIRY = '30d';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  session: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  employmentRecord: {
    findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  },
  hotelGroup: {
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  },
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-x',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: REFRESH_EXPIRY,
    AUTH_LOGIN_THROTTLE_THRESHOLD: 10,
    AUTH_LOGIN_THROTTLE_DURATION_MS: 900000,
    AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD: 5,
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AuthService } from '../modules/auth/service.js';
import { signTokens } from '../lib/jwt.js';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

async function activeUser() {
  const bcrypt = (await import('bcrypt')).default;
  return {
    id: 'user_1',
    email: 'worker@test.com',
    password_hash: await bcrypt.hash('password123', 4),
    first_name: 'A',
    last_name: 'B',
    role: 'WORKER',
    permissions: [],
    is_active: true,
    deleted_at: null,
    token_generation: 1,
    preferred_language: 'en',
    failed_login_attempts: 0,
    last_failed_login_at: null,
    throttled_until: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('session lifetime is derived from JWT_REFRESH_EXPIRY, not hardcoded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
    mockPrisma.hotel.findMany.mockResolvedValue([]);
    mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
    mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
    mockPrisma.session.update.mockResolvedValue({ id: 'sess_1' });
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('dates a new login session from the configured expiry', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await activeUser());
    const service = new AuthService();

    const before = Date.now();
    await service.login({ email: 'worker@test.com', password: 'password123' } as any);

    expect(mockPrisma.session.create).toHaveBeenCalled();
    const expiresAt: Date = (mockPrisma.session.create.mock.calls[0][0] as any).data.expires_at;
    const window = expiresAt.getTime() - before;

    // Within a minute of the configured 30 days, and unambiguously NOT the
    // 7-day literal this replaced.
    expect(window).toBeGreaterThan(THIRTY_DAYS_MS - 60_000);
    expect(window).toBeLessThan(THIRTY_DAYS_MS + 60_000);
  });

  it('slides the window forward on every refresh, so an active user is never logged out', async () => {
    const user = await activeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const tokens = signTokens({
      sub: user.id, email: user.email, role: 'worker', scope: null, token_generation: 1,
    } as any);

    // A session already close to expiry: the refresh must push it out a full
    // window again, not top it up or leave it alone.
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 'sess_1',
      user_id: user.id,
      refresh_token: sha256(tokens.refresh_token),
      expires_at: new Date(Date.now() + 60_000),
    });

    const service = new AuthService();
    const before = Date.now();
    await service.refreshToken(tokens.refresh_token);

    const expiresAt: Date = (mockPrisma.session.update.mock.calls[0][0] as any).data.expires_at;
    const window = expiresAt.getTime() - before;
    expect(window).toBeGreaterThan(THIRTY_DAYS_MS - 60_000);
    expect(window).toBeLessThan(THIRTY_DAYS_MS + 60_000);
  });

  it('still refuses to refresh a deactivated account, however long the window is', async () => {
    const user = { ...(await activeUser()), is_active: false };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const tokens = signTokens({
      sub: user.id, email: user.email, role: 'worker', scope: null, token_generation: 1,
    } as any);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 'sess_1', user_id: user.id, refresh_token: sha256(tokens.refresh_token),
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS),
    });

    const service = new AuthService();
    await expect(service.refreshToken(tokens.refresh_token)).rejects.toThrow(/not found or inactive/i);
  });

  it('still refuses to refresh a soft-deleted account, however long the window is', async () => {
    const user = { ...(await activeUser()), deleted_at: new Date() };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const tokens = signTokens({
      sub: user.id, email: user.email, role: 'worker', scope: null, token_generation: 1,
    } as any);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 'sess_1', user_id: user.id, refresh_token: sha256(tokens.refresh_token),
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS),
    });

    const service = new AuthService();
    await expect(service.refreshToken(tokens.refresh_token)).rejects.toThrow(/not found or inactive/i);
  });
});
