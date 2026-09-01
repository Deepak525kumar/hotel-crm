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
  
  // C-10 (Create user account): ADR-030 D-4 ratified account creation as
  // Admin-only "permanently" and the matrix transcribes C-10 as admin-only.
  // The project owner's 2026-08-12 decision (RULE A, "create is
  // 1-level-down only") replaces that with a hierarchy:
  //   admin -> regional_manager, regional_manager -> manager,
  //   manager -> worker|checker, worker/checker -> nobody.
  //
  // So `POST /users`'s role gate widens to admit manager/regional_manager,
  // which is what these two pins record. The ROLE GATE is now the LOOSER of
  // the two layers by design — the binding decision moved into
  // `lib/role-hierarchy.ts#canCreateRole`, called by
  // `users/service.ts#createUser`, which this suite's seam (requireRole /
  // requirePermission only) cannot see.
  //
  // Authorization is NET NARROWED, not weakened, and the part this suite
  // cannot observe is the part that narrows it: `admin` is no longer
  // creatable by ANY role (it is one level below nothing), where previously
  // an admin could mint another admin. A manager reaching this route can only
  // ever produce worker/checker; an RM only manager. Verified by
  // `role-hierarchy.test.ts` (every actor x target pair) and
  // `users.test.ts`'s createUser cases.
  //
  // Both pins should be REMOVED (not the code reverted) once ADR-030 §3's
  // C-10 row and D-4's Admin-only invariant are amended to reflect RULE A.
  // Tracked in docs/10-testing/e2e/REMAINING_WORK.md; SIR-USERS-002 holds
  // D-4's own history.
  {
    key: 'C-10:manager@users:POST /',
    reason: 'RULE A 1-level-down: manager may create worker/checker accounts (target role enforced in users/service.ts via canCreateRole)',
    authority: "Project-owner decision 2026-08-12 (RULE A, 'create is 1-level-down only') vs ADR-030 §3 C-10 / D-4",
    owner: 'ADR-030 §3 C-10 + D-4 amendment',
  },
  {
    key: 'C-10:regional_manager@users:POST /',
    reason: 'RULE A 1-level-down: regional_manager may create manager accounts (target role enforced in users/service.ts via canCreateRole)',
    authority: "Project-owner decision 2026-08-12 (RULE A, 'create is 1-level-down only') vs ADR-030 §3 C-10 / D-4",
    owner: 'ADR-030 §3 C-10 + D-4 amendment',
  },
  // C-12 (Assign / change user role): ADR-030 §3 C-12 lists this as Admin-only.
  // regional_manager was added to PUT /:user_id/role as part of the Regional
  // Manager V1 scope (ADR-030 D-5 parity), so an RM can reassign roles for
  // managers within their hotel group. The binding target-role restriction is
  // enforced service-side via canCreateRole (lib/role-hierarchy.ts), which limits
  // RM to only roles one step below it -- admin and regional_manager targets are
  // rejected. Verified by users.test.ts.
  //
  // Pin should be REMOVED once ADR-030 §3 C-12 is amended to reflect D-5's RM grant.
  {
    key: 'C-12:regional_manager@users:PUT /:user_id/role',
    reason: 'ADR-030 D-5 parity: RM may change manager roles, restricted by role-hierarchy logic',
    authority: 'ADR-030 D-5 Regional Manager V1 Scope vs ADR-030 §3 C-12 Admin-only',
    owner: 'ADR-030 §3 C-12 amendment',
  },
  {
    key: 'C-13:manager@users:DELETE /:user_id',
    reason: 'Project owner decision: managers may delete PENDING users, restricted by checkAccess in employee-management service',
    authority: 'Project owner decision vs ADR-030 §3 C-13',
    owner: 'ADR-030 §3 C-13 amendment',
  },
  {
    key: 'C-13:regional_manager@users:DELETE /:user_id',
    reason: 'Project owner decision: regional managers may delete PENDING users, restricted by checkAccess in employee-management service',
    authority: 'Project owner decision vs ADR-030 §3 C-13',
    owner: 'ADR-030 §3 C-13 amendment',
  },
  // C-15 (Create / bulk-import employee): the ROUTE gate still admits
  // manager/regional_manager, so these two pins stand unchanged in shape —
  // but their AUTHORITY has moved. ADR-065's broad createEmployee grant is
  // no longer what justifies them: the owner's 2026-08-12 RULE A decision
  // NARROWS ADR-065, restricting each role to exactly one level down
  // (previously admin/manager/RM could each create ANY target role, because
  // nothing checked the target role at all — that was the hole RULE A
  // closes). The route gate is unchanged; the new target-role check lives in
  // `employee-management/service.ts#createEmployee` via
  // `lib/role-hierarchy.ts#canCreateRole`, outside this suite's seam.
  //
  // ADR-065 and RULE A are in direct conflict and the owner knows an ADR-065
  // amendment is owed (docs/10-testing/e2e/REMAINING_WORK.md); both records
  // are cited here rather than silently dropping ADR-065.
  {
    key: 'C-15:manager@employee-management:POST /',
    reason: 'Route admits manager (ADR-065); RULE A narrows it to target roles worker/checker only, enforced in service via canCreateRole',
    authority: "ADR-065 + project-owner decision 2026-08-12 (RULE A) vs ADR-030 §3 C-15",
    owner: 'ADR-030 §3 C-15 + ADR-065 amendment',
  },
  {
    key: 'C-15:regional_manager@employee-management:POST /',
    reason: 'Route admits regional_manager (ADR-065); RULE A narrows it to target role manager only, enforced in service via canCreateRole',
    authority: "ADR-065 + project-owner decision 2026-08-12 (RULE A) vs ADR-030 §3 C-15",
    owner: 'ADR-030 §3 C-15 + ADR-065 amendment',
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
  // STRENGTHENED by the project owner's 2026-08-12 decision (RULE B, "nobody
  // may perform another user's onboarding"): submit-for-review is now
  // self-service ONLY, for EVERY role. Previously admin (and a group-scoped
  // manager/RM) could submit on an applicant's behalf, because
  // assertLifecycleAuthority returned early for admin BEFORE reaching the
  // self-check; that ordering was the bypass, and the self-check now precedes
  // the admin return (employee-management/service.ts).
  //
  // The ROUTE gate is unchanged (all five roles admitted), so these two pins
  // stand as-is — the route was never the boundary for this action, and RULE B
  // makes that more true rather than less. What changed is invisible to this
  // suite's seam: admin/manager/RM acting on ANOTHER user's record now get 403
  // where they previously succeeded. Asserted in
  // `employee-management-scope-authz.test.ts` and `onboarding-self-only.test.ts`.
  //
  // NOTE approve/assign/reject/deactivate/reactivate/rehire are deliberately
  // NOT self-service and keep the full hierarchy check — a Manager's
  // application is still approved by an RM or Admin. RULE B covers upload and
  // submit only.
  //
  // These pins should be REMOVED (not the code reverted) once ADR-030 §3's
  // matrix is amended to reflect ADR-065's self-service decision — the
  // forward-note ADR-065 §7 already flags as owed to ADR-030.
  {
    key: 'C-16:worker@employee-management:POST /:employee_id/submit-for-review',
    reason: 'Self-service submit: a worker submits their OWN application (own-record only, enforced in assertLifecycleAuthority; RULE B makes this the only permitted actor)',
    authority: 'ADR-065 §6 item 5 / SPEC-ONBOARDING-001 §6.9, strengthened by project-owner decision 2026-08-12 (RULE B), vs ADR-030 §3 C-16',
    owner: 'ADR-030 §3 matrix amendment',
  },
  {
    key: 'C-16:checker@employee-management:POST /:employee_id/submit-for-review',
    reason: 'Self-service submit: a checker submits their OWN application (own-record only, enforced in assertLifecycleAuthority; RULE B makes this the only permitted actor)',
    authority: 'ADR-065 §6 item 5 / SPEC-ONBOARDING-001 §6.9, strengthened by project-owner decision 2026-08-12 (RULE B), vs ADR-030 §3 C-16',
    owner: 'ADR-030 §3 matrix amendment',
  },
  // ---------------------------------------------------------------------
]);

export const CAPABILITY_VIOLATIONS: ReadonlyMap<string, CapabilityViolation> = new Map(
  VIOLATIONS.map((v) => [v.key, v])
);

export const CAPABILITY_VIOLATION_KEYS: ReadonlySet<string> = new Set(VIOLATIONS.map((v) => v.key));
