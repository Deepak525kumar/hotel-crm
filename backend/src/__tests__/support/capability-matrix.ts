// ADR-030 §3 "Final capability matrix" (C-01..C-34), transcribed as data.
//
// WHY THIS FILE EXISTS
// --------------------
// `route-role-matrix.test.ts` derives its expected allow/deny outcome from the
// very `requireRole(...)`/`requirePermission(...)` literals it then exercises
// (via `support/route-registry.ts`). Both sides of that assertion move together,
// so it validates the middleware but can never detect a route whose gate
// contradicts the ratified matrix. Two REGIONAL_MANAGER authorization defects
// shipped straight through it and were caught only by human security review:
// `SIR-AUTH-021` (High — `resolveHotelAccess()` had no REGIONAL_MANAGER branch)
// and `SIR-ANLY-015` (Medium — analytics role admission and the `analytics:read`
// grant not extended in lockstep). See `.claude/governance/
// SPECIFICATION_ISSUES_REGISTER.md`.
//
// This module is the independent half of the assertion: the specification,
// written down by hand from ADR-030 §3, owing nothing to the source it checks.
// It is deliberately hand-maintained. Editing it is editing a transcription of
// a ratified governance record, so a diff here must cite the ADR (or its
// amending record) that authorizes the change — exactly the reviewable-edit
// property `support/known-debt.ts` already relies on.
//
// SCOPE OF WHAT THIS ENCODES
// --------------------------
// The matrix's `✓ᶜ` ("allowed within the actor's scope") collapses to `allow`
// here. This file models the ROLE + PERMISSION-TOKEN decision only — the same
// seam `requireRole`/`requirePermission` occupy. Whether an in-scope actor is
// then correctly narrowed to their own hotel/group is a different seam
// (`checkHotelAccess`/`checkWorkerScope`, `resolveScopeGroupFilter`) covered by
// `rbac.test.ts` and the `*-scope-authz.test.ts` suites. A `✓ᶜ` capability that
// is route-admitted but unscoped would pass this matrix and fail those — by
// design; conflating the two would make every failure ambiguous.
//
// Capabilities whose token column reads "— (role only)" carry `token: null`:
// the ADR grants them by role alone, so there is no token to assert.

/** ADR-030 §3 role columns, in the ADR's own column order. */
export const MATRIX_ROLES = [
  'admin',
  'regional_manager',
  'manager',
  'checker',
  'worker',
] as const;

export type MatrixRole = (typeof MATRIX_ROLES)[number];

/**
 * `allow` = `✓` or `✓ᶜ` in ADR-030 §3 (see "SCOPE OF WHAT THIS ENCODES").
 * `deny`  = `✗`.
 */
export type Outcome = 'allow' | 'deny';

export interface Capability {
  /** ADR-030 §3 row id, e.g. 'C-29'. */
  id: string;
  /** The ADR's own capability wording, verbatim enough to locate the row. */
  name: string;
  /** 'M' = master data (D-2), 'O' = operations. */
  class: 'M' | 'O';
  /**
   * The permission token(s) ADR-030 §3 names for this row. `null` where the
   * ADR's token column reads "— (role only)" or "—".
   */
  token: string | null;
  /** Per-role ratified outcome. Every MATRIX_ROLES key is required. */
  outcome: Record<MatrixRole, Outcome>;
}

// Row-builder shorthands. `o(...)` spells the five columns in MATRIX_ROLES
// order so each row below reads like the ADR's own table left-to-right.
function o(
  admin: Outcome,
  regional_manager: Outcome,
  manager: Outcome,
  checker: Outcome,
  worker: Outcome
): Record<MatrixRole, Outcome> {
  return { admin, regional_manager, manager, checker, worker };
}

const A: Outcome = 'allow';
const D: Outcome = 'deny';

/**
 * ADR-030 §3, C-01..C-34, in ADR order.
 *
 * Footnote 1 (C-16) and footnote 2 are transcribed as the ADR ratified them at
 * this revision: C-16 is `✗` for every non-admin role (OQ-030-A / D-4b — RM and
 * Manager employee authority is action-only, never field-level, and none of the
 * three actions has a route yet).
 */
