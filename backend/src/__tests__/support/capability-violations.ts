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
  
  {
    key: 'C-15:manager@employee-management:POST /',
    reason: 'ADR-065 expands createEmployee to manager',
    authority: 'ADR-065',
    owner: 'PR 9.x',
  },
  {
    key: 'C-15:regional_manager@employee-management:POST /',
    reason: 'ADR-065 expands createEmployee to regional_manager',
    authority: 'ADR-065',
    owner: 'PR 9.x',
  },
  // C-16 (submit-for-review): ADR-065 §6 item 5 / SPEC-ONBOARDING-001 §6.9
  // establish self-service onboarding — the applicant uploads their own
  // documents and submits their own application. The ratified ADR-030 §3
  // matrix predates that decision and lists this capability as manager+ only,
  // so admitting worker/checker to the route diverges from the matrix as
  // transcribed.
  //
  // Authorization is NOT weakened: the route's role gate widens, but
  // `requirePermission('employees:write')` is deliberately dropped from it
  // (worker/checker hold only `employees:read`) and the real boundary moves
  // into assertLifecycleAuthority, which returns early ONLY when
  // `actor.userId === record.user_id`. Verified end-to-end: a worker may
  // submit their OWN record; the same worker submitting ANOTHER worker's
  // record gets 403, as does a checker acting on a worker's record.
  //
  // These pins should be REMOVED (not the code reverted) once ADR-030 §3's
  // matrix is amended to reflect ADR-065's self-service decision — the
  // forward-note ADR-065 §7 already flags as owed to ADR-030.
  {
    key: 'C-16:worker@employee-management:POST /:employee_id/submit-for-review',
    reason: 'ADR-065 self-service: a worker submits their own application (own-record only, enforced in assertLifecycleAuthority)',
    authority: 'ADR-065 §6 item 5 / SPEC-ONBOARDING-001 §6.9 vs ADR-030 §3 C-16',
    owner: 'ADR-030 §3 matrix amendment',
  },
  {
    key: 'C-16:checker@employee-management:POST /:employee_id/submit-for-review',
    reason: 'ADR-065 self-service: a checker submits their own application (own-record only, enforced in assertLifecycleAuthority)',
    authority: 'ADR-065 §6 item 5 / SPEC-ONBOARDING-001 §6.9 vs ADR-030 §3 C-16',
    owner: 'ADR-030 §3 matrix amendment',
  },
  // ---------------------------------------------------------------------
]);

export const CAPABILITY_VIOLATIONS: ReadonlyMap<string, CapabilityViolation> = new Map(
  VIOLATIONS.map((v) => [v.key, v])
);

export const CAPABILITY_VIOLATION_KEYS: ReadonlySet<string> = new Set(VIOLATIONS.map((v) => v.key));
