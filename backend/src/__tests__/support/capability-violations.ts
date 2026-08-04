// Ratified-matrix violations that exist in the source at this revision.
//
// `capability-policy.test.ts` asserts `ROLE_PERMISSIONS` and the route gates
// against `support/capability-matrix.ts` (the transcribed ADR-030 §3 table).
// Where the source contradicts the ADR today, the violation is PINNED here
// rather than filtered away: the suite asserts this set matches the actual set
// of violations EXACTLY, so both fixing one and introducing a new one fail the
// build until this file is deliberately edited.
//
// This is the same pinned-debt protocol `support/known-debt.ts` already uses
// for orphaned permission tokens, and for the same reason — a quiet
// pass/fail flip is worse than a loud, reviewable list.
//
// Every entry cites the governance record the source violates. Remediating any
// entry is a production-code change with its own Security/Architecture gate;
// each names the PR that owns it in the approved Regional Manager roadmap.
//
// Entries are keyed `<token>:<role>` for permission-grant violations (keyed by
// TOKEN, not capability — several tokens back more than one capability with
// different role sets; see capability-matrix.ts's `matrixGrantsToken`) and
// `<C-id>:<role>@<module>:<METHOD> <path>` for route-gate violations.

export interface CapabilityViolation {
  /** `<C-id>:<role>` or `<C-id>:<role>@<routeKey>`. */
  key: string;
  /** What the source does instead of what the ADR ratified. */
  reason: string;
  /** The governance record the source contradicts. */
  authority: string;
  /** Roadmap PR that closes it. */
  owner: string;
}

const VIOLATIONS: readonly CapabilityViolation[] = Object.freeze([
  // ---------------------------------------------------------------------
  // C-04 `hotels:operate`: the token now EXISTS and is granted per the
  // ratified matrix, but C-04's own surface (the GD-05 pause toggle) is not
  // built, so no route checks it. That is recorded as awaiting-its-route debt
  // in `support/known-debt.ts`, not as a matrix violation — the grants
  // themselves now conform, so there is nothing to pin here.
  //
  // C-33 `org_chart:read`: created and wired onto the org-chart route
  // (employee-management/routes.ts). Conforms.
  //
  // C-05 (hotel LIST): previously omitted checker/worker while the ratified
  // matrix grants all five roles the equivalent access and the sibling detail
  // route (GET /hotels/:hotel_id) already admitted them. Product decision
  // (2026-08-05): widen the list route to match the matrix and the detail
  // route, rather than narrow the matrix. Fixed — crm/routes.ts's
  // GET /hotels gate now includes checker/worker, and listHotels()
  // roster-scopes a worker's results (checker keeps its documented
  // cross-hotel bypass, matching the detail route). Conforms.
  //
  // C-22, C-23, C-24, C-25, C-29 and C-30 regional_manager route-gate
  // violations were all closed in the same pass that added
  // resolveWorkerScope's RM branch. Conform.
  // ---------------------------------------------------------------------
]);

export const CAPABILITY_VIOLATIONS: ReadonlyMap<string, CapabilityViolation> = new Map(
  VIOLATIONS.map((v) => [v.key, v])
);

export const CAPABILITY_VIOLATION_KEYS: ReadonlySet<string> = new Set(VIOLATIONS.map((v) => v.key));
