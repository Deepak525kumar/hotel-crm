// Daily GDPR consent gate (REQ-CONSENT-001/003, RULE-CONSENT-01/02/03).
//
// SPEC-CONSENT-001 splits this deliberately: the Consent module supplies the
// gating fact (`IF-CONSENT-CheckStatus`), and the *consuming* module enforces
// the block. Nothing enforced it -- `consent.tsx`'s own header comment said
// so ("not an access-blocking wall") -- so a worker could simply never open
// the consent screen and use the system all day. This middleware is that
// missing enforcement, and it is the only place it exists (RULE-CONSENT-09
// forbids a second gate).
//
// Mounted once at the v1 router so a newly added module is gated by default.
// The alternative -- per-module `router.use(consentGate)` -- is N edits that
// the N+1th module silently forgets, which is the wrong failure direction for
// a GDPR control.

import type { Request, Response, NextFunction } from 'express';

import { getConsentGateRoles, isConsentGateEnabled } from '../config/feature-flags.js';
import { ConsentRequiredError } from '../lib/errors.js';
import {
  cacheConsentGranted,
  hasCachedConsentGrant,
} from '../lib/consent-gate-cache.js';
import { logger } from '../lib/logger.js';
import {
  consentCalendarDate,
  consentService,
  currentNoticeVersion,
} from '../modules/consent/service.js';
import { CONSENT_INSTANCE } from '../modules/consent/types.js';

/**
 * Paths the gate must never block. Every entry is an escape hatch: without
 * it, a gated user has no way to reach the state where they stop being
 * gated. Adding to this list widens an unauthenticated-adjacent surface, so
 * `consent-gate-exemptions.test.ts` pins the exact contents -- a change here
 * must be a deliberate test change, never a silent one.
 *
 * Paths are relative to the /api/v1 mount (Express strips the prefix).
 */
export const CONSENT_GATE_EXEMPT_PATHS: readonly string[] = Object.freeze([
  // The escape hatch itself: fetch the notice, record the decision, read back
  // what was recorded. Exempting the whole subtree rather than four
  // individual paths keeps a future consent route from being gated by
  // accident -- and nothing under /consent exposes another worker's data
  // (every route is self-scoped, enforced in consent/service.ts).
  '/consent',

  // Pre-identity, so already passed through, but listed so the exemption
  // survives any future change to how identity is resolved here.
  '/auth/login',
  '/auth/password-reset',

  // CRITICAL. JWT_ACCESS_EXPIRY is 15m. A worker reading the notice before
  // deciding will routinely have their access token expire while the locked
  // screen is open. If refresh were gated, the client would receive a 403
  // where it expects a 401, never refresh, and the accept request would fail
  // -- a permanent lockout recoverable only by reinstalling the app.
  '/auth/refresh',

  // A locked user must always be able to leave.
  '/auth/logout',

  // The client cannot render a role-aware gate, or even tell whether the user
  // is an exempt admin, without reading identity. Also the mobile cold-start
  // path: gating it makes a consent-pending morning look like a dead session
  // and trips the client's credential-wipe branch.
  '/auth/me',

  // Carries `preferred_language`. The notice is served in the user's stored
  // language, so a worker shown a notice in a language they cannot read must
  // be able to change it *before* consenting. Gating this makes the notice
  // simultaneously unreadable and unchangeable -- for precisely the people
  // GDPR Art. 12(1)'s "clear and plain language" requirement protects.
  '/auth/profile',

  // Deploy scripts and CI health checks must never depend on any user's
  // consent state.
  '/health',
  '/status',
]);

/**
 * True when `path` is exempt from the gate.
 *
 * Segment-boundary matching, never a bare `startsWith`: `/consent-fake` and
 * `/consentXYZ` must NOT inherit `/consent`'s exemption. This is a security
 * boundary, so it is a pure exported function with its own bypass test suite.
 */
export function isConsentExempt(path: string): boolean {
  // Reject anything containing a traversal segment or a doubled slash
  // outright. Express normalizes these before `req.path` today, so this is
  // defence in depth rather than the primary control -- but an exemption
  // check must not depend on an upstream normalization staying true.
  if (path.includes('..') || path.includes('//')) return false;

  // Normalize a single trailing slash so `/consent/` matches `/consent`.
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return CONSENT_GATE_EXEMPT_PATHS.some((entry) => p === entry || p.startsWith(entry + '/'));
}

export async function consentGateMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // Flag off: do not even query consent state. "Both-off = current behavior".
  if (!isConsentGateEnabled()) {
    next();
    return;
  }

  if (isConsentExempt(req.path)) {
    next();
    return;
  }

  // No identity resolved. `optionalAuthMiddleware` leaves req.auth unset on
  // any failure, and each module then runs its own authMiddleware. Passing
  // through here lets that produce a 401 -- the correct precedence, since a
  // revoked token is an authentication problem, not a consent one. Genuinely
  // public routes also land here and are correctly unaffected.
  const auth = req.auth;
  if (!auth?.userId) {
    next();
    return;
  }

  const role = String(auth.role ?? '').toLowerCase();

  // Admin is never gated. This is a safety property, not just a scope
  // decision: if the gate ever misfires, someone must remain able to log in
  // and turn it off.
  if (role === 'admin') {
    next();
    return;
  }

  if (!getConsentGateRoles().includes(role)) {
    next();
    return;
  }

  const now = Date.now();
  const today = consentCalendarDate(new Date(now));
  const version = currentNoticeVersion();

  if (hasCachedConsentGrant(auth.userId, today, version, now)) {
    next();
    return;
  }

  try {
    const status = await consentService.checkStatus(
      auth.userId,
      CONSENT_INSTANCE.DAILY_ACCESS_GATE
    );

    // checkStatus returns 'granted' only for a record dated today AND
    // matching the current notice version, so this single comparison is the
    // whole gating condition. 'declined' and 'absent' both block.
    if (status.status === 'granted') {
      cacheConsentGranted(auth.userId, today, version, now);
      next();
      return;
    }

    next(new ConsentRequiredError());
  } catch (error) {
    // FAIL OPEN, deliberately -- do not "fix" this to fail closed.
    //
    // OD-CONSENT-006 resolved the module's posture as fail-closed, but that
    // is about *ambiguous consent state*: never infer a consent you do not
    // have. A database error is not ambiguity, it is unavailability. Failing
    // closed here means one DB blip locks every non-admin out of the entire
    // platform at once, including the managers who would respond to it.
    // frontend/hooks/useOnboardingLockout.ts makes the same call for the same
    // reason. The blocking control that matters is still intact: no consent
    // record is ever written by this path, so nothing is falsely recorded as
    // granted -- access is merely not blocked while the datastore is down.
    logger.error('consent_gate_check_failed', {
      userId: auth.userId,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    next();
  }
}
