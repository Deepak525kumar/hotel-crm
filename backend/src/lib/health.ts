import { getPrisma } from './db.js';

/**
 * Health/readiness probes for the observability baseline (EPIC-PLATFORM, S0-3).
 *
 * Liveness (is the process up) is answered by the existing shallow `/health`
 * endpoints. Readiness additionally verifies that critical dependencies — today
 * the database — are reachable, so an orchestrator can withhold traffic from a
 * process that is running but cannot serve requests.
 */

export interface DependencyHealth {
  status: 'up' | 'down';
  latency_ms?: number;
  error?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: {
    database: DependencyHealth;
  };
}

/**
 * Verify database connectivity with a cheap round-trip. Never throws: a failed
 * probe is reported as a `down` dependency so the readiness endpoint can return
 * a 503 instead of surfacing an unhandled error.
 */
export async function checkDatabase(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { status: 'up', latency_ms: Date.now() - start };
  } catch (error) {
    return {
      status: 'down',
      latency_ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Aggregate dependency probes into an overall readiness verdict. The service is
 * ready only when every critical dependency is up.
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const database = await checkDatabase();
  const status = database.status === 'up' ? 'ready' : 'not_ready';
  return { status, checks: { database } };
}
