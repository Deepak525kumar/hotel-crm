import {
  shouldGateOnboarding,
  isRouteAllowedWhileGated,
  ONBOARDING_ROUTE,
} from '@/lib/onboarding-gate-decision';

describe('shouldGateOnboarding', () => {
  it('lets an ACTIVE worker through', () => {
    expect(shouldGateOnboarding({ status: 'ACTIVE', role: 'worker' })).toBe(false);
  });

  it.each(['PENDING', 'DEACTIVATED', 'REJECTED', 'DELETED'])('gates a %s worker', (status) => {
    expect(shouldGateOnboarding({ status, role: 'worker' })).toBe(true);
  });

  it('never gates an admin, who holds no EmploymentRecord by design', () => {
    expect(shouldGateOnboarding({ status: null, role: 'admin' })).toBe(false);
    expect(shouldGateOnboarding({ status: 'PENDING', role: 'admin' })).toBe(false);
  });

  it.each([null, undefined, ''])('fails open on an unknown status (%p)', (status) => {
    // Failing open is deliberate: see the module comment. A missing field must
    // not brick the app for a user who has no way to resolve it.
    expect(shouldGateOnboarding({ status, role: 'worker' })).toBe(false);
  });
});

describe('isRouteAllowedWhileGated', () => {
  it.each([ONBOARDING_ROUTE, '/documents', '/settings'])('allows %s', (route) => {
    expect(isRouteAllowedWhileGated(route)).toBe(true);
  });

  it('allows sign-out to stay reachable via settings', () => {
    // Regression guard: gating someone out of settings would trap them in the
    // app with no way to sign out or switch language.
    expect(isRouteAllowedWhileGated('/settings')).toBe(true);
  });

  it.each(['/', '/marketplace', '/calendar', '/hr', '/ratings', '/job/abc'])(
    'blocks %s',
    (route) => {
      expect(isRouteAllowedWhileGated(route)).toBe(false);
    },
  );
});
