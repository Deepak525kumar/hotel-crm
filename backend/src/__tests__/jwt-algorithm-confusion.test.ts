import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

/**
 * Security-regression test (security review, 2026-08-08).
 *
 * `verifyAccessToken`/`verifyRefreshToken` previously called `jwt.verify(token,
 * secret)` with no `algorithms` option, trusting whatever algorithm the
 * token's own (attacker-controlled) header claimed instead of the HS256
 * these tokens are always signed with. The HS384 case below is the proof:
 * mutation-verified to pass under the old code (accepting the forgery) and
 * fail under the fix. The `alg: none` cases are kept as a regression guard,
 * not as evidence of the original bug -- the installed jsonwebtoken version
 * already rejects `none` by default when a secret is supplied, independent
 * of the `algorithms` option, so those cases passed even before this fix.
 */

const ACCESS_SECRET = 'test-access-secret-minimum-32-characters-long';
const REFRESH_SECRET = 'test-refresh-secret-minimum-32-characters-x';

describe('JWT verification — algorithm allow-list (algorithm-confusion regression)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function loadJwtLib() {
    jest.doMock('../config/env.js', () => ({
      getEnv: () => ({
        JWT_SECRET: ACCESS_SECRET,
        JWT_REFRESH_SECRET: REFRESH_SECRET,
        JWT_ACCESS_EXPIRY: '1h',
        JWT_REFRESH_EXPIRY: '7d',
        NODE_ENV: 'test',
      }),
      loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    }));
    return import('../lib/jwt.js');
  }

  it('verifyAccessToken rejects an unsigned "alg: none" token, even with a valid-looking payload (regression guard, not proof of the original bug -- see file header)', async () => {
    const { verifyAccessToken } = await loadJwtLib();

    const forged = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: 'user_1',
          email: 'attacker@example.com',
          role: 'admin',
          scope: { type: 'global' },
          token_generation: 0,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url'),
      '',
    ].join('.');

    expect(verifyAccessToken(forged)).toBeNull();
  });

  it('verifyRefreshToken rejects an unsigned "alg: none" token', async () => {
    const { verifyRefreshToken } = await loadJwtLib();

    const forged = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: 'user_1',
          type: 'refresh',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url'),
      '',
    ].join('.');

    expect(verifyRefreshToken(forged)).toBeNull();
  });

  it('verifyAccessToken rejects a token signed with an algorithm other than HS256 (the actual regression -- mutation-verified against the old code)', async () => {
    const { verifyAccessToken } = await loadJwtLib();

    const forged = jwt.sign(
      {
        sub: 'user_1',
        email: 'attacker@example.com',
        role: 'admin',
        scope: { type: 'global' },
        token_generation: 0,
      },
      ACCESS_SECRET,
      { algorithm: 'HS384', expiresIn: '1h' }
    );

    expect(verifyAccessToken(forged)).toBeNull();
  });

  it('verifyAccessToken still accepts a genuine HS256-signed token (no regression)', async () => {
    const { signAccessToken, verifyAccessToken } = await loadJwtLib();

    const token = signAccessToken({
      sub: 'user_1',
      email: 'user@example.com',
      role: 'worker',
      scope: null,
      token_generation: 0,
    });

    const payload = verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user_1');
  });
});
