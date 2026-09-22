import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// The pure module, not push-notifications: that one imports the shared
// barrel and drags the component tree into a node-environment test.
import { resolvePushTapRoute } from '@/lib/push-routes';

/**
 * Every push destination resolves to a real screen.
 *
 * This file arrived as a copy of worker-app's and its map still pointed at
 * `/offer/:id`, `/rework/:id` and `/shift/:id` — three routes that do not
 * exist in this app. Tapping such a notification would have navigated
 * nowhere, and nothing caught it: `route-targets-exist.test.ts` walks
 * `src/app`, so a route string living in `src/lib` is invisible to it. That
 * is the third distinct dead-link class found in this app, after the More
 * menu and AuthGuard's redirect.
 *
 * The route table is rebuilt from the filesystem here rather than imported,
 * so this stays true when screens move.
 */
const APP = join(__dirname, '..', 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const routes = new Set(
  walk(APP)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) =>
      f
        .slice(APP.length)
        .replace(/\.tsx$/, '')
        .replace(/\/\([^)]+\)/g, '')
        .replace(/\/index$/, '')
        .replace(/\[[^\]]+\]/g, ':param')
    )
    .map((r) => (r === '' ? '/' : r))
);

const normalise = (target: string) =>
  target
    .split('?')[0]
    .replace(/\/\([^)]+\)/g, '')
    .replace(/\/(c[a-z0-9]{20,}|[0-9a-f-]{36}|abc123)$/, '/:param')
    .replace(/\/$/, '') || '/';

/** The manager-directed types the backend actually fans out. */
const CASES: { type: string; data?: Record<string, unknown> }[] = [
  { type: 'APPLICATION_RECEIVED' },
  { type: 'ONBOARDING_SUBMITTED' },
  { type: 'WORKER_NO_SHOW', data: { attendance_id: 'abc123' } },
  { type: 'HR_PAYSLIP_REQUESTED' },
  { type: 'HR_PAYSLIP_REQUEST_ESCALATED' },
  { type: 'HR_CONTRACT_EXPIRY_REMINDER', data: { user_id: 'abc123' } },
  { type: 'CALENDAR_ABSENCE_MARKED' },
  { type: 'JOB_REQUEST_CLOSED', data: { work_request_id: 'abc123' } },
  { type: 'QUALITY_RATING_WARNING_50', data: { assignment_id: 'abc123' } },
  { type: 'REWORK_OVERDUE', data: { assignment_id: 'abc123' } },
];

describe('push tap routing', () => {
  it('found the route tree (guards the walker itself)', () => {
    expect(routes.size).toBeGreaterThan(10);
  });

  it.each(CASES)('$type opens a screen that exists', ({ type, data }) => {
    const route = resolvePushTapRoute({ type, ...(data ?? {}) });
    expect(routes.has(normalise(route))).toBe(true);
  });

  // A worker-facing type on a manager's device is not expected, but must not
  // navigate to a route this app cannot render.
  it('an unknown or worker-facing type falls back to the notification list', () => {
    expect(resolvePushTapRoute({ type: 'JOB_REQUEST_BROADCAST' })).toBe('/notifications');
    expect(resolvePushTapRoute({ type: 'REWORK_REQUIRED' })).toBe('/notifications');
    expect(resolvePushTapRoute(undefined)).toBe('/notifications');
    expect(resolvePushTapRoute({})).toBe('/notifications');
  });

  // A type whose id is missing must not build '/attendance/undefined'.
  it('falls back when the id the route needs is absent', () => {
    expect(resolvePushTapRoute({ type: 'WORKER_NO_SHOW' })).toBe('/notifications');
    expect(resolvePushTapRoute({ type: 'JOB_REQUEST_CLOSED' })).toBe('/notifications');
  });
});
