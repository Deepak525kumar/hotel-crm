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

// Mocked `true` for the same reason route-role-matrix.test.ts does: this suite
// validates the RATIFIED target matrix (ADR-030 §3), i.e. the state once
// FEATURE_GD02_MATRIX is enabled. `support/route-registry.ts` resolves flagged
// gates to their second (target-state) argument to match.
jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => true,
}));

import { requireRole, requirePermission } from '../middleware/permissions.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { buildRouteRegistry, routeKey } from './support/route-registry.js';
import {
  CAPABILITY_MATRIX,
  MATRIX_ROLES,
  expectedTokensFor,
  matrixGrantsToken,
  tokenBackedCapabilities,
  type MatrixRole,
} from './support/capability-matrix.js';
import { CAPABILITY_VIOLATIONS, CAPABILITY_VIOLATION_KEYS } from './support/capability-violations.js';

/**
 * POLICY-DRIVEN authorization tests (Regional Manager roadmap PR1).
 *
 * The pre-existing `route-role-matrix.test.ts` derives its expected outcome
 * from the same `requireRole(...)` literals it exercises, so both sides of its
 * assertion move together and it cannot detect a gate that contradicts the
 * ratified capability matrix. That suite is retained — it is a genuine
 * middleware-behaviour test and its `expectedOutcome()` correctly pins that
 * `requireRole`/`requirePermission` do what their arguments say. What it does
 * NOT do is check those arguments against the specification.
 *
 * This suite supplies the missing half: `support/capability-matrix.ts` is a
 * hand-maintained transcription of ADR-030 §3, owing nothing to the source it
 * checks. Where source and ADR disagree today, the disagreement is pinned in
 * `support/capability-violations.ts` and asserted to match EXACTLY — so fixing
 * a violation fails the build just as loudly as introducing one, until that
 * file is deliberately edited with a citation.
 *
 * Scope: role + permission-token decisions only, the seam `requireRole` and
 * `requirePermission` occupy. Scope narrowing (`checkHotelAccess`,
 * `checkWorkerScope`, `resolveScopeGroupFilter`) is asserted by `rbac.test.ts`
 * and the `*-scope-authz.test.ts` suites; see capability-matrix.ts's header.
 */

/** ROLE_PERMISSIONS key for a lowercase JWT-claim role string. */
const ROLE_PERMISSIONS_KEY: Record<MatrixRole, string> = {
  admin: 'ADMIN',
  regional_manager: 'REGIONAL_MANAGER',
  manager: 'MANAGER',
  checker: 'CHECKER',
  worker: 'WORKER',
};

function permissionsFor(role: MatrixRole): string[] {
  return ROLE_PERMISSIONS[ROLE_PERMISSIONS_KEY[role]] ?? [];
}

/** Mirrors requirePermission()'s own wildcard semantics (middleware/permissions.ts). */
function holdsToken(role: MatrixRole, token: string): boolean {
  const held = permissionsFor(role);
  if (held.includes('admin:*')) return true;
  if (held.includes(token)) return true;
  const [resource] = token.split(':');
  return held.some((h) => h.endsWith(':*') && h.split(':')[0] === resource);
}

function makeReq(role: MatrixRole): Request {
  return {
    auth: { userId: 'u-test', role, permissions: permissionsFor(role) },
    params: {},
    query: {},
    body: {},
    requestId: 'req_test',
  } as unknown as Request;
}

function runMiddleware(
  mw: (req: Request, res: Response, next: NextFunction) => void,
  req: Request
): unknown {
  let calledWith: unknown = 'NOT_CALLED';
  const next = ((err?: unknown) => {
    calledWith = err;
  }) as NextFunction;
  mw(req, {} as Response, next);
  return calledWith;
}

function isDenied(result: unknown): boolean {
  return (
    result !== undefined &&
    result !== 'NOT_CALLED' &&
    typeof result === 'object' &&
    result !== null &&
    ((result as { name?: string }).name === 'ForbiddenError' ||
      (result as { name?: string }).name === 'UnauthorizedError')
  );
}

/**
 * Capability -> the route(s) that implement it, by the exact key
 * `support/route-registry.ts` emits (`<module>:<METHOD> <path>`).
 *
 * Only capabilities with a live HTTP surface are mapped. A capability with no
 * route (C-04 `hotels:operate`, C-16 employee operational transitions, C-32
 * report export) is asserted at the token level only — a missing route is not
 * a gate violation, and inventing one here would fabricate a requirement.
 * Routes are asserted to exist, so a rename fails loudly rather than silently
 * skipping the capability.
 */
