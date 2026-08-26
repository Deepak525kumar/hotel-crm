import {
  shouldGateOnboarding,
  isRouteAllowedWhileGated,
  isGateOwnedRoute,
  ONBOARDING_ROUTE,
  shouldLeaveOnboarding,
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

describe('isGateOwnedRoute', () => {
  // Regression: a PENDING worker was redirected to /onboarding, signed out
  // from there (the sign-out button lives on that screen), and AuthGuard
  // captured returnTo=/onboarding. The next worker to sign in on the same
  // device -- ACTIVE, fully onboarded -- was sent to the onboarding screen
  // and could not leave it until the app was reloaded.
  it('treats gate destinations as not-returnable', () => {
    expect(isGateOwnedRoute('/onboarding')).toBe(true);
    expect(isGateOwnedRoute('/consent')).toBe(true);
  });

  it('treats routes the worker chose as returnable', () => {
    expect(isGateOwnedRoute('/shifts')).toBe(false);
    expect(isGateOwnedRoute('/documents')).toBe(false);
    expect(isGateOwnedRoute('/settings')).toBe(false);
    expect(isGateOwnedRoute('/shift/abc-123')).toBe(false);
  });

  // `/onboarding-summary` must not match on a bare prefix compare.
  it('does not match a route that merely starts with the same characters', () => {
    expect(isGateOwnedRoute('/onboarding-summary')).toBe(false);
    expect(isGateOwnedRoute('/consent-history')).toBe(false);
  });

  it('matches nested routes under a gate destination', () => {
    expect(isGateOwnedRoute('/onboarding/step-2')).toBe(true);
  });
});

describe('shouldLeaveOnboarding', () => {
  it('sends an ACTIVE worker off the onboarding screen', () => {
    expect(shouldLeaveOnboarding({ status: 'ACTIVE', role: 'worker', pathname: '/onboarding' })).toBe(true);
  });

  it('leaves a PENDING worker where they belong', () => {
    expect(shouldLeaveOnboarding({ status: 'PENDING', role: 'worker', pathname: '/onboarding' })).toBe(false);
  });

  // Mutually exclusive with shouldGateOnboarding by construction -- if both
  // could be true for one state, AuthGuard would ping-pong between routes.
  it('is never true at the same time as shouldGateOnboarding', () => {
    for (const status of ['ACTIVE', 'PENDING', 'REJECTED', 'DEACTIVATED', 'DELETED', null, undefined, '']) {
      for (const role of ['worker', 'admin']) {
        const gate = shouldGateOnboarding({ status, role });
        const leave = shouldLeaveOnboarding({ status, role, pathname: '/onboarding' });
        expect(gate && leave).toBe(false);
      }
    }
  });

  it('does nothing on any other route', () => {
    expect(shouldLeaveOnboarding({ status: 'ACTIVE', role: 'worker', pathname: '/shifts' })).toBe(false);
    expect(shouldLeaveOnboarding({ status: 'ACTIVE', role: 'worker', pathname: '/onboarding-summary' })).toBe(false);
  });

  // Unknown status fails open in shouldGateOnboarding, so it must also mean
  // "not gated" here -- otherwise a transient missing field strands the user.
  it('treats an unknown status as not gated', () => {
    expect(shouldLeaveOnboarding({ status: undefined, role: 'worker', pathname: '/onboarding' })).toBe(true);
  });
});
