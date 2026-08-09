import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
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

// document-templates review follow-up (2026-08-10, PR #398): the Chromium
// binary Playwright needs for PDF rendering is a separate download from the
// `playwright` npm package (`npx playwright install --with-deps chromium`,
// ~300MB) -- an environment that ran `npm ci` but skipped that step looks
// completely healthy (starts, serves every other route) until the first
// /document-instances/:id/preview or /finalize call, which fails with no
// warning anywhere before that point. `chromium` is deliberately NOT part of
// the `status: 'ready'` verdict below (see checkReadiness's own comment) --
// unlike the database, a missing browser degrades one feature, not the
// whole app, and failing readiness entirely over it would take down every
// OTHER route too. It is still surfaced in the same `checks` object so
// `curl /health/ready` (deploy.sh's own post-deploy verification step, and
// the ops runbook target for "how do I check this after deploying") shows it
// plainly rather than requiring a real render attempt to find out.
export interface OptionalDependencyHealth {
  status: 'available' | 'unavailable';
  detail?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: {
    database: DependencyHealth;
    chromium: OptionalDependencyHealth;
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
 * Checks whether the Chromium binary Playwright's document-templates PDF
 * renderer needs is actually installed, without launching a browser
 * (`chromium.executablePath()` resolves the expected install path
 * deterministically; this only stats that path). A separate `require` of
 * `playwright` here (rather than importing the renderer module) keeps this
 * probe importable even if the renderer module itself ever grows a
 * heavier import graph.
 */
export function checkChromium(): OptionalDependencyHealth {
  try {
    const path = chromium.executablePath();
    if (existsSync(path)) {
      return { status: 'available' };
    }
    return {
      status: 'unavailable',
      detail: `Chromium executable not found at ${path} -- run "npx playwright install --with-deps chromium". Document-templates PDF preview/finalize will fail until this is installed.`,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Aggregate dependency probes into an overall readiness verdict. The service
 * is ready only when every CRITICAL dependency is up -- chromium is
 * reported but deliberately excluded from that verdict (see its own
 * OptionalDependencyHealth comment above).
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const database = await checkDatabase();
  const chromium = checkChromium();
  const status = database.status === 'up' ? 'ready' : 'not_ready';
  return { status, checks: { database, chromium } };
}
