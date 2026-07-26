import { describe, it, expect, jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

// Unlike most other test files (which mock this `false` to pin
// pre-ADR-030-rollout behaviour), this suite validates the RATIFIED target
// matrix (ADR-030 §3) — the state once FEATURE_GD02_MATRIX is enabled — so
// it is mocked `true` here.
jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => true,
}));

import { requireRole, requirePermission } from '../middleware/permissions.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { buildRouteRegistry, routeKey } from './support/route-registry.js';

// ADR-030 §6 PR-7: the generated route x role integration matrix. Derived
// entirely from the real route source files (route-registry.ts) and
// exercised against the REAL requireRole/requirePermission middleware units
// — the same style rbac.test.ts already uses, just parameterized across
// every registered route instead of a hand-picked subset. This is
// deliberately NOT a supertest/HTTP integration: no DB, no app bootstrap,
// no network — it calls the middleware functions directly with a
// synthetic `req.auth`, exactly mirroring rbac.test.ts's `makeReq` pattern.
//
// Scope note: routes that also carry checkHotelAccess()/checkWorkerScope()
// (scope gates) are out of scope here — those are covered by rbac.test.ts's
// scope-specific suites and the *-scope-authz.test.ts files. This suite only
// asserts the role+permission gate outcome, never scope.

const ROLES = ['admin', 'regional_manager', 'manager', 'checker', 'worker'] as const;
type Role = (typeof ROLES)[number];

// Role (JWT claim string, lowercase — see modules/auth/service.ts's
// `role.toLowerCase()`) -> ROLE_PERMISSIONS key (backend/src/config/constants.ts).
const ROLE_PERMISSIONS_KEY: Record<Role, string> = {
  admin: 'ADMIN',
  regional_manager: 'REGIONAL_MANAGER',
  manager: 'MANAGER',
  checker: 'CHECKER',
  worker: 'WORKER',
};

function permissionsFor(role: Role): string[] {
  return ROLE_PERMISSIONS[ROLE_PERMISSIONS_KEY[role]] ?? [];
}

function makeReq(role: Role): Request {
  return {
    auth: {
      userId: 'u-test',
      role,
      permissions: permissionsFor(role),
    },
    params: {},
    query: {},
    body: {},
    requestId: 'req_test',
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

/** Runs a middleware and resolves with whatever `next()` was called with (undefined = allowed). */
function runMiddleware(
  mw: (req: Request, res: Response, next: NextFunction) => void,
  req: Request
): unknown {
  let calledWith: unknown = 'NOT_CALLED';
  const next = ((err?: unknown) => {
    calledWith = err;
  }) as NextFunction;
  mw(req, makeRes(), next);
  return calledWith;
}

function isDeniedError(result: unknown): boolean {
  return (
    result !== undefined &&
    result !== 'NOT_CALLED' &&
    typeof result === 'object' &&
    result !== null &&
    ((result as { name?: string }).name === 'ForbiddenError' ||
      (result as { name?: string }).name === 'UnauthorizedError')
  );
}

/** Computes the expected allow/deny outcome for a role against a parsed route's gates. */
function expectedOutcome(role: Role, requiredRoles: string[] | null, requiredPermissions: string[] | null): 'allow' | 'deny' {
  if (requiredRoles !== null && !requiredRoles.includes(role)) {
    return 'deny';
  }

  if (requiredPermissions !== null) {
    const held = permissionsFor(role);
    const hasAdminWildcard = held.includes('admin:*');
    const hasAll = requiredPermissions.every((perm) => {
      if (held.includes(perm)) return true;
      const [resource] = perm.split(':');
      return held.some((h) => h.endsWith(':*') && h.split(':')[0] === resource);
    });
    if (!hasAdminWildcard && !hasAll) return 'deny';
  }

  return 'allow';
}

describe('ADR-030 §6 PR-7: generated route x role integration matrix', () => {
  const routes = buildRouteRegistry();

  it('parsed at least one route per module under test (sanity check)', () => {
    const modules = new Set(routes.map((r) => r.module));
    expect(modules.size).toBeGreaterThan(0);
    expect(routes.length).toBeGreaterThan(0);
  });

  describe.each(routes.map((r) => [routeKey(r), r] as const))('%s', (_key, route) => {
    it.each(ROLES)('role=%s', (role) => {
      const expected = expectedOutcome(role, route.requiredRoles, route.requiredPermissions);

      let sawDeny = false;

      if (route.requiredRoles !== null) {
        const req = makeReq(role);
        const result = runMiddleware(requireRole(route.requiredRoles), req);
        if (isDeniedError(result)) sawDeny = true;
      }

      if (!sawDeny && route.requiredPermissions !== null) {
        const req = makeReq(role);
        const result = runMiddleware(requirePermission(route.requiredPermissions), req);
        if (isDeniedError(result)) sawDeny = true;
      }

      const actual = sawDeny ? 'deny' : 'allow';
      expect(actual).toBe(expected);
    });
  });
});
