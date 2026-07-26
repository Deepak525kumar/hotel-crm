import { describe, it, expect } from '@jest/globals';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { buildRouteRegistry } from './support/route-registry.js';
import { KNOWN_PRE_EXISTING_ORPHANED_TOKENS } from './support/known-debt.js';

// ADR-030 PR-7 (review follow-up): keeps the known-debt allowlist itself
// under test, separate from the D-8 invariant it's excluded from
// (permission-token-hygiene.test.ts). Two properties are pinned:
//
//   1. The allowlist is EXACTLY this set — not a superset or subset. Any
//      change (an entry added, removed, or renamed) must show up as a diff
//      in this test, forcing a deliberate edit to
//      `support/known-debt.ts` rather than a silent widening or shrinking.
//   2. Every entry is STILL actually orphaned. If a future PR wires up
//      `requirePermission()` for one of these tokens, this test fails until
//      the now-fixed entry is removed from the allowlist — the debt list
//      cannot rot into inaccuracy.
describe('ADR-030 D-8 known-debt allowlist (permission-token-hygiene.test.ts exclusions)', () => {
  const EXPECTED_DEBT = [
    'rooms:read',
    'rooms:write',
    'tasks:read',
    'tasks:write',
    'staffing:read',
    'staffing:write',
    'notifications:read',
    'notifications:write',
    'audit:read',
  ].sort();

  it('is exactly the expected, reviewed set of tokens', () => {
    expect(Array.from(KNOWN_PRE_EXISTING_ORPHANED_TOKENS).sort()).toEqual(EXPECTED_DEBT);
  });

  it('every allowlisted token is still actually unchecked by any route', () => {
    const routes = buildRouteRegistry();
    const tokensCheckedByRoutes = new Set<string>();
    for (const route of routes) {
      for (const token of route.requiredPermissions ?? []) {
        tokensCheckedByRoutes.add(token);
      }
    }

    const noLongerOrphaned = Array.from(KNOWN_PRE_EXISTING_ORPHANED_TOKENS).filter((token) =>
      tokensCheckedByRoutes.has(token)
    );
    expect(noLongerOrphaned).toEqual([]);
  });

  it('every allowlisted token is still actually held by at least one role (still real debt, not stale)', () => {
    const tokensHeldByRoles = new Set<string>();
    for (const roleTokens of Object.values(ROLE_PERMISSIONS)) {
      for (const token of roleTokens) {
        tokensHeldByRoles.add(token);
      }
    }

    const noLongerHeld = Array.from(KNOWN_PRE_EXISTING_ORPHANED_TOKENS).filter(
      (token) => !tokensHeldByRoles.has(token)
    );
    expect(noLongerHeld).toEqual([]);
  });
});
