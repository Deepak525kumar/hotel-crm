import { getPrisma } from './db.js';
import { getStorageClient, isStubStorage } from '../modules/documents/storage.js';

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
    /**
     * Object storage for worker documents. Added after a production report of
     * "upload and download are both broken": a stubbed or unreachable bucket
     * makes uploads no-op and presigned URLs null, which every client renders
     * as a missing View link. The probe reported `ready` throughout, because
     * it only ever checked the database.
     */
    storage: DependencyHealth;
    /**
     * Push delivery. Reported for the same reason as storage: with no APNs or
     * FCM credentials the transport falls back to a logging no-op, so every
     * broadcast, shift confirmation and rework alert is recorded as sent and
     * reaches nobody.
     */
    push: DependencyHealth;
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
 * Verify that object storage is real and reachable.
 *
 * Reports `down` for a stub client as well as an unreachable bucket: in a
 * deployed environment the stub silently accepts uploads and stores nothing,
 * which is worse than an outage because nothing surfaces it. `config/env.ts`
 * refuses to boot production/staging without S3_BUCKET, so a stub here means
 * either a non-deployed NODE_ENV or that guard having been bypassed -- both
 * worth showing rather than hiding.
 *
 * Never throws, matching checkDatabase.
 */
export async function checkStorage(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const client = await getStorageClient();
    if (isStubStorage(client)) {
      return {
        status: 'down',
        latency_ms: Date.now() - start,
        error: 'storage is stubbed (S3_BUCKET unset): uploads are no-ops and presigned URLs are null',
      };
    }
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
 * Whether push credentials are present. Configuration only -- delivering a
 * probe push on every health check would be both costly and user-visible.
 */
export function checkPush(): DependencyHealth {
  const apns = Boolean(
    process.env['APNS_PRIVATE_KEY_BASE64'] &&
      process.env['APNS_KEY_ID'] &&
      process.env['APNS_TEAM_ID'] &&
      (process.env['APNS_BUNDLE_ID_WORKER'] || process.env['APNS_BUNDLE_ID_CHECKER']),
  );
  const fcm = Boolean(
    process.env['FIREBASE_SERVICE_ACCOUNT_KEY_BASE64'] && process.env['FIREBASE_PROJECT_ID'],
  );
  if (apns || fcm) return { status: 'up' };
  return {
    status: 'down',
    error: 'push transport not configured (no APNs and no FCM credentials): notifications are silently dropped',
  };
}

/**
 * Aggregate dependency probes into an overall readiness verdict. The service
 * is ready only when every CRITICAL dependency is up.
 *
 * Storage is reported but deliberately NOT counted toward the verdict: the
 * deploy workflow gates on this endpoint, and failing it would turn a
 * documents-only degradation into a refused rollout for shifts, attendance and
 * everything else. It is here to be seen, not to block.
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
  const status = database.status === 'up' ? 'ready' : 'not_ready';
  return { status, checks: { database, storage, push: checkPush() } };
}
