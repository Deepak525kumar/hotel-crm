import { describe, it, expect } from '@jest/globals';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { buildRouteRegistry, routeKey } from './support/route-registry.js';

// ADR-030 D-8 (§2): "A permission token must not exist unless at least one
// route checks it; a route must not check a token no role holds." Evaluated
// against the FINAL target state (FEATURE_GD02_MATRIX enabled — the "new"
// side of every requireRoleFlagged/requirePermissionFlagged call), because
// that is the ratified matrix this invariant protects going forward (§6 PR-7).
//
// `requirePermission` is not mandatory on every route (D-8): a role-only
// gate (`requireRole('admin')` with no accompanying `requirePermission`) is
// valid where Admin is the only actor. This test only asserts that whatever
// tokens DO appear are hygienic in both directions; it does not require
// every route to carry a permission token.

function isWildcard(token: string): boolean {
  return token.endsWith(':*');
}

// PR-7 finding (out of scope to fix here — test-only PR per ADR-030 §6 PR-7's
// table row, no production-file changes permitted): these tokens are held by
// one or more roles in `ROLE_PERMISSIONS` but are checked by ZERO routes
// anywhere in `modules/*/routes.ts` (verified: no `requirePermission(...)`/
// `requirePermissionFlagged(...)` call site references them, and no
// corresponding route/module exists for `rooms`/`tasks`/`staffing`/`audit`).
// This is a genuine, PRE-EXISTING D-8 violation (these tokens predate
// ADR-030 entirely) that this new invariant test surfaces for the first
// time. Remediating it means either wiring the missing `requirePermission`
// gate onto the relevant routes or deleting the dead token from
// `ROLE_PERMISSIONS` (config/constants.ts) — both are production-code
// changes requiring their own Architecture/Security-reviewed PR, not a
// test-only PR-7 change. Recorded here, cited, and reported in the PR-7
// implementation summary rather than silently patched or hidden.
//   - rooms:read/write, tasks:read/write, staffing:read/write, audit:read:
//     no route in the entire repository calls requirePermission with these
//     tokens; `rooms`/`tasks`/`staffing`/`audit` do not even exist as
//     modules. Dead tokens.
//   - notifications:read/write: only the admin-only outbox-admin routes
//     (`requireRole('admin')`) and the unguarded read/mark-read/push-token
//     routes exist; none checks `requirePermission('notifications:read'/'write')`.
//   - analytics:read: ADR-030 §3 C-31 names this as the capability's
//     permission token, but `modules/analytics/routes.ts` gates purely on
//     `requireRole(['admin','manager'])` — no `requirePermission` call
//     exists at all (in addition to the module's own documented
//     'regional_manager' gap, see the route x role matrix test below).
const KNOWN_PRE_EXISTING_ORPHANED_TOKENS = new Set([
  'rooms:read',
  'rooms:write',
  'tasks:read',
  'tasks:write',
  'staffing:read',
  'staffing:write',
  'notifications:read',
  'notifications:write',
  'analytics:read',
  'audit:read',
]);

describe('ADR-030 D-8: permission-token hygiene invariant', () => {
  const routes = buildRouteRegistry();

  const tokensCheckedByRoutes = new Set<string>();
  for (const route of routes) {
    for (const token of route.requiredPermissions ?? []) {
      tokensCheckedByRoutes.add(token);
    }
  }

  const tokensHeldByRoles = new Set<string>();
  for (const roleTokens of Object.values(ROLE_PERMISSIONS)) {
    for (const token of roleTokens) {
      tokensHeldByRoles.add(token);
    }
  }

  it('found at least one route to check the invariant against (sanity check)', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every non-wildcard token any role holds is checked by at least one route', () => {
    const unchecked: string[] = [];

    for (const [role, tokens] of Object.entries(ROLE_PERMISSIONS)) {
      for (const token of tokens) {
        if (isWildcard(token)) continue; // e.g. 'admin:*' — implicit bypass, not a route-checked token
        if (KNOWN_PRE_EXISTING_ORPHANED_TOKENS.has(token)) continue; // see comment above; pre-existing, out of PR-7 scope
        if (!tokensCheckedByRoutes.has(token)) {
          unchecked.push(`${role}: ${token}`);
        }
      }
    }

    expect(unchecked).toEqual([]);
  });

  it('the known-pre-existing-orphaned-tokens allowlist does not silently rot (each entry is still actually unchecked)', () => {
    // Guards against the allowlist becoming stale: if a future PR wires up
    // requirePermission() for one of these tokens, this test forces its
    // removal from KNOWN_PRE_EXISTING_ORPHANED_TOKENS instead of leaving a
    // now-inaccurate exclusion in place.
    const stillOrphaned = Array.from(KNOWN_PRE_EXISTING_ORPHANED_TOKENS).filter(
      (token) => tokensCheckedByRoutes.has(token)
    );
    expect(stillOrphaned).toEqual([]);
  });

  it('every token a route checks is held by at least one role (directly or via wildcard)', () => {
    const orphaned: string[] = [];

    for (const route of routes) {
      for (const token of route.requiredPermissions ?? []) {
        const [resource] = token.split(':');
        const heldDirectly = tokensHeldByRoles.has(token);
        const heldViaWildcard = Array.from(tokensHeldByRoles).some((held) => {
          if (!isWildcard(held)) return false;
          const [heldResource] = held.split(':');
          return heldResource === resource || held === 'admin:*';
        });

        if (!heldDirectly && !heldViaWildcard) {
          orphaned.push(`${routeKey(route)} requires '${token}'`);
        }
      }
    }

    expect(orphaned).toEqual([]);
  });
});
