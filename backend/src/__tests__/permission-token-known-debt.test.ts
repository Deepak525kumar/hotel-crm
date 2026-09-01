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
    // `rooms:read` / `rooms:write` removed 2026-09-01: the `rooms` module now
    // exists (worker room logging + the checker's room picker) and every one
    // of its routes checks one of the two tokens, so they are no longer
    // orphaned. This is property 2 of this suite working as designed -- wiring
    // a debt token up forces its removal from the list here.
    'tasks:read',
    'tasks:write',
    'staffing:read',
    'notifications:read',
    'notifications:write',
    'audit:read',
    // ADR-030 §3 C-04: granted to match the ratified matrix, but C-04's surface
    // (the GD-05 pause toggle) is not built, so no route checks it yet. See
    // support/known-debt.ts for why this differs in kind from the dead tokens
    // above — it is a ratified grant awaiting its route, not a token to delete.
    'hotels:operate',
    // NOTE: `staffing:write` was removed from this list — it is now checked by
    // the C-23/C-24/C-25/C-26 routes (job-requests, assignments, calendar,
    // attendance). `staffing:read` remains orphaned: no route checks it.
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