export const CAPABILITY_MATRIX: readonly Capability[] = Object.freeze([
  { id: 'C-01', name: 'Create hotel', class: 'M', token: 'hotels:write', outcome: o(A, D, D, D, D) },
  { id: 'C-02', name: 'Edit hotel record', class: 'M', token: 'hotels:write', outcome: o(A, D, D, D, D) },
  { id: 'C-03', name: 'Delete hotel', class: 'M', token: null, outcome: o(A, D, D, D, D) },
  { id: 'C-04', name: 'Operate hotel (toggles, e.g. GD-05 pause)', class: 'O', token: 'hotels:operate', outcome: o(A, A, A, D, D) },
  { id: 'C-05', name: 'View hotels', class: 'O', token: 'hotels:read', outcome: o(A, A, A, A, A) },
  { id: 'C-06', name: 'Create / delete hotel group', class: 'M', token: 'hotel_groups:write', outcome: o(A, D, D, D, D) },
  { id: 'C-07', name: 'Edit hotel-group composition', class: 'M', token: 'hotel_groups:write', outcome: o(A, D, D, D, D) },
  { id: 'C-08', name: 'View hotel group', class: 'O', token: 'hotel_groups:read', outcome: o(A, A, A, D, D) },
  { id: 'C-09', name: 'Appoint RM / hotel manager', class: 'M', token: 'hotel_groups:write', outcome: o(A, D, D, D, D) },
  { id: 'C-10', name: 'Create user account', class: 'M', token: null, outcome: o(A, D, D, D, D) },
  { id: 'C-11', name: 'Edit user profile', class: 'O', token: 'users:write', outcome: o(A, A, A, D, D) },
  { id: 'C-12', name: 'Assign / change user role', class: 'M', token: null, outcome: o(A, D, D, D, D) },
  { id: 'C-13', name: 'Deactivate / delete user', class: 'M', token: null, outcome: o(A, D, D, D, D) },
  { id: 'C-14', name: 'View users', class: 'O', token: 'users:read', outcome: o(A, A, A, D, D) },
  { id: 'C-15', name: 'Create / bulk-import employee', class: 'M', token: 'employees:write', outcome: o(A, D, D, D, D) },
  // Superseded 2026-08-06 (employment-lifecycle rework, PR #354, ADR-030 §3
  // note ³): was token: null / admin-only, deferred to an unbuilt
  // backend-onboarding module. Now a live, scoped grant covering
  // submit-for-review/approve/reject/deactivate/reactivate/rehire, all gated
  // by employee-management's own assertLifecycleAuthority(). C-18
  // ("Deactivate employee") merges into this row -- see below.
  { id: 'C-16', name: 'Employee operational transitions', class: 'O', token: 'employees:write', outcome: o(A, A, A, D, D) },
  { id: 'C-17', name: 'Edit employee record fields', class: 'M', token: 'employees:write', outcome: o(A, D, D, D, D) },
  // Merged into C-16 (2026-08-06, PR #354): deactivate is now one of six
  // uniformly-authorized lifecycle transitions, not a separately-ratified
  // capability. Retained as a row (not deleted) so `id` numbering C-01..C-34
  // stays stable and the "covers C-01..C-34 with no gaps" invariant test
  // keeps holding -- `token: null` and no CAPABILITY_ROUTES entry means this
  // row is asserted at neither the token-grant nor route-gate layer.
  { id: 'C-18', name: 'Deactivate employee (merged into C-16)', class: 'M', token: null, outcome: o(A, D, D, D, D) },
  { id: 'C-19', name: 'View employee profile', class: 'O', token: 'employees:read', outcome: o(A, A, A, A, A) },
  { id: 'C-20', name: 'Read special-category fields', class: 'M', token: 'employees:special_category:read', outcome: o(A, D, D, D, D) },
  { id: 'C-21', name: 'Subject-rights export', class: 'M', token: 'employees:read', outcome: o(A, D, D, D, D) },
  { id: 'C-22', name: 'Manage hotel blocklist', class: 'O', token: 'employees:write', outcome: o(A, A, A, D, D) },
  { id: 'C-23', name: 'Manage work requests', class: 'O', token: 'staffing:write', outcome: o(A, A, A, D, D) },
  { id: 'C-24', name: 'Manage assignments', class: 'O', token: 'staffing:write', outcome: o(A, A, A, D, D) },
  { id: 'C-25', name: 'Write calendar operations', class: 'O', token: 'staffing:write', outcome: o(A, A, A, D, D) },
  { id: 'C-26', name: 'Approve / correct attendance', class: 'O', token: 'staffing:write', outcome: o(A, A, A, D, D) },
  { id: 'C-27', name: 'Submit quality rating / verification', class: 'O', token: 'quality:write', outcome: o(A, D, D, A, D) },
  // WORKER amended D -> A by ADR-067 (2026-08-14), which resolves GD-06's
  // leaderboard half: a worker may view the leaderboard for their OWN hotel
  // group, scope resolved server-side from their employment record, with
  // contact fields withheld. GD-06's analytics half stays open -- C-31 below is
  // deliberately NOT amended.
  { id: 'C-28', name: 'View quality / leaderboard', class: 'O', token: 'quality:read', outcome: o(A, A, A, A, A) },
  { id: 'C-29', name: 'Manage HR contracts / payroll', class: 'O', token: 'hr:write', outcome: o(A, A, A, D, D) },
  { id: 'C-30', name: 'View HR records', class: 'O', token: 'hr:read', outcome: o(A, A, A, D, D) },
  { id: 'C-31', name: 'View analytics', class: 'O', token: 'analytics:read', outcome: o(A, A, A, D, D) },
  { id: 'C-32', name: 'Export reports', class: 'M', token: null, outcome: o(A, D, D, D, D) },
  { id: 'C-33', name: 'View org chart', class: 'O', token: 'org_chart:read', outcome: o(A, A, D, D, D) },
  { id: 'C-34', name: 'Administer notification outbox', class: 'M', token: null, outcome: o(A, D, D, D, D) },
]);

