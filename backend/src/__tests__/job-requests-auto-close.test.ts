import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * 6h auto-close scheduled job for Epic 9 PR 9.10 (TREQ-006/TRULE-005,
 * MIG-GAP-09).
 *
 * JobRequestAutoCloseJob is a thin Scheduler-facing wrapper (mirrors
 * SessionSweepJob's shape: name/intervalMs/run()) that delegates the actual
 * close-and-notify transaction logic to
 * JobRequestService.closeExpiredBroadcasts() (job-requests/service.ts),
 * rather than duplicating it — this test file mocks that service method
 * directly, mirroring SessionSweepJob's own test shape at the job-wrapper
 * level.
 *
 * Out of this PR's scope: any change to raise/eligibility/notification/
 * arbitration logic from PRs 9.7-9.9.
 */

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

const mockCloseExpiredBroadcasts = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
jest.mock('../modules/job-requests/service.js', () => ({
  jobRequestService: { closeExpiredBroadcasts: mockCloseExpiredBroadcasts },
}));

import { JobRequestAutoCloseJob } from '../modules/job-requests/auto-close-job.js';

const CONFIG = { intervalMs: 900000, autoCloseAfterMs: 21600000, batchSize: 100 };

describe('JobRequestAutoCloseJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers under the expected job name and interval', () => {
    const job = new JobRequestAutoCloseJob(CONFIG);
    expect(job.name).toBe('job-request-auto-close');
    expect(job.intervalMs).toBe(900000);
  });

  it('delegates to closeExpiredBroadcasts() with a cutoff derived from autoCloseAfterMs', async () => {
    mockCloseExpiredBroadcasts.mockResolvedValue(2);
    const before = Date.now();

    const job = new JobRequestAutoCloseJob(CONFIG);
    await job.run();

    const [cutoff, batchSize] = mockCloseExpiredBroadcasts.mock.calls[0];
    expect(batchSize).toBe(100);
    // cutoff should be ~6h (21600000ms) before "now" at call time.
    const expectedCutoffMs = before - CONFIG.autoCloseAfterMs;
    expect(cutoff).toBeInstanceOf(Date);
    expect(Math.abs(cutoff.getTime() - expectedCutoffMs)).toBeLessThan(5000);
  });

  it('logs the number of job requests closed', async () => {
    mockCloseExpiredBroadcasts.mockResolvedValue(3);

    const job = new JobRequestAutoCloseJob(CONFIG);
    await job.run();

    expect(mockLogger.info).toHaveBeenCalledWith('Job request auto-close completed', {
      job_requests_closed: 3,
    });
  });

  it('logs zero when nothing is due (no-op run)', async () => {
    mockCloseExpiredBroadcasts.mockResolvedValue(0);

    const job = new JobRequestAutoCloseJob(CONFIG);
    await job.run();

    expect(mockLogger.info).toHaveBeenCalledWith('Job request auto-close completed', {
      job_requests_closed: 0,
    });
  });
});
