import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

/**
 * Every refresh token must be unique, even when two are minted in the same
 * instant.
 *
 * The claims used to be {sub, type} plus the iat/exp jsonwebtoken adds at
 * SECOND granularity, so two tokens for one user inside the same second were
 * byte-identical. `Session.refresh_token` is @unique and stores a hash of the
 * value, so the second insert violated the constraint and the caller got:
 *
 *     409 CONFLICT — "A record with this value already exists"
 *
 * Reproduced against a running server by firing two logins concurrently: one
 * returned 200, the other 409. Reachable by a double-tapped sign-in button, two
 * devices signing in together, or a login racing a token refresh.
 *
 * Beyond the error, identical tokens meant two distinct sessions could share
 * one refresh token — rotating or revoking either would act on both.
 */
describe('refresh-token uniqueness', () => {
  const ACCESS_SECRET = 'test-access-secret-minimum-32-characters-long';
  const REFRESH_SECRET = 'test-refresh-secret-minimum-32-characters-x';

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/env.js', () => ({
      getEnv: () => ({
        JWT_SECRET: ACCESS_SECRET,
        JWT_REFRESH_SECRET: REFRESH_SECRET,
        JWT_ACCESS_EXPIRY: '1h',
        JWT_REFRESH_EXPIRY: '7d',
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
      }),
      loadEnv: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    }));
  });

  it('mints different tokens for the same user in the same second', async () => {
    const { signRefreshToken } = await import('../lib/jwt.js');

    // No timer manipulation: back-to-back calls land in the same second on any
    // normal machine, which is exactly the production race.
    const tokens = Array.from({ length: 25 }, () => signRefreshToken('user_1'));

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('carries a unique jti claim, which is what makes them differ', async () => {
    const { signRefreshToken } = await import('../lib/jwt.js');

    const a = jwt.verify(signRefreshToken('user_1'), REFRESH_SECRET) as jwt.JwtPayload;
    const b = jwt.verify(signRefreshToken('user_1'), REFRESH_SECRET) as jwt.JwtPayload;

    expect(a.jti).toBeTruthy();
    expect(a.jti).not.toBe(b.jti);
    // The rest of the claim set is unchanged, so nothing that reads sub/type
    // needs to know about this.
    expect(a.sub).toBe('user_1');
    expect(a.type).toBe('refresh');
  });

  it('still round-trips through verifyRefreshToken', async () => {
    // The extra claim must not break verification, which is what every
    // /auth/refresh call depends on.
    const { signRefreshToken, verifyRefreshToken } = await import('../lib/jwt.js');

    const payload = verifyRefreshToken(signRefreshToken('user_1'));

    expect(payload?.sub).toBe('user_1');
  });

  it('keeps tokens for different users distinct', async () => {
    const { signRefreshToken } = await import('../lib/jwt.js');

    expect(signRefreshToken('user_1')).not.toBe(signRefreshToken('user_2'));
  });
});
