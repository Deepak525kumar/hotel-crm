/**
 * The employment-lifecycle transitions a manager may perform.
 *
 * ADR-030 D-4b is emphatic: manager authority over an employment record is
 * expressed EXCLUSIVELY as named workflow transitions, never as field edits.
 * No manager-editable field list exists and none may be introduced by
 * inference from `employees:write`. That is why this is a fixed verb list and
 * why the team-member screen has no employment-record form.
 *
 * `delete` and `restore` are deliberately ABSENT: the 2026-08-06 rework made
 * them admin-only and unrestricted by scope, because they cross the account
 * boundary (they touch `deleted_at`/`is_active`/`token_generation`) and have
 * a strictly larger blast radius than a status change.
 */
export const LIFECYCLE_ACTIONS = [
  'submit-for-review',
  'approve',
  'reject',
  'deactivate',
  'reactivate',
  'rehire',
  'trigger-reonboarding',
] as const;

export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** Transitions that take a reason the server records. */
const NEEDS_REASON: ReadonlySet<string> = new Set(['reject']);

export function needsReason(action: LifecycleAction): boolean {
  return NEEDS_REASON.has(action);
}

/**
 * Which transitions make sense from a given status.
 *
 * A best-effort UI narrowing, NOT the rule: `assertLifecycleAuthority()` and
 * `applyTransition()` own the real state machine, and a transition this
 * function allows can still be refused. Offering every verb from every state
 * would invite 400s a manager cannot interpret; hiding one the server would
 * accept costs only a tap elsewhere.
 */
export function actionsFor(status: string | null | undefined): LifecycleAction[] {
  switch (status) {
    case 'PENDING':
      return ['submit-for-review', 'reject'];
    case 'IN_REVIEW':
    case 'REVIEW':
      return ['approve', 'reject'];
    case 'ACTIVE':
      return ['deactivate'];
    case 'DEACTIVATED':
      // Both are real and they are NOT interchangeable: reactivate returns a
      // worker whose contract is still valid, trigger-reonboarding restarts
      // the gate for one whose contract expired. The server enforces which
      // applies (scenario 15); both are offered because a manager cannot
      // always know which from the record alone.
      return ['reactivate', 'trigger-reonboarding'];
    case 'REJECTED':
      return ['rehire', 'submit-for-review'];
    default:
      return [];
  }
}