/** A capability whose token column names a real token (never `null`). */
export type TokenBackedCapability = Capability & { token: string };

/** Every capability whose token column names a real token. */
export function tokenBackedCapabilities(): TokenBackedCapability[] {
  return CAPABILITY_MATRIX.filter((c): c is TokenBackedCapability => c.token !== null);
}

/**
 * The token set ADR-030 §3 implies each role must hold: every token-backed
 * capability the role is granted.
 *
 * Deliberately derived from the matrix rather than transcribed from §3's
 * "Resulting ROLE_PERMISSIONS" pseudo-code block — that block is prose and is
 * already known to drift from its own table (it frames `hotel_groups:read` as
 * an RM-only delta over MANAGER, while C-08 grants it to both). The table is
 * the normative half of the record; the pseudo-code is a summary of it.
 */
export function expectedTokensFor(role: MatrixRole): Set<string> {
  const tokens = new Set<string>();
  for (const cap of tokenBackedCapabilities()) {
    if (cap.outcome[role] === 'allow') tokens.add(cap.token);
  }
  return tokens;
}

/**
 * Whether ADR-030 §3 grants `role` the token `token` for ANY capability that
 * names it.
 *
 * Several tokens are shared across capabilities with different role sets, so a
 * token grant cannot be asserted per-capability. `employees:write` backs C-15
 * (create employee, Admin-only), C-17 (edit employee fields, Admin-only) AND
 * C-22 (manage hotel blocklist, Manager/RM `✓ᶜ`); `employees:read` backs C-19
 * (view employee profile, every role) and C-21 (subject-rights export,
 * Admin-only). A Manager legitimately holding `employees:write` for C-22
 * therefore also "holds C-15's token" — the token is simply not what separates
 * those capabilities. The route gate is (`requireRole('admin')` on
 * `POST /employees`, `/bulk-import` and `/:employee_id/export`), which is why
 * the route-gate half of this suite asserts C-15/C-17/C-21 independently.
 *
 * Asserting per-capability here would report a violation for correct code and
 * force a pin that documents nothing — so the token assertion answers the only
 * question a token CAN answer: is this role entitled to this token at all?
 */
export function matrixGrantsToken(role: MatrixRole, token: string): boolean {
  return tokenBackedCapabilities().some((c) => c.token === token && c.outcome[role] === 'allow');
}
