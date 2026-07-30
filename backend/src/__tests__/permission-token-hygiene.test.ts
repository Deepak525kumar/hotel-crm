import { describe, it, expect } from '@jest/globals';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { buildRouteRegistry, routeKey } from './support/route-registry.js';
import { KNOWN_PRE_EXISTING_ORPHANED_TOKENS } from './support/known-debt.js';

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
//
// The only exclusion applied is `KNOWN_PRE_EXISTING_ORPHANED_TOKENS`
// (support/known-debt.ts) — pre-existing debt that predates this ADR and
// needs its own production PR to remediate. That allowlist is pinned and
// self-verified in `permission-token-known-debt.test.ts`, kept deliberately
// out of this file so this invariant's assertions stay legible on their own.
//
// If your token fails "every non-wildcard token any role holds is checked
// by at least one route" but IS genuinely checked at runtime: you likely
// wrote a role-conditional permission wrapper (a route needing a different
// token per caller role — `requirePermission()`'s array form is AND-only
// and cannot express that). The static parser (support/route-registry.ts)
// cannot see a check performed inside a named wrapper function's own body —
// declare the wrapper's token set via a `@requiresPermission` comment
// annotation above its `function` declaration instead of adding the token
// to `KNOWN_PRE_EXISTING_ORPHANED_TOKENS` (that allowlist is for dead code,
// not this). See `middleware/permissions.ts`'s `requirePermission()`
// docstring and `hr/routes.ts`'s `requireContractReadAccess()` for the
// reference convention and implementation.

function isWildcard(token: string): boolean {
  return token.endsWith(':*');
}

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
        if (KNOWN_PRE_EXISTING_ORPHANED_TOKENS.has(token)) continue; // tracked debt, see support/known-debt.ts
        if (!tokensCheckedByRoutes.has(token)) {
          unchecked.push(`${role}: ${token}`);
        }
      }
    }

    expect(unchecked).toEqual([]);
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
