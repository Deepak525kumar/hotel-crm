import { Prisma, PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';

// ADR-029 (2026-07-23, GD-01): alias so callers depend on a repository-owned
// name rather than importing `Prisma.TransactionClient` directly at every call
// site — Prisma stays an implementation detail of this module, not something
// that leaks through every service's transaction-accepting method signature.
export type DatabaseTransaction = Prisma.TransactionClient;

let prisma: PrismaClient | null = null;

// Defaults live here, not only in env.ts's Zod schema, because getPrisma() is
// reachable before loadEnv() has run: several modules construct their service
// singleton at import time (notifications/service.ts, for one), and getEnv()
// throws when the environment has not been loaded yet. Making a Prisma client
// require loaded env would turn those imports into crashes -- which it did,
// in four test suites, when this first read getEnv() unconditionally.
export const DEFAULT_POOL_SIZE = 15;
export const DEFAULT_POOL_TIMEOUT_S = 10;

/**
 * Resolve one pool setting, preferring validated env, then raw process.env,
 * then the compiled-in default.
 *
 * The validated value from getEnv() is preferred wherever it is available so
 * the Zod bounds (positive, <= 100) actually apply. The raw process.env
 * fallback keeps an operator's override effective during the pre-loadEnv
 * window rather than silently ignoring it, and a non-numeric value there
 * falls through to the default instead of emitting `NaN` into the URL.
 */
function poolSetting(key: 'DATABASE_POOL_SIZE' | 'DATABASE_POOL_TIMEOUT_S', fallback: number): number {
  try {
    return getEnv()[key];
  } catch {
    const raw = Number(process.env[key]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }
}

/**
 * Apply the pool settings to the connection URL.
 *
 * Prisma takes `connection_limit` and `pool_timeout` ONLY as query parameters
 * on the datasource URL -- there is no constructor option for either, which
 * is why this is string surgery rather than a field on PrismaClient.
 *
 * Set here rather than in the deployed `.env` on purpose: that file is
 * untracked and hand-maintained on the host, so a value living only there is
 * invisible to review, absent in CI and on every developer machine, and lost
 * the next time the host is rebuilt. A default in code applies everywhere and
 * is still overridable per environment via DATABASE_POOL_SIZE.
 *
 * An explicit parameter already present in DATABASE_URL always wins -- an
 * operator who has deliberately pinned the pool for one environment should
 * not have it silently overwritten from here.
 */
export function withPoolSettings(rawUrl: string): string {
  // URL parsing, not string concatenation: DATABASE_URL may already carry
  // `?schema=public` or `&sslmode=require`, and guessing whether to append
  // `?` or `&` is exactly how these strings get corrupted.
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Malformed URLs are already rejected by env.ts's z.string().url(), so
    // this is unreachable in practice. Returning the input unchanged keeps
    // the failure Prisma's to report, with its own clearer message, rather
    // than turning it into an opaque throw from this helper.
    return rawUrl;
  }

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(poolSetting('DATABASE_POOL_SIZE', DEFAULT_POOL_SIZE)));
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', String(poolSetting('DATABASE_POOL_TIMEOUT_S', DEFAULT_POOL_TIMEOUT_S)));
  }

  return url.toString();
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    // Override the datasource ONLY when a URL is actually resolvable here.
    // With no argument Prisma resolves DATABASE_URL itself, from the schema's
    // env("DATABASE_URL") -- so falling back to a bare constructor preserves
    // the previous behaviour exactly whenever this runs before dotenv has
    // populated process.env, instead of handing Prisma an empty string and
    // turning a working lazy lookup into a startup failure.
    const rawUrl = process.env.DATABASE_URL;
    prisma = rawUrl
      ? new PrismaClient({ datasources: { db: { url: withPoolSettings(rawUrl) } } })
      : new PrismaClient();
  }

  return prisma;
}

/**
 * Establish and verify database connectivity before the server begins
 * accepting traffic. Unlike getPrisma(), this awaits $connect() so the
 * caller can fail fast at startup when the database is unavailable instead
 * of the server listening on a half-ready connection.
 */
export async function connectDb(): Promise<void> {
  const client = getPrisma();
  await client.$connect();
  logger.info('Connected to database');
}

export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Disconnected from database');
  }
}
