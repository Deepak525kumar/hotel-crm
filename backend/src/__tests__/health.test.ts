import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  $queryRaw: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

// Config is mocked, never process.env: an earlier version of this file deleted
// S3_BUCKET and restored it, which leaked into other suites when the full run
// scheduled them into the same worker and turned an unrelated attendance authz
// test red.
let mockEnv: Record<string, string | undefined> = {};
jest.mock('../config/env.js', () => ({ getEnv: () => mockEnv }));

import { checkDatabase, checkReadiness, checkStorage, checkPush } from '../lib/health.js';

describe('Health / readiness probes (S0-3 observability baseline)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports the database up when the probe succeeds', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const result = await checkDatabase();

    expect(result.status).toBe('up');
    expect(typeof result.latency_ms).toBe('number');
    expect(result.error).toBeUndefined();
  });

  it('reports the database down (without throwing) when the probe fails', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const result = await checkDatabase();

    expect(result.status).toBe('down');
    expect(result.error).toBe('connection refused');
  });

  it('aggregates to ready when every dependency is up', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const report = await checkReadiness();

    expect(report.status).toBe('ready');
    expect(report.checks.database.status).toBe('up');
  });

  it('aggregates to not_ready when a dependency is down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('down'));

    const report = await checkReadiness();

    expect(report.status).toBe('not_ready');
    expect(report.checks.database.status).toBe('down');
  });
});

describe('storage readiness', () => {
  beforeEach(() => {
    mockEnv = {};
  });

  // Regression: workers reported that document upload AND download were both
  // broken. Both come from one place -- a stubbed bucket no-ops the upload and
  // returns a null presigned URL -- and readiness reported `ready` throughout,
  // because it only ever checked the database.
  it('reports storage down when no bucket is configured', () => {
    expect(checkStorage()).toMatchObject({ status: 'down' });
    expect(checkStorage().error).toMatch(/stub/i);
  });

  it('reports storage up when a bucket is configured', () => {
    mockEnv = { S3_BUCKET: 'hotelcrm-uploads' };
    expect(checkStorage().status).toBe('up');
  });

  // A whitespace-only value is a misconfiguration, not a bucket -- storage.ts
  // would still take the stub branch on it.
  it('treats a blank bucket name as unconfigured', () => {
    mockEnv = { S3_BUCKET: '   ' };
    expect(checkStorage().status).toBe('down');
  });

  // Storage is reported but must not gate the verdict: the deploy workflow
  // waits on this endpoint, and a documents-only degradation must not refuse a
  // rollout for shifts, attendance and everything else.
  it('stays ready when storage is down but the database is up', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const report = await checkReadiness();
    expect(report.checks.storage.status).toBe('down');
    expect(report.status).toBe('ready');
  });
});

describe('push readiness', () => {
  beforeEach(() => {
    mockEnv = {};
  });

  it('reports push down with no credentials at all', () => {
    expect(checkPush()).toMatchObject({ status: 'down' });
  });

  it('reports push up on FCM alone', () => {
    mockEnv = { FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: 'k', FIREBASE_PROJECT_ID: 'p' };
    expect(checkPush().status).toBe('up');
  });

  // Mirrors selectPushHandler: the APNs key trio without a bundle id skips
  // every iOS device, so it must not count as configured.
  it('does not count APNs without a bundle id', () => {
    mockEnv = { APNS_PRIVATE_KEY_BASE64: 'k', APNS_KEY_ID: 'i', APNS_TEAM_ID: 't' };
    expect(checkPush().status).toBe('down');
    mockEnv = { ...mockEnv, APNS_BUNDLE_ID_CHECKER: 'com.x.checker' };
    expect(checkPush().status).toBe('up');
  });

  it('does not count a Firebase project id without the service account key', () => {
    mockEnv = { FIREBASE_PROJECT_ID: 'p' };
    expect(checkPush().status).toBe('down');
  });
});