const CAPABILITY_ROUTES: Record<string, string[]> = {
  'C-01': ['crm:POST /hotels'],
  'C-02': ['crm:PATCH /hotels/:hotel_id'],
  'C-03': ['crm:DELETE /hotels/:hotel_id'],
  // Two surfaces: the permission-only detail read (which every role holding
  // `hotels:read` reaches, scope-narrowed by checkHotelAccess) and the
  // role-gated list.
  'C-05': ['crm:GET /hotels/:hotel_id', 'crm:GET /hotels'],
  'C-06': ['crm:POST /hotel-groups', 'crm:DELETE /hotel-groups/:hotel_group_id'],
  'C-07': ['crm:PATCH /hotel-groups/:hotel_group_id'],
  'C-08': ['crm:GET /hotel-groups', 'crm:GET /hotel-groups/:hotel_group_id'],
  'C-10': ['users:POST /'],
  'C-11': ['users:PUT /:user_id'],
  'C-12': ['users:PUT /:user_id/role'],
  'C-13': ['users:DELETE /:user_id'],
  'C-15': ['employee-management:POST /', 'employee-management:POST /bulk-import'],
  // C-16 "Employee operational transitions" -- superseded 2026-08-06 (PR #354,
  // ADR-030 §3 note ³): now has a live route surface (was previously
  // token-only, see the comment above CAPABILITY_ROUTES). C-18 "Deactivate
  // employee" is merged into this row; its former route moves here rather
  // than staying under a retired id.
  'C-16': [
    'employee-management:POST /:employee_id/submit-for-review',
    'employee-management:POST /:employee_id/approve',
    'employee-management:POST /:employee_id/reject',
    'employee-management:POST /:employee_id/deactivate',
    'employee-management:POST /:employee_id/reactivate',
    'employee-management:POST /:employee_id/rehire',
  ],
  'C-20': ['employee-management:GET /:employee_id/special-category/:field'],
  'C-21': ['employee-management:GET /:employee_id/export'],
  'C-22': ['employee-management:POST /hotels/:hotel_id/blocklist'],
  'C-23': ['job-requests:POST /', 'job-requests:PATCH /:id'],
  'C-24': ['assignments:POST /:id/rooms-completed'],
  'C-25': ['calendar:GET /hotels/:hotel_id/operations', 'calendar:POST /hotels/:hotel_id/operations'],
  'C-27': ['quality:POST /verifications', 'quality:POST /ratings'],
  'C-28': ['quality:GET /leaderboard'],
  'C-29': ['hr:POST /contracts', 'hr:POST /payroll'],
  'C-30': ['hr:GET /contracts'],
  'C-31': ['analytics:GET /stats', 'analytics:GET /leaderboard'],
};

const registry = buildRouteRegistry();
const byKey = new Map(registry.map((r) => [routeKey(r), r]));

