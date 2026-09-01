// ADR-030 PR-7 (review follow-up): tracked, pre-existing D-8 permission-token
// hygiene debt that predates this ADR entirely.
//
// These tokens are held by one or more roles in `ROLE_PERMISSIONS` but are
// checked by ZERO routes anywhere in `modules/*/routes.ts` — no
// `requirePermission(...)`/`requirePermissionFlagged(...)` call site
// references them, and for some, no corresponding module/route even exists.
// Remediating any entry means either wiring the missing `requirePermission`
// gate onto the relevant route(s) or deleting the dead token from
// `ROLE_PERMISSIONS` (config/constants.ts) — both are production-code changes
// requiring their own Architecture/Security-reviewed PR, not a test-only
// change here.
//
// This list is pinned, not filtered away silently: `permission-token-known-
// debt.test.ts` asserts it matches this exact set, and
// `permission-token-hygiene.test.ts` only excludes entries found here — so
// fixing any one of them (or discovering a new one) requires a deliberate,
// reviewable edit to this file, not a quiet pass/fail flip.
//
//   - rooms:read/write: NO LONGER ORPHANED as of 2026-09-01. The `rooms`
//     module now exists (worker room logging + the checker's room picker) and
//     every one of its routes checks one of these two tokens, so both were
//     removed from the set below -- the remediation this file's own header
//     prescribes ("wiring the missing requirePermission gate onto the
//     relevant route(s)"). `rooms:write` was also granted to WORKER in the
//     same change, since the worker is the role that writes room logs.
//   - tasks:read/write, staffing:read/write, audit:read:
//     no route in the entire repository calls requirePermission with these
//     tokens; `tasks`/`staffing`/`audit` do not even exist as modules. Dead
//     tokens.
//   - notifications:read/write: only the admin-only outbox-admin routes
//     (`requireRole('admin')`) and the unguarded read/mark-read/push-token
//     routes exist; none checks `requirePermission('notifications:read'/'write')`.
//   - hotels:operate: added to ROLE_PERMISSIONS to match ADR-030 §3 C-04
//     (Operate hotel — Admin/RM/Manager `✓ᶜ`), but C-04's own surface (the
//     GD-05 pause toggle) is not built, so no route checks it yet. Unlike the
//     entries above this is NOT dead: it is a ratified grant awaiting its
//     route, and the entry should be removed — not the token deleted — when
//     that route lands. Distinct from `org_chart:read`, the other C-33 token
//     added in the same pass, which IS consumed
//     (employee-management/routes.ts's org-chart route) and so is absent here.
export const KNOWN_PRE_EXISTING_ORPHANED_TOKENS = new Set([
  'hotels:operate',
  // 'rooms:read' / 'rooms:write' removed 2026-09-01 -- both are now checked by
  // modules/rooms/routes.ts. See the note above.
  'tasks:read',
  'tasks:write',
  // `staffing:write` is NOT here: it is now checked by the C-23/C-24/C-25/C-26
  // routes. `staffing:read` remains orphaned — no route checks it.
  'staffing:read',
  'notifications:read',
  'notifications:write',
  'audit:read',
]);
