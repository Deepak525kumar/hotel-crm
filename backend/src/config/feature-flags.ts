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
 */
export function isGD02MatrixEnabled(): boolean {
  return getEnv().FEATURE_GD02_MATRIX;
}