describe('ADR-030 §3 capability matrix — policy-driven authorization', () => {
  it('the transcribed matrix covers C-01..C-34 with no gaps or duplicates', () => {
    const ids = CAPABILITY_MATRIX.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(34);
    for (let n = 1; n <= 34; n++) {
      expect(ids).toContain(`C-${String(n).padStart(2, '0')}`);
    }
  });

  it('every mapped route key resolves to a real parsed route', () => {
    const missing: string[] = [];
    for (const [capId, keys] of Object.entries(CAPABILITY_ROUTES)) {
      for (const key of keys) {
        if (!byKey.has(key)) missing.push(`${capId} -> ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Token grants: does each role hold exactly the tokens ADR-030 §3 says?
  // -------------------------------------------------------------------
  describe('ROLE_PERMISSIONS grants match the ratified matrix', () => {
    // Asserted per DISTINCT TOKEN, not per capability: a token shared by
    // capabilities with different role sets cannot be attributed to one of
    // them. See capability-matrix.ts's `matrixGrantsToken` for why.
    const distinctTokens = [...new Set(tokenBackedCapabilities().map((c) => c.token))].sort();

    describe.each(MATRIX_ROLES)('role=%s', (role) => {
      it.each(distinctTokens)('%s', (token) => {
        const expected = matrixGrantsToken(role, token);
        const actual = holdsToken(role, token);
        const pinned = CAPABILITY_VIOLATIONS.get(`${token}:${role}`);

        if (pinned) {
          // Pinned violation: assert it STILL diverges. When the fix lands,
          // this fails and the pin must be deleted in the same PR.
          expect(actual).not.toBe(expected);
          return;
        }

        expect(actual).toBe(expected);
      });
    });

    it.each(MATRIX_ROLES)('%s holds no token the matrix does not grant it', (role) => {
      const allowed = expectedTokensFor(role);
      const held = permissionsFor(role);
      // Tokens outside the matrix's vocabulary entirely (e.g. the ADR-042
      // self-scoped worker tokens `hr:contract:read-own`, `hr:payslip:request`,
      // `hr:payslip:read-own`, and ADMIN's `admin:*`/`audit:read`) are not
      // matrix rows and are not in scope for this assertion — it checks only
      // that no role holds a MATRIX-VOCABULARY token the matrix denies it.
      const vocabulary = new Set(tokenBackedCapabilities().map((c) => c.token));
      const overreach = held.filter((t) => vocabulary.has(t) && !allowed.has(t));
      expect(overreach).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Route gates: does each capability's route admit exactly the ratified
  // roles, judged against the SPEC rather than the route's own literals?
  // -------------------------------------------------------------------
  describe('route gates match the ratified matrix', () => {
    const mapped = CAPABILITY_MATRIX.filter((c) => CAPABILITY_ROUTES[c.id] !== undefined);

    describe.each(mapped.map((c) => [c.id, c] as const))('%s', (_id, cap) => {
      for (const key of CAPABILITY_ROUTES[cap.id]!) {
        describe(key, () => {
          it.each(MATRIX_ROLES)('role=%s', (role) => {
            const route = byKey.get(key);
            if (!route) throw new Error(`route ${key} not found (see the route-key sanity test)`);

            let denied = false;
            if (route.requiredRoles !== null) {
              if (isDenied(runMiddleware(requireRole(route.requiredRoles), makeReq(role)))) {
                denied = true;
              }
            }
            if (!denied && route.requiredPermissions !== null) {
              if (isDenied(runMiddleware(requirePermission(route.requiredPermissions), makeReq(role)))) {
                denied = true;
              }
            }

            const actual: 'allow' | 'deny' = denied ? 'deny' : 'allow';
            const expected = cap.outcome[role];
            const pinned =
              CAPABILITY_VIOLATIONS.get(`${cap.id}:${role}@${key}`) ??
              CAPABILITY_VIOLATIONS.get(`${cap.id}:${role}`);

            if (pinned) {
              expect(actual).not.toBe(expected);
              return;
            }

            expect(actual).toBe(expected);
          });
        });
      }
    });
  });

  // -------------------------------------------------------------------
  // The pin itself is pinned: no silent additions, no silent fixes.
  // -------------------------------------------------------------------
  /**
   * Recomputes every divergence between source and the ratified matrix, using
   * the same two seams the assertions above use: distinct-token grants
   * (keyed `<token>:<role>`) and mapped route gates (keyed
   * `<C-id>:<role>@<routeKey>`).
   */
  function findAllDivergences(): string[] {
    const found: string[] = [];

    const distinctTokens = [...new Set(tokenBackedCapabilities().map((c) => c.token))];
    for (const token of distinctTokens) {
      for (const role of MATRIX_ROLES) {
        if (holdsToken(role, token) !== matrixGrantsToken(role, token)) {
          found.push(`${token}:${role}`);
        }
      }
    }

    for (const cap of CAPABILITY_MATRIX) {
      for (const key of CAPABILITY_ROUTES[cap.id] ?? []) {
        const route = byKey.get(key);
        if (!route) continue;
        for (const role of MATRIX_ROLES) {
          let denied = false;
          if (route.requiredRoles !== null) {
            if (isDenied(runMiddleware(requireRole(route.requiredRoles), makeReq(role)))) denied = true;
          }
          if (!denied && route.requiredPermissions !== null) {
            if (isDenied(runMiddleware(requirePermission(route.requiredPermissions), makeReq(role)))) {
              denied = true;
            }
          }
          const actual: 'allow' | 'deny' = denied ? 'deny' : 'allow';
          if (actual !== cap.outcome[role]) {
            // A token-level pin already explains this route-level symptom
            // (the role cannot pass a gate whose token it does not hold).
            if (cap.token !== null && CAPABILITY_VIOLATION_KEYS.has(`${cap.token}:${role}`)) continue;
            found.push(`${cap.id}:${role}@${key}`);
          }
        }
      }
    }

    return found;
  }

  it('every pinned violation is still a real violation (no stale pins)', () => {
    const live = new Set(findAllDivergences());
    const stale: string[] = [];

    for (const [key, v] of CAPABILITY_VIOLATIONS) {
      if (!live.has(key)) {
        stale.push(`${key} no longer diverges from ${v.authority} — delete this pin (owner: ${v.owner})`);
      }
    }

    expect(stale).toEqual([]);
  });

  it('the pinned-violation set is exactly the set of divergences found', () => {
    expect(new Set(findAllDivergences())).toEqual(new Set(CAPABILITY_VIOLATION_KEYS));
  });
});
