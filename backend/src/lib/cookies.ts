import { Response } from 'express';
import { getEnv } from '../config/env.js';
import { JwtTokens, parseExpiryToSeconds } from './jwt.js';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Security #4 (2026-08-09): shared flag set for both auth cookies, so
 * `setAuthCookies`/`clearAuthCookies` can never drift from each other --
 * `res.clearCookie()` silently no-ops unless its options exactly match what
 * `res.cookie()` set (Express keys the deletion cookie on the same
 * path/domain/sameSite/secure attributes).
 *
 * httpOnly is the entire point (closes the XSS localStorage-read
 * vulnerability this exists to fix) -- never make this conditional.
 * sameSite: 'lax' is safe specifically because the browser only ever talks
 * to the same-origin Next.js rewrite proxy (see frontend/next.config.ts);
 * this is NOT a cross-site cookie and does not need SameSite=None or a CSRF
 * token scheme.
 */
function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    domain: env.COOKIE_DOMAIN,
  };
}

/**
 * Sets both auth cookies alongside the existing JSON-body token response
 * (login/signup/refresh all keep returning tokens in the body too, for
 * mobile -- see auth/controller.ts). Mobile's bare `fetch()` clients ignore
 * `Set-Cookie` outright, so this is unconditional and needs no client-type
 * branching here.
 */
export function setAuthCookies(res: Response, tokens: JwtTokens): void {
  const env = getEnv();
  const options = cookieOptions();

  res.cookie(ACCESS_TOKEN_COOKIE, tokens.access_token, {
    ...options,
    maxAge: tokens.expires_in * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
    ...options,
    maxAge: parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY) * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  const options = cookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, options);
  res.clearCookie(REFRESH_TOKEN_COOKIE, options);
}
