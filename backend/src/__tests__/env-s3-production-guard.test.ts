import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';

/**
 * Fail-closed startup guard: S3_BUCKET is REQUIRED when NODE_ENV is
 * production or staging.
 *
 * WHY THIS EXISTS (the silent-data-loss path it closes):
 * `documents/storage.ts` returns `stubStorageClient` when S3_BUCKET is unset.
 * The stub logs a warning and NO-OPS the upload -- while the caller's
 * transaction still writes the `WorkerDocument` row. So with a missing or
 * typo'd bucket in a deployed environment:
 *
 *   - the API returns 200
 *   - the UI shows the document as uploaded
 *   - the DB row exists
 *   - the object is NOT in the bucket, and never will be
 *
 * Every layer a human normally checks reports success. This was not
 * hypothetical: the stub path was hit accidentally during S3 verification on
 * 2026-08-12 (a probe printed `UPLOAD_RETURNED_OK` while writing nothing),
 * which is what prompted the guard.
 *
 * The stub is still correct and necessary for development/test, so the guard is
 * scoped to production/staging only -- asserted in both directions below,
 * because a guard that also fired in `test` would break the whole suite and a
 * guard that never fired would be decoration.
 */

const ORIGINAL_ENV = { ...process.env };

/**
 * `loadEnv()` calls `dotenv.config({ path: backend/.env })`, and this
 * repository's real `.env` sets S3_BUCKET. Deleting the variable from
 * `process.env` is therefore NOT enough to simulate an unset bucket -- dotenv
 * puts it straight back, and the guard (correctly) sees a value. Discovered by
 * this test failing for exactly that reason.
 *
 * So dotenv is stubbed to a no-op: these cases are about the SCHEMA's
 * cross-field rule given a set of variables, not about .env file loading (which
 * `loadEnv`'s own precedence comment already documents and other suites cover).
 */
jest.mock('dotenv', () => ({
  __esModule: true,
  default: { config: jest.fn() },
  config: jest.fn(),
}));

/**
 * `loadEnv()` memoizes into a module-level `envConfig`, so each case needs a
 * fresh module registry -- otherwise the first successful load would be
 * returned for every subsequent assertion regardless of env.
 */
async function loadEnvFresh() {
  let mod!: typeof import('../config/env.js');
  await jest.isolateModulesAsync(async () => {
    mod = await import('../config/env.js');
  });
  return mod.loadEnv();
}

describe('S3_BUCKET startup guard (fail-closed for deployed environments)', () => {
  beforeEach(() => {
    // With dotenv stubbed out, process.env must carry every REQUIRED variable
    // itself, or the schema fails on unrelated fields (JWT secrets, DATABASE_URL)
    // and the assertions below would pass for the wrong reason.
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
    };
    delete process.env['S3_BUCKET'];
    jest.resetModules();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  for (const nodeEnv of ['production', 'staging'] as const) {
    it(`refuses to boot when NODE_ENV=${nodeEnv} and S3_BUCKET is missing`, async () => {
      process.env['NODE_ENV'] = nodeEnv;
      delete process.env['S3_BUCKET'];

      await expect(loadEnvFresh()).rejects.toThrow(/S3_BUCKET must be set/);
    });

    it(`refuses to boot when NODE_ENV=${nodeEnv} and S3_BUCKET is whitespace only`, async () => {
      // A typo'd/blank value in an orchestrator's env is as dangerous as an
      // absent one -- `.optional()` alone would accept "  ".
      process.env['NODE_ENV'] = nodeEnv;
      process.env['S3_BUCKET'] = '   ';

      await expect(loadEnvFresh()).rejects.toThrow(/S3_BUCKET must be set/);
    });

    it(`boots when NODE_ENV=${nodeEnv} and S3_BUCKET is set`, async () => {
      process.env['NODE_ENV'] = nodeEnv;
      process.env['S3_BUCKET'] = 'hotelcrm-uploads';

      const env = await loadEnvFresh();
      expect(env.S3_BUCKET).toBe('hotelcrm-uploads');
    });
  }

  // The other direction: the stub is a legitimate, supported mode locally, and
  // this guard must not take it away (nor break this very test suite).
  for (const nodeEnv of ['development', 'test'] as const) {
    it(`still boots with no S3_BUCKET when NODE_ENV=${nodeEnv} (stub storage is intended here)`, async () => {
      process.env['NODE_ENV'] = nodeEnv;
      delete process.env['S3_BUCKET'];

      const env = await loadEnvFresh();
      expect(env.NODE_ENV).toBe(nodeEnv);
    });
  }
});
