import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPrisma = {
  $queryRaw: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

// document-templates review follow-up (2026-08-10, PR #398): checkChromium()
// resolves the real Playwright-installed browser path via
// chromium.executablePath() -- mocked here so this suite is deterministic
// regardless of whether the machine running it actually has Chromium
// installed (a dev laptop almost certainly does; a bare CI/EC2 image may not).
const mockExecutablePath = jest.fn() as jest.MockedFunction<() => string>;
jest.mock('playwright', () => ({
  chromium: { executablePath: mockExecutablePath },
}));

const mockExistsSync = jest.fn() as jest.MockedFunction<(path: string) => boolean>;
jest.mock('node:fs', () => ({ existsSync: mockExistsSync }));

import { checkChromium, checkDatabase, checkReadiness } from '../lib/health.js';

describe('Health / readiness probes (S0-3 observability baseline)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecutablePath.mockReturnValue('/fake/path/to/chromium');
    mockExistsSync.mockReturnValue(true);
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

  describe('checkChromium (document-templates PDF rendering, PR #398 follow-up)', () => {
    it('reports available when the resolved executable path exists on disk', () => {
      mockExecutablePath.mockReturnValue('/opt/chromium/chrome');
      mockExistsSync.mockReturnValue(true);

      const result = checkChromium();

      expect(result.status).toBe('available');
      expect(mockExistsSync).toHaveBeenCalledWith('/opt/chromium/chrome');
    });

    it('reports unavailable with an actionable detail when the path does not exist', () => {
      mockExecutablePath.mockReturnValue('/opt/chromium/chrome');
      mockExistsSync.mockReturnValue(false);

      const result = checkChromium();

      expect(result.status).toBe('unavailable');
      expect(result.detail).toContain('/opt/chromium/chrome');
      expect(result.detail).toContain('playwright install');
    });

    it('reports unavailable (never throws) if resolving the executable path itself errors', () => {
      mockExecutablePath.mockImplementation(() => {
        throw new Error('playwright not installed');
      });

      const result = checkChromium();

      expect(result.status).toBe('unavailable');
      expect(result.detail).toBe('playwright not installed');
    });

    it('does NOT flip overall readiness to not_ready when chromium is unavailable but the database is up', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockExistsSync.mockReturnValue(false);

      const report = await checkReadiness();

      expect(report.status).toBe('ready');
      expect(report.checks.chromium.status).toBe('unavailable');
    });

    it('surfaces chromium: available in the readiness report when everything is up', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockExistsSync.mockReturnValue(true);

      const report = await checkReadiness();

      expect(report.checks.chromium.status).toBe('available');
    });
  });
});
