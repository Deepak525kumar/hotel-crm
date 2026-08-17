import { getEnv } from './env.js';

export type PivotMode = 'marketplace' | 'direct_dispatch';

/** The configured dispatch model (S0-4 pivot cutover flag). */
export function getPivotMode(): PivotMode {
  return getEnv().PIVOT_MODE;
}

/** True once the direct-dispatch (broadcast/assignment) flow is enabled. */
export function isDirectDispatchMode(): boolean {
  return getPivotMode() === 'direct_dispatch';
}

/**
 * Employment-record module cutover flag (Epic 5 PR 5.6, SPEC-EMP-001).
 * When disabled (default), the `/employees` routes are unmounted (404),
 * matching the "both-off = current behavior" posture (ADR-024 D3).
 */
export function isEmploymentRecordEnabled(): boolean {
  return getEnv().FEATURE_EMPLOYMENT_RECORD;
}

/**
 * Regional Manager role cutover flag (ADR-030 §6 PR-2, D-6).
 * When disabled (default), M-3's promotion of existing group-associated
 * managers to REGIONAL_MANAGER does not run and no route reads the token —
 * matching the "both-off = current behavior" posture. Must not be enabled in
 * production before PR-3 ships (mobile/frontend role-union widening + the
 * hotel-group RM-picker fix, F-3), per ADR-030 §6's ordering constraint.
 */
export function isRmRoleEnabled(): boolean {
  return getEnv().FEATURE_RM_ROLE;
}

/**
 * GD-02/GD-03 capability-matrix cutover flag (ADR-030 §6 PR-5).
 * When disabled (default), route gates keep requiring the legacy tokens
 * (`hotels:read`/`hotels:write` on hotel-groups routes instead of the D-9
 * split; `admin`+`manager` on hotel writes instead of D-3's admin-only) and
 * `PUT /users/:id` keeps accepting the legacy combined profile+role body
 * (not the D-4a split) — matching "both-off = current behavior", since
 * `ROLE_PERMISSIONS` is a source constant with no effect on any existing
 * account's stored permissions until M-2 backfills them.
 *
 * TEMPORARY, tracked for removal: once production has run M-2 and stayed on
 * this flag through a full release cycle with no rollback need (the backfill
 * script that performed M-2, `role-permissions-backfill.ts`, was itself
 * retired at ADR-031 PR-7 once request-time derivation superseded it — see
 * that PR's history for the deployment sequence it once documented), this flag,
 * `requireRoleFlagged`/`requirePermissionFlagged` (middleware/permissions.ts),
 * the legacy `UpdateUserSchema`/`updateUser` path (users/types.ts,
 * users/service.ts), and the legacy-token branches in crm/routes.ts should
 * all be deleted in one pass — matching how `FEATURE_SCOPE_AUTHZ` was
 * retired outright in this same PR (M-4), not left as permanent scaffolding.
 * File this as part of ADR-030 §6 PR-7/PR-8 (permission-matrix invariant
 * test + documentation sync), not as an open-ended "someday."
 */
export function isGD02MatrixEnabled(): boolean {
  return getEnv().FEATURE_GD02_MATRIX;
}

// ADR-031 §7 PR-7: FEATURE_DERIVED_PERMISSIONS and
// FEATURE_TOKEN_GENERATION_ENFORCEMENT (formerly here) are retired —
// request-time derivation and token_generation revocation are now
// unconditional in middleware/auth.ts, both cutovers being complete.

/**
 * Job Dispatch Phase 1 cutover flag (Epic 9, TREQ-011).
 * Gates nothing in PR 9.2 itself — WorkApplication/ApplicationStatus and
 * WorkerAssignment.application_id are removed unconditionally in this PR,
 * with no code path reading this flag yet. It is introduced here so PR 9.3
 * (WorkerAssignment repointed to a nullable job_request_id) and PR 9.4, plus
 * the still-pending mobile companion PR, have a single cutover flag to
 * consume from the start of the phase, matching this repo's existing
 * "flag lands ahead of its first consumer" precedent (e.g. FEATURE_RM_ROLE).
 */
export function isJobDispatchPhase1Enabled(): boolean {
  return getEnv().FEATURE_JOBDISPATCH_PHASE1;
}

/**
 * Job Dispatch Phase 2 cutover flag (Epic 9 PR 9.5, TREQ-001/MIG-GAP-03).
 * When disabled (default), `POST /assignments/calendar-entries` and
 * `GET /assignments/calendar-entries` fall through to the 404 handler,
 * matching the "both-off = current behavior" posture (same shape as
 * `isEmploymentRecordEnabled`'s route-mount gate in routes/v1/index.ts).
 * Separate flag from `isJobDispatchPhase1Enabled()` — Phase 1 (WorkApplication
 * removal, job_request_id repointing, WorkRequest->JobRequest rename) is a
 * distinct cutover from Phase 2 (calendar direct-assignment), each gated
 * independently per this repo's existing per-phase flag precedent.
 */
export function isJobDispatchPhase2Enabled(): boolean {
  return getEnv().FEATURE_JOBDISPATCH_PHASE2;
}

/**
 * Daily GDPR consent-gate enforcement (RULE-CONSENT-01, REQ-CONSENT-001).
 * When disabled (default), no request is gated and the middleware does not
 * even query consent state -- "both-off = current behavior", the same posture
 * ADR-024 D3 established for the employment-record cutover.
 *
 * Read per-request, never captured at module load: the kill switch must be an
 * env change plus a restart, not a code change.
 */
export function isConsentGateEnabled(): boolean {
  return getEnv().FEATURE_CONSENT_GATE;
}

/**
 * The roles the consent gate applies to. `admin` is excluded at parse time
 * (env.ts) and again at the gate, deliberately twice: an admin must always
 * retain access to fix a consent problem that is locking everyone else out.
 */
export function getConsentGateRoles(): readonly string[] {
  return getEnv().CONSENT_GATE_ROLES;
}
