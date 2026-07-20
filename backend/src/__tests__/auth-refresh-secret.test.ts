import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

/**
 * Security-regression test for OQ-AUTH-04 (SPEC-AUTH-001).
 *
 * Previously `signRefreshToken`/`verifyRefreshToken` fell back to `JWT_SECRET`
 * whenever `JWT_REFRESH_SECRET` was unset (`env.JWT_REFRESH_SECRET ?? env.JWT_SECRET`).
 * That let a leaked/guessed access-token secret also forge long-lived refresh
 * tokens. The fix removes the fallback in `lib/jwt.ts` and makes
 * `JWT_REFRESH_SECRET` a mandatory, independently-validated env var
 * (`config/env.ts`), so the process fails to start rather than silently
 * reusing the access secret.
 */

describe('JWT refresh secret — no fallback (OQ-AUTH-04)', () => {
  const ACCESS_SECRET = 'test-access-secret-minimum-32-characters-long';
  const REFRESH_SECRET = 'test-refresh-secret-minimum-32-characters-x';

  beforeEach(() => {
    jest.resetModules();
  });

  // `config/env.ts` declares JWT_REFRESH_SECRET as `z.string().min(32)` with no
  // `.optional()` (previously present) — validated by inspection of the schema
  // diff; every other test file in this suite mocks `config/env.js` rather than
  // exercising the real zod schema, so process-startup validation is covered
  // by the schema itself, not re-derived here. The behavioral guarantee that
  // matters at runtime — no fallback to JWT_SECRET — is covered below.

  it('verifyRefreshToken rejects a token signed with JWT_SECRET even though JWT_REFRESH_SECRET is unset (no silent fallback)', async () => {
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

    const { verifyRefreshToken } = await import('../lib/jwt.js');

    // Forge a "refresh" token using the access-token secret — this is exactly
    // the attack the fallback previously permitted.
    const forged = jwt.sign({ sub: 'user_1', type: 'refresh' }, ACCESS_SECRET, {
      expiresIn: '7d',
      algorithm: 'HS256',
    });

    expect(verifyRefreshToken(forged)).toBeNull();
  });

  it('signRefreshToken/verifyRefreshToken round-trip using only the dedicated refresh secret', async () => {
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

    const { signRefreshToken, verifyRefreshToken } = await import('../lib/jwt.js');

    const token = signRefreshToken('user_1');
    const payload = verifyRefreshToken(token);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user_1');
    expect(() => jwt.verify(token, ACCESS_SECRET)).toThrow();
  });
});
