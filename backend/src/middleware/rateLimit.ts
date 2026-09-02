import rateLimit from 'express-rate-limit';
import { getEnv } from '../config/env.js';
import { TooManyRequestsError } from '../lib/errors.js';

// IP-keyed rate limiting for the two auth endpoints with no other layer of
// defense against a spray attack (security-audit item #6, 2026-09-03).
//
// This is deliberately NOT the same defense as ADR-070's per-account login
// throttle (auth/service.ts) -- that one is keyed on `User.login_locked_until`
// and bounds repeated attempts against ONE account regardless of source IP.
// This one is keyed on the caller's IP and bounds repeated attempts from ONE
// source, regardless of which account(s) they target -- ADR-070's own
// comment names this exact blind spot ("a distributed, many-IPs-one-account
// attacker bypasses [it]"; the inverse, many-accounts-one-IP, was the actual
// gap, with nothing catching it at all). The two are complementary, not
// redundant: an attacker has to be bounded by BOTH, and defeating one gains
// nothing against the other.
//
// Both throw the app's own TooManyRequestsError via the `handler` option
// rather than using express-rate-limit's default response, so a 429 from
// here looks identical to a 429 from ADR-070's own throttle -- same envelope
// (errorHandler.ts), same Retry-After header convention -- and a client
// never has to special-case which layer rejected it.
function authRateLimiter(max: number, name: string) {
  const windowMs = getEnv().AUTH_RATE_LIMIT_WINDOW_MS;
  return rateLimit({
    windowMs,
    max,
    // Required so Retry-After (seconds) can be computed below; express-rate-
    // limit's own headers are suppressed (standardHeaders/legacyHeaders both
    // off) since the app already has its own Retry-After convention and two
    // competing sets of rate-limit headers would be confusing, not helpful.
    standardHeaders: false,
    legacyHeaders: false,
    // Keyed on req.ip (Express's own resolution of the TCP peer address --
    // verified against the real deployment that nothing sits in front of
    // this backend as a reverse proxy, so there is no X-Forwarded-For to
    // trust and `trust proxy` is deliberately left unset; enabling it
    // without a real proxy in front would let a client spoof its own IP via
    // that header and defeat this limiter entirely).
    handler: (_req, _res, next) => {
      const retryAfterSeconds = Math.ceil(windowMs / 1000);
      next(
        new TooManyRequestsError(
          `Too many ${name} attempts from this address. Please try again later.`,
          retryAfterSeconds
        )
      );
    },
  });
}

export function loginRateLimit() {
  return authRateLimiter(getEnv().AUTH_LOGIN_RATE_LIMIT_MAX, 'login');
}

export function passwordResetRateLimit() {
  return authRateLimiter(getEnv().AUTH_PASSWORD_RESET_RATE_LIMIT_MAX, 'password-reset');
}
