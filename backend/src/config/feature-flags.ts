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
 * Scope-based authorization cutover flag (Epic 5 PR 5.5, ADR-024 D3).
 * When enabled, the `manager` role is scope-bound via the PR 5.4 JWT `scope`
 * claim instead of bypassing hotel access. When disabled (rollback), manager
 * reverts to the pre-fix bypass — the "both-off reproduces current behavior"
 * compatibility guarantee.
 */
export function isScopeAuthzEnabled(): boolean {
  return getEnv().FEATURE_SCOPE_AUTHZ;
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
 * Roster cutover flag (Epic 5 PR 5.7, ADR-022/023/024 D1/D2/D5(i)).
 * Independent of and additive to isEmploymentRecordEnabled(). When disabled
 * (default), checkHotelAccess() and its consumers keep reading the legacy
 * per-hotel HotelWorker ACTIVE membership rows, byte-for-byte the pre-PR-5.7
 * behavior (ADR-024 D4 "both-off = current behavior"). When enabled, the same
 * call sites read the PR 5.6 EmploymentRecord (per-employee, group-grain)
 * instead, via `lib/roster-scope.ts`.
 */
export function isRosterCutoverEnabled(): boolean {
  return getEnv().FEATURE_ROSTER_CUTOVER;
}
