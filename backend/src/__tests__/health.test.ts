import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  $queryRaw: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

import { checkDatabase, checkReadiness } from '../lib/health.js';

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
