import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { buildRouteRegistry } from './support/route-registry.js';

/**
 * Who may check in (2026-08-27).
 *
 * A checker works a shift like a worker does, and inspecting rooms is gated on
 * being checked in to it — so while `POST /attendance` was `requireRole(['worker'])`
 * the role that could not check in also could not start work. Widening the gate
 * grants nothing beyond that: `AttendanceService.checkIn()` refuses any assignment
 * whose `worker_id` is not the caller, so a checker can still only check into
 * their own shift.
 *
 * Asserted here rather than left to the generated route×role matrix, because that
 * matrix derives its expectations from these same route files — it would follow a
 * regression rather than catch one. This pins the intended role set explicitly, and
 * pins the exclusions too: a manager or admin does not work a shift and must not be
 * able to open one by checking in.
 */
describe('POST /attendance role gate', () => {
  const route = buildRouteRegistry().find(
    (r) => r.module === 'attendance' && r.method === 'POST' && r.path === '/',
  );

  it('is a gated route at all', () => {
    expect(route).toBeDefined();
    expect(route!.requiredRoles).not.toBeNull();
  });

  it.each(['worker', 'checker'])('admits %s — the roles that work a shift', (role) => {
    expect(route!.requiredRoles).toContain(role);
  });

  it.each(['manager', 'regional_manager', 'admin'])(
    'does not admit %s — a management role does not work a shift',
    (role) => {
      expect(route!.requiredRoles).not.toContain(role);
    },
  );
});
