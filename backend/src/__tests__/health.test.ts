import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  $queryRaw: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

// Mocked rather than driven through process.env: deleting S3_BUCKET to force
// the stub leaked into other suites when the full run scheduled them into the
// same worker, and turned an unrelated attendance authz test red.
const mockStorageClient = {};
let mockIsStub = false;
jest.mock('../modules/documents/storage.js', () => ({
  getStorageClient: async () => mockStorageClient,
  isStubStorage: () => mockIsStub,
}));

import { checkDatabase, checkReadiness, checkStorage } from '../lib/health.js';

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
  // Regression: workers reported that document upload AND download were both
  // broken. Both come from one place -- a stubbed or unreachable bucket
  // no-ops the upload and returns a null presigned URL -- and readiness
  // reported `ready` throughout, because it only ever checked the database.
  it('reports storage down when the client is the no-op stub', async () => {
    mockIsStub = true;
    const result = await checkStorage();
    expect(result.status).toBe('down');
    expect(result.error).toMatch(/stub/i);
  });

  it('reports storage up when a real client is configured', async () => {
    mockIsStub = false;
    expect((await checkStorage()).status).toBe('up');
  });

  // Storage is reported but must not gate the verdict: the deploy workflow
  // waits on this endpoint, and a documents-only degradation must not refuse
  // a rollout for shifts, attendance and everything else.
  it('stays ready when storage is down but the database is up', async () => {
    mockIsStub = true;
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const report = await checkReadiness();
    expect(report.checks.storage.status).toBe('down');
    expect(report.status).toBe('ready');
  });
});
