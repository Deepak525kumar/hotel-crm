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
//   - rooms:read/write, tasks:read/write, staffing:read/write, audit:read:
//     no route in the entire repository calls requirePermission with these
//     tokens; `rooms`/`tasks`/`staffing`/`audit` do not even exist as
//     modules. Dead tokens.
//   - notifications:read/write: only the admin-only outbox-admin routes
//     (`requireRole('admin')`) and the unguarded read/mark-read/push-token
//     routes exist; none checks `requirePermission('notifications:read'/'write')`.
export const KNOWN_PRE_EXISTING_ORPHANED_TOKENS = new Set([
  'rooms:read',
  'rooms:write',
  'tasks:read',
  'tasks:write',
  'staffing:read',
  'staffing:write',
  'notifications:read',
  'notifications:write',
  'audit:read',
]);
