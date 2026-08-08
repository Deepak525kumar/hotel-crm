import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Security #4 (2026-08-09): httpOnly auth cookies for the web frontend,
 * added alongside the existing bearer-token contract mobile relies on.
 *
 * Covers three surfaces:
 *  - middleware/auth.ts's `resolveAccessToken` (cookie fallback + header
 *    precedence when both are present)
 *  - lib/cookies.ts's `setAuthCookies`/`clearAuthCookies` (exact flags --
 *    the highest-value target here, since a flipped `httpOnly`/`secure`
 *    would silently reintroduce the exact XSS vulnerability this closes)
 *  - the auth controller's refresh/logout cookie-vs-body token resolution
 */

const mockUserFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    user: { findUnique: mockUserFindUnique },
  }),
}));

const mockVerifyAccessToken = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/jwt.js', () => {
  const actual = jest.requireActual('../lib/jwt.js') as object;
  return {
    ...actual,
    verifyAccessToken: (token: string) => mockVerifyAccessToken(token),
  };
});

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-x',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
    COOKIE_DOMAIN: undefined,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

const mockAuthServiceRefreshToken = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuthServiceLogout = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/auth/service.js', () => ({
  authService: {
    refreshToken: (...args: any[]) => mockAuthServiceRefreshToken(...args),
    logout: (...args: any[]) => mockAuthServiceLogout(...args),
  },
}));

import { authMiddleware } from '../middleware/auth.js';
import { setAuthCookies, clearAuthCookies, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../lib/cookies.js';
import { authController } from '../modules/auth/controller.js';
import { ERROR_CODES } from '../config/constants.js';

function makeReq(opts: { header?: string; cookies?: Record<string, string> }) {
  return {
    headers: { authorization: opts.header },
    cookies: opts.cookies ?? {},
    auth: undefined,
  } as any;
}

describe('Security #4 — access-token source resolution (header vs cookie)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockVerifyAccessToken.mockReset();
  });

  const basePayload = {
    sub: 'user-1',
    email: 'a@b.com',
    role: 'manager',
    scope: null,
    token_generation: 3,
  };
  const liveUserRow = {
    id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 3,
  };

  it('succeeds with only a cookie (no Authorization header) — the new web path', async () => {
    mockVerifyAccessToken.mockImplementation((token: string) =>
      token === 'cookie-token' ? basePayload : null
    );
    mockUserFindUnique.mockResolvedValue(liveUserRow);
    const req = makeReq({ cookies: { [ACCESS_TOKEN_COOKIE]: 'cookie-token' } });
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toMatchObject({ userId: 'user-1' });
  });

  it('succeeds with only an Authorization header (no cookies) — mobile-equivalence, must not regress', async () => {
    mockVerifyAccessToken.mockImplementation((token: string) =>
      token === 'header-token' ? basePayload : null
    );
    mockUserFindUnique.mockResolvedValue(liveUserRow);
    const req = makeReq({ header: 'Bearer header-token', cookies: {} });
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toMatchObject({ userId: 'user-1' });
  });

  it('prefers the header when both a header and a cookie are present, for different subjects', async () => {
    mockVerifyAccessToken.mockImplementation((token: string) => {
      if (token === 'header-token') return { ...basePayload, sub: 'header-user' };
      if (token === 'cookie-token') return { ...basePayload, sub: 'cookie-user' };
      return null;
    });
    mockUserFindUnique.mockImplementation(({ where }: any) => ({
      id: where.id, role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 3,
    }));
    const req = makeReq({
      header: 'Bearer header-token',
      cookies: { [ACCESS_TOKEN_COOKIE]: 'cookie-token' },
    });
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(req.auth).toMatchObject({ userId: 'header-user' });
  });

  it('401s when neither a header nor a cookie is present', async () => {
    const req = makeReq({});
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: ERROR_CODES.UNAUTHORIZED })
    );
    expect(req.auth).toBeUndefined();
  });

  it('401s on an invalid cookie value with no header fallback', async () => {
    mockVerifyAccessToken.mockReturnValue(null);
    const req = makeReq({ cookies: { [ACCESS_TOKEN_COOKIE]: 'garbage' } });
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: ERROR_CODES.UNAUTHORIZED })
    );
  });
});

