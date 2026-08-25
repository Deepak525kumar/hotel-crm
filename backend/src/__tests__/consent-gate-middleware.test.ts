// Behavior suite for the consent-gate middleware.
//
// No existing backend test boots the full app (nothing imports createApp), so
// route suites mount their own bare router and never see this middleware.
// That means these tests are the entire safety net for a control that can
// lock every non-admin out of the platform. They invoke the middleware
// directly with synthetic req/res, the same shape route-role-matrix.test.ts
// uses.

import type { NextFunction, Request, Response } from 'express';

const mockCheckStatus = jest.fn();
const mockIsEnabled = jest.fn();
const mockGateRoles = jest.fn();

jest.mock('../modules/consent/service.js', () => ({
  consentService: { checkStatus: (...a: unknown[]) => mockCheckStatus(...a) },
  consentCalendarDate: (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d),
  currentNoticeVersion: () => 'v1',
}));

jest.mock('../lib/logger.js', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../config/feature-flags.js', () => ({
  isConsentGateEnabled: () => mockIsEnabled(),
  getConsentGateRoles: () => mockGateRoles(),
}));

import { clearConsentCache } from '../lib/consent-gate-cache.js';
import { consentGateMiddleware } from '../middleware/consentGate.js';

function makeReq(path: string, auth?: { userId: string; role: string }): Request {
  return { path, auth } as unknown as Request;
}

async function run(req: Request): Promise<unknown> {
  let captured: unknown = 'NOT_CALLED';
  const next: NextFunction = ((err?: unknown) => {
    captured = err;
  }) as NextFunction;
  await consentGateMiddleware(req, {} as Response, next);
  return captured;
}

const GATED_ROLES = ['worker', 'checker', 'manager', 'regional_manager'];

beforeEach(() => {
  jest.clearAllMocks();
  clearConsentCache();
  mockIsEnabled.mockReturnValue(true);
  mockGateRoles.mockReturnValue(GATED_ROLES);
  mockCheckStatus.mockResolvedValue({ status: 'absent' });
});

describe('feature flag', () => {
  it('passes through when disabled AND never queries consent state', async () => {
    mockIsEnabled.mockReturnValue(false);
    const err = await run(makeReq('/attendance', { userId: 'w1', role: 'worker' }));
    expect(err).toBeUndefined();
    // Asserting the spy, not just the outcome: a gate that queries while
    // disabled is a per-request DB read nobody asked for.
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });
});

describe('who is gated', () => {
  it.each(GATED_ROLES)('blocks %s with no consent record on /attendance', async (role) => {
    const err = await run(makeReq('/attendance', { userId: 'u1', role }));
    expect(err).toBeInstanceOf(Error);
    expect((err as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect((err as { statusCode: number }).statusCode).toBe(403);
  });

  it.each(GATED_ROLES)('blocks %s with no consent record on /quality/:id', async (role) => {
    const err = await run(makeReq('/quality/12345', { userId: 'u1', role }));
    expect(err).toBeInstanceOf(Error);
    expect((err as { code: string }).code).toBe('CONSENT_REQUIRED');
    expect((err as { statusCode: number }).statusCode).toBe(403);
  });

  it('never blocks admin, even with no consent record', async () => {
    const err = await run(makeReq('/attendance', { userId: 'a1', role: 'admin' }));
    expect(err).toBeUndefined();
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('ignores case in the role', async () => {
    const err = await run(makeReq('/attendance', { userId: 'a1', role: 'ADMIN' }));
    expect(err).toBeUndefined();
  });

  it('passes through a role outside the configured gate list', async () => {
    mockGateRoles.mockReturnValue(['worker']);
    const err = await run(makeReq('/attendance', { userId: 'm1', role: 'manager' }));
    expect(err).toBeUndefined();
  });

  it('lets 401 win when identity is unresolved', async () => {
    // optionalAuthMiddleware leaves req.auth unset on any failure; the
    // module's own authMiddleware must produce the 401 rather than this
    // middleware producing a confusing 403.
    const err = await run(makeReq('/attendance'));
    expect(err).toBeUndefined();
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });
});

describe('consent status decides', () => {
  it.each(GATED_ROLES)('allows %s once granted', async (role) => {
    mockCheckStatus.mockResolvedValue({ status: 'granted' });
    const err = await run(makeReq('/attendance', { userId: 'u1', role }));
    expect(err).toBeUndefined();
  });

  it('blocks on declined — a decline is not a pass', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'declined' });
    const err = await run(makeReq('/attendance', { userId: 'w1', role: 'worker' }));
    expect((err as { code: string }).code).toBe('CONSENT_REQUIRED');
  });

  it('queries the daily-access-gate instance specifically', async () => {
    await run(makeReq('/attendance', { userId: 'w1', role: 'worker' }));
    expect(mockCheckStatus).toHaveBeenCalledWith('w1', 'daily-access-gate');
  });
});

describe('exempt routes are reachable while gated', () => {
  it.each(['/consent/request', '/consent/decisions', '/auth/refresh', '/auth/me', '/auth/profile'])(
    '%s passes even with no consent',
    async (path) => {
      const err = await run(makeReq(path, { userId: 'w1', role: 'worker' }));
      expect(err).toBeUndefined();
    }
  );
});

describe('failure mode', () => {
  it('FAILS OPEN when the consent lookup throws — do not change this to fail closed', async () => {
    // OD-CONSENT-006's fail-closed posture is about ambiguous consent state,
    // not datastore unavailability. Failing closed here means one DB blip
    // locks every non-admin out of the whole platform simultaneously,
    // including the managers who would respond to it. No consent record is
    // written on this path, so nothing is falsely recorded as granted.
    mockCheckStatus.mockRejectedValue(new Error('db down'));
    const err = await run(makeReq('/attendance', { userId: 'w1', role: 'worker' }));
    expect(err).toBeUndefined();
  });
});
