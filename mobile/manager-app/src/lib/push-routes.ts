/**
 * Where a tapped push notification takes a manager.
 *
 * Extracted from `push-notifications.ts` so it can be tested: that module
 * imports the shared package's barrel, which pulls the whole React Native
 * component tree into a node-environment unit test. This file imports
 * nothing, which is the point — routing is pure logic and the dead links it
 * used to contain were exactly the kind a test would have caught.
 */

export function resolvePushTapRoute(data: Record<string, unknown> | undefined | null): string {
  /**
   * MANAGER routes, not worker-app's.
   *
   * This file arrived here as a copy, and its map still pointed at
   * `/offer/:id`, `/rework/:id` and `/shift/:id` -- three routes that do not
   * exist in this app. Tapping such a push would have navigated nowhere at
   * all, and nothing caught it: `route-targets-exist.test.ts` walks
   * `src/app`, so a route string living in `src/lib` is invisible to it.
   * `push-routes.test.ts` now asserts every destination below resolves.
   *
   * The types are the manager-directed ones the backend already fans out
   * (`NotificationType`); a worker-facing type reaching a manager's device is
   * not expected, and falls through to the list rather than to a route the
   * app cannot render.
   */

  // An application needs reviewing. The queue is the whole job, and it is
  // scoped server-side, so no id is needed to open the right one.
  if (data?.type === 'APPLICATION_RECEIVED' || data?.type === 'ONBOARDING_SUBMITTED') {
    return '/review-queue';
  }

  // Somebody did not turn up. Opens that attendance record, because the
  // manager's next action is to set a status on it.
  if (data?.type === 'WORKER_NO_SHOW' && typeof data.attendance_id === 'string') {
    return `/attendance/${data.attendance_id}`;
  }

  // Payslip requests: the queue, not a detail screen -- fulfilling is a
  // one-tap action on the row and a manager usually has several waiting.
  if (data?.type === 'HR_PAYSLIP_REQUESTED' || data?.type === 'HR_PAYSLIP_REQUEST_ESCALATED') {
    return '/payslips';
  }

  // A contract is expiring. Opens the person, where the contract action is.
  if (data?.type === 'HR_CONTRACT_EXPIRY_REMINDER' && typeof data.user_id === 'string') {
    return `/team/${data.user_id}`;
  }

  // Someone marked themselves absent. Opens the rota, where the gap now is.
  if (data?.type === 'CALENDAR_ABSENCE_MARKED') {
    return '/(app)/calendar';
  }

  if (data?.type === 'JOB_REQUEST_CLOSED' && typeof data.work_request_id === 'string') {
    return `/request/${data.work_request_id}`;
  }

  // Quality warnings and rework escalations are read-only for a manager
  // (quality:write is Checker-only), so they open the assignment rather than
  // any rating screen.
  if (
    (data?.type === 'QUALITY_RATING_WARNING_50' || data?.type === 'REWORK_OVERDUE') &&
    typeof data.assignment_id === 'string'
  ) {
    return `/assignment/${data.assignment_id}`;
  }

  return '/notifications';
}