describe('Security #4 — lib/cookies.ts flag correctness (mutation-critical)', () => {
  function makeRes() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as any;
  }

  it('sets both cookies with httpOnly, sameSite=lax, path=/, and NODE_ENV-derived secure', () => {
    const res = makeRes();
    setAuthCookies(res, { access_token: 'a', refresh_token: 'r', expires_in: 900 });

    expect(res.cookie).toHaveBeenCalledTimes(2);
    for (const call of res.cookie.mock.calls) {
      const [, , options] = call;
      // NODE_ENV is 'test' here (not 'production'), so secure must be false --
      // asserting the exact boolean, not just "the key exists", catches a
      // `secure: true` unconditional literal that would break local/test HTTP.
      expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    }
  });

  it('sets the access cookie name/value/maxAge from expires_in', () => {
    const res = makeRes();
    setAuthCookies(res, { access_token: 'the-access-token', refresh_token: 'r', expires_in: 900 });

    const accessCall = res.cookie.mock.calls.find((c: any) => c[0] === ACCESS_TOKEN_COOKIE);
    expect(accessCall).toBeDefined();
    expect(accessCall![1]).toBe('the-access-token');
    expect(accessCall![2].maxAge).toBe(900 * 1000);
  });

  it('sets the refresh cookie maxAge from JWT_REFRESH_EXPIRY, independent of expires_in', () => {
    const res = makeRes();
    setAuthCookies(res, { access_token: 'a', refresh_token: 'the-refresh-token', expires_in: 900 });

    const refreshCall = res.cookie.mock.calls.find((c: any) => c[0] === REFRESH_TOKEN_COOKIE);
    expect(refreshCall).toBeDefined();
    expect(refreshCall![1]).toBe('the-refresh-token');
    // JWT_REFRESH_EXPIRY = '7d' per the mocked env above.
    expect(refreshCall![2].maxAge).toBe(7 * 86400 * 1000);
  });

  it('clearAuthCookies clears both cookies with flags matching what setAuthCookies set', () => {
    const res = makeRes();
    clearAuthCookies(res);

    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    const names = res.clearCookie.mock.calls.map((c: any) => c[0]);
    expect(names.sort()).toEqual([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE].sort());
    for (const call of res.clearCookie.mock.calls) {
      expect(call[1]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    }
  });
});

describe('Security #4 — controller refresh/logout cookie-vs-body resolution', () => {
  function makeRes() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
  }

  const refreshHandler = authController.refreshToken[1] as (
    req: any, res: any, next: any
  ) => Promise<void>;

  beforeEach(() => {
    mockAuthServiceRefreshToken.mockReset();
    mockAuthServiceLogout.mockReset();
  });

  it('refresh: uses the cookie and sends no body-derived token when only a cookie is present (web path)', async () => {
    mockAuthServiceRefreshToken.mockResolvedValue({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900,
    });
    const req = { cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-refresh' }, body: {}, requestId: 'r1' } as any;
    const res = makeRes();
    const next = jest.fn();

    await refreshHandler(req, res, next);

    expect(mockAuthServiceRefreshToken).toHaveBeenCalledWith('cookie-refresh');
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('refresh: uses the body token when only a body token is present (mobile path, unchanged)', async () => {
    mockAuthServiceRefreshToken.mockResolvedValue({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900,
    });
    const req = { cookies: {}, body: { refresh_token: 'body-refresh' }, requestId: 'r2' } as any;
    const res = makeRes();
    const next = jest.fn();

    await refreshHandler(req, res, next);

    expect(mockAuthServiceRefreshToken).toHaveBeenCalledWith('body-refresh');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('refresh: prefers the cookie over the body when both are present', async () => {
    mockAuthServiceRefreshToken.mockResolvedValue({
      access_token: 'a', refresh_token: 'r', expires_in: 900,
    });
    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-refresh' },
      body: { refresh_token: 'body-refresh' },
      requestId: 'r3',
    } as any;
    const res = makeRes();
    const next = jest.fn();

    await refreshHandler(req, res, next);

    expect(mockAuthServiceRefreshToken).toHaveBeenCalledWith('cookie-refresh');
  });

  it('refresh: 401s via next() when neither a cookie nor a body token is present, and never calls the service', async () => {
    const req = { cookies: {}, body: {}, requestId: 'r4' } as any;
    const res = makeRes();
    const next = jest.fn();

    await refreshHandler(req, res, next);

    expect(mockAuthServiceRefreshToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ERROR_CODES.UNAUTHORIZED }));
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('logout: deletes the session identified by the cookie and clears both cookies (web path)', async () => {
    mockAuthServiceLogout.mockResolvedValue(undefined);
    const req = {
      auth: { userId: 'user-1' },
      cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-refresh' },
      body: {},
      requestId: 'r5',
    } as any;
    const res = makeRes();
    const next = jest.fn();

    await authController.logout(req, res, next);

    expect(mockAuthServiceLogout).toHaveBeenCalledWith('user-1', 'cookie-refresh');
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });

  it('logout: falls back to the body token when no cookie is present (mobile path, unchanged)', async () => {
    mockAuthServiceLogout.mockResolvedValue(undefined);
    const req = {
      auth: { userId: 'user-1' },
      cookies: {},
      body: { refresh_token: 'body-refresh' },
      requestId: 'r6',
    } as any;
    const res = makeRes();
    const next = jest.fn();

    await authController.logout(req, res, next);

    expect(mockAuthServiceLogout).toHaveBeenCalledWith('user-1', 'body-refresh');
  });
});
