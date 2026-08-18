import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockEnabled = jest.fn() as jest.MockedFunction<() => boolean>;
const mockRoles = jest.fn() as jest.MockedFunction<() => readonly string[]>;

jest.mock('../config/feature-flags.js', () => ({
  isConsentGateEnabled: () => mockEnabled(),
  getConsentGateRoles: () => mockRoles(),
}));
jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { consentController } from '../modules/consent/controller.js';

function run(role?: string) {
  const req = {
    auth: role ? { userId: 'u1', role } : undefined,
    requestId: 'r1',
  } as unknown as Request;
  let body: any;
  const res = {
    status: () => res,
    json: (b: any) => { body = b; return res; },
  } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  return consentController.getGateState(req, res, next).then(() => ({ body, next }));
}

const GATED = ['worker', 'checker', 'manager', 'regional_manager'];

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled.mockReturnValue(true);
  mockRoles.mockReturnValue(GATED);
});

describe('GET /consent/gate-state', () => {
  it.each(GATED)('reports enforced for %s when the flag is on', async (role) => {
    const { body } = await run(role);
    expect(body.data).toEqual({ enforced: true });
  });

  it('reports NOT enforced for admin, even with the flag on', async () => {
    // admin is exempt in the middleware too; the client must not show a gate
    // it would never actually hit.
    const { body } = await run('admin');
    expect(body.data.enforced).toBe(false);
  });

  it('reports NOT enforced when the kill switch is pulled', async () => {
    // The whole point of this endpoint: FEATURE_CONSENT_GATE=false must reach
    // the clients' own consent screens, not just the API.
    mockEnabled.mockReturnValue(false);
    const { body } = await run('worker');
    expect(body.data.enforced).toBe(false);
  });

  it('reports NOT enforced for a role outside CONSENT_GATE_ROLES', async () => {
    mockRoles.mockReturnValue(['worker']);
    const { body } = await run('manager');
    expect(body.data.enforced).toBe(false);
  });

  it('is case-insensitive on the role', async () => {
    const { body } = await run('ADMIN');
    expect(body.data.enforced).toBe(false);
  });

  it('rejects an unauthenticated caller', async () => {
    const { next } = await run(undefined);
    expect(next).toHaveBeenCalled();
  });
});
