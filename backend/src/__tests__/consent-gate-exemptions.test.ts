// The anti-lockout / anti-bypass suite for the consent gate's exemption list.
//
// Two failure directions, both serious, and they pull against each other:
//   - Too few exemptions -> a gated worker cannot reach the notice, cannot
//     accept, and is locked out of the platform with no in-app recovery.
//   - Too many (or sloppily matched) -> a real data route is reachable
//     without consent, which is the control failing silently.
//
// `isConsentExempt` is a pure function precisely so both directions can be
// tested without booting Express.

import { readFileSync } from 'node:fs';

import {
  CONSENT_GATE_EXEMPT_PATHS,
  isConsentExempt,
} from '../middleware/consentGate.js';

describe('consent gate — exempt paths (anti-lockout)', () => {
  // Named individually rather than looped over the array: deleting an entry
  // must fail a test that says what was deleted, not silently shrink a loop.
  it.each([
    ['/consent', 'the escape hatch root'],
    ['/consent/status', 'read current consent state'],
    ['/consent/request', 'fetch the notice to display'],
    ['/consent/decisions', 'record the acceptance — without this, nobody can ever consent'],
    ['/consent/withdraw', 'self-scoped withdrawal'],
    ['/consent/audit-history', 'read back what was recorded'],
    ['/auth/login', 'pre-identity'],
    ['/auth/refresh', 'CRITICAL: 15m access tokens expire while the notice is on screen'],
    ['/auth/logout', 'a locked user must be able to leave'],
    ['/auth/me', 'client cannot render a role-aware gate without identity'],
    ['/auth/profile', 'carries preferred_language — the notice must be readable first'],
    ['/auth/password-reset', 'pre-identity; do not compound a lockout'],
    ['/health', 'deploy + CI health checks'],
    ['/status', 'deploy + CI health checks'],
  ])('%s is exempt (%s)', (path) => {
    expect(isConsentExempt(path)).toBe(true);
  });

  it('treats a trailing slash as the same path', () => {
    expect(isConsentExempt('/consent/')).toBe(true);
    expect(isConsentExempt('/auth/refresh/')).toBe(true);
  });

  it('exempts nested paths under an exempt prefix', () => {
    expect(isConsentExempt('/consent/anything/deeper')).toBe(true);
  });
});

describe('consent gate — gated paths (anti-bypass)', () => {
  it.each([
    ['/users', 'other people’s data'],
    ['/attendance', 'core worker surface'],
    ['/hr/payroll', 'payroll'],
    ['/documents', 'personal documents'],
    ['/notifications', 'not needed to consent'],
    ['/assignments', 'work data'],
    ['/quality', 'work data'],
    ['/calendar', 'work data'],
    ['/analytics', 'aggregate data'],
    ['/compliance', 'governance surface'],
  ])('%s is gated (%s)', (path) => {
    expect(isConsentExempt(path)).toBe(false);
  });

  // Prefix-confusion: the reason matching is segment-boundary, not a bare
  // startsWith. Each of these begins with an exempt string.
  it.each([
    '/consent-fake',
    '/consentXYZ',
    '/consent-audit',
    '/healthz',
    '/status-report',
    '/auth/mefirst',
    '/auth/profiles',
    '/auth/refresh-token-admin',
  ])('%s must NOT inherit an exemption', (path) => {
    expect(isConsentExempt(path)).toBe(false);
  });

  it('is case-sensitive', () => {
    // Express does not lowercase req.path; an uppercase variant would not
    // route to the consent module anyway, so it must not be exempt either.
    expect(isConsentExempt('/CONSENT/status')).toBe(false);
    expect(isConsentExempt('/Consent')).toBe(false);
  });

  it('does not exempt a traversal-looking path', () => {
    // Express normalizes these before req.path in practice; asserted on the
    // predicate directly so the intent survives any change to how the path
    // is derived.
    expect(isConsentExempt('/consent/../users')).toBe(false);
    expect(isConsentExempt('//consent')).toBe(false);
  });
});

describe('consent gate — the exemption list itself', () => {
  // A meta-test. Widening this list is the single highest-risk edit in the
  // feature, so it must be a deliberate, reviewed test change — never a
  // silent one that rides along with something else.
  it('contains exactly the reviewed set', () => {
    expect([...CONSENT_GATE_EXEMPT_PATHS].sort()).toEqual(
      [
        '/auth/login',
        '/auth/logout',
        '/auth/me',
        '/auth/password-reset',
        '/auth/profile',
        '/auth/refresh',
        '/consent',
        '/health',
        '/status',
      ].sort()
    );
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CONSENT_GATE_EXEMPT_PATHS)).toBe(true);
  });
});

describe('the flag default', () => {
  // The default is a deliberate, owner-approved decision (2026-08-18), not an
  // incidental value: the gate ships ON in the first version because there is
  // no older, gate-unaware client in the field to strand on a 403. Flipping it
  // either way changes whether every non-admin is blocked, so it must be a
  // conscious test change rather than a silent edit.
  //
  // Asserted against the source rather than getEnv(), which validates the
  // whole environment and cannot be constructed in isolation here. The value
  // is verified end-to-end against a live stack in
  // docs/10-testing/e2e/scenarios/11-daily-consent-gate.md.
  it('FEATURE_CONSENT_GATE is declared with a default of true', () => {
    const src = readFileSync('src/config/env.ts', 'utf8');
    expect(src).toContain('FEATURE_CONSENT_GATE: strictBooleanFlag(true)');
  });

  it('CONSENT_GATE_ROLES excludes admin at parse time', () => {
    // admin is filtered in env.ts AND checked again in the middleware. Two
    // layers deliberately: an unrecoverable platform needs someone left who
    // can turn the gate off.
    const src = readFileSync('src/config/env.ts', 'utf8');
    expect(src).toContain("r !== 'admin'");
  });
});
