# ADR-070: Bounded Per-Account Login Throttle (Defense-in-Depth Alongside Edge Rate Limiting)

- **Status:** Accepted — ratified by the commissioning human on 2026-08-21, choosing "add
  per-account app-layer throttling too" after being shown that edge-level (Nginx) rate limiting
  already satisfies `TREQ-AUTH-008` and is IP-keyed only, with the tradeoff (amending a frozen
  requirement) stated in the question.
- **Date:** 2026-08-21
- **Scope:** `SPEC-AUTH-001` `TREQ-AUTH-008`, `REQ-AUTH-021`; `AuthService.login`/`recordFailedLogin`
  (`backend/src/modules/auth/service.ts`); `User.login_locked_until` (`schema.prisma`).
- **Supersedes:** none. **Amends:** `SPEC-AUTH-001` `TREQ-AUTH-008` ("no rate-limiting... is
  introduced at the application layer") — narrowed, not reversed; see §2. Does **not** amend
  `TREQ-AUTH-007` ("no account lockout... instead notify the manager") — see §3 for why this is
  throttling, not lockout, and why both requirements now coexist.
- **Change class:** Product + architecture decision amending a Confirmed target-state requirement.
  Requires human ratification per Constitution G2/§12; obtained in-session, recorded here rather
  than applied silently.

---

## 1. Context

A 2026-08-21 audit flagged "no rate limiting on login or password-reset" as a brute-force
exposure. Investigation found this absence is deliberate and already mitigated, not an oversight:

- `TREQ-AUTH-008` (Confirmed authority, CONFIRMED §2:34-35; PIVOT §5.2:160,163) states rate
  limiting is handled at the Nginx/Cloudflare edge, outside the auth module.
- `ADR-031` D-6 built this: `nginx/hotelcrm.conf` has IP-keyed `limit_req_zone`s, with the
  strictest zone (`auth_strict`, 1 req/s, burst 5) specifically covering `login` and
  `password-reset/confirm` — "the credential-guessing/reset-token-grinding surfaces."
  Tracked and closed as `SIR-AUTH-018`.
- The one gap `SIR-AUTH-018` explicitly left open, not silently: per-account throttling
  (`ADR-031 §10 OI-3a`) — the edge control is IP-keyed only, so a distributed attacker (many
  IPs, one target account) is unthrottled at the edge.

The commissioning human, shown this tradeoff, asked for per-account throttling as defense-in-depth
alongside the existing edge control, not instead of it. This ADR authorizes and specifies that.

## 2. Decision

**`TREQ-AUTH-008` is narrowed, not reversed.** The application layer gains exactly one new
control: after `AUTH_LOGIN_THROTTLE_THRESHOLD` (default 10) consecutive failed login attempts
against one account, that account's login is temporarily throttled — attempts are rejected with
`429 RATE_LIMIT_EXCEEDED` and a `Retry-After` header — for `AUTH_LOGIN_THROTTLE_DURATION_MS`
(default 15 minutes) from the throttling attempt, then automatically resumes accepting attempts.
No CAPTCHA, no manual unlock step, and no other endpoint (`signup`, `refresh`,
`password-reset` request/confirm) gains an application-layer control — those remain covered by
the edge zones only, per `TREQ-AUTH-008` as originally written. This is intentionally the single
highest-value gap `SIR-AUTH-018`/`OI-3a` named, not a general reopening of the "no app-layer
rate-limiting" decision.

The throttle threshold (10) is deliberately set above the existing notify threshold
(`AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD`, default 5, `TREQ-AUTH-007`): the manager notification still
fires first, unaffected, at 5; throttling only engages if the attack continues past that point.

## 3. Why this does not amend `TREQ-AUTH-007`

`TREQ-AUTH-007`'s confirmed shape is "no account lockout... instead notify the manager." A
*lockout* in that requirement's sense is a state requiring a human/manual action to clear (a
disabled/frozen account). This decision is not that:

- It is **automatic and time-bounded** — the account resumes accepting login attempts the moment
  `login_locked_until` elapses, with no admin action, no support ticket, and no manager
  intervention required.
- It does **not** set `is_active = false` or otherwise touch account state outside the throttle
  window itself.
- The manager notification at the threshold-of-5 (`TREQ-AUTH-007`) is unchanged and still the
  sole *alerting* mechanism; throttling is a *rate* control, not a notification substitute.

The two requirements now compose: notify (at 5) always fires first and never blocks; throttle (at
10, only if the attack continues) delays but does not permanently deny.

## 4. Implementation

- **Schema:** `User.login_locked_until DateTime?` — set when the failure streak crosses the
  throttle threshold; read at the top of `login()` before the password check; cleared alongside
  `failed_login_count`/`failed_login_since` on any successful login.
- **`AuthService.login`:** if `login_locked_until` is in the future, throw a new
  `TooManyRequestsError` (429, `RATE_LIMIT_EXCEEDED`) immediately — before the `bcrypt.compare`
  call, so a throttled account does not pay (or leak timing on) the password-hash cost.
- **`AuthService.recordFailedLogin`:** after incrementing the counter, if the new count is exactly
  the throttle threshold, additionally set `login_locked_until = now + AUTH_LOGIN_THROTTLE_DURATION_MS`
  in the same update. Fires once per streak (`=== threshold`, mirroring the existing notify logic),
  not on every attempt past it — an attacker hammering past the threshold does not get the window
  extended indefinitely by each additional attempt within it; only a fresh streak (after a
  successful login resets the counter) can trigger the throttle again.
- **Response:** the existing generic `'Invalid credentials'`/404-shaped responses stay unchanged
  for the not-throttled path (no new user-existence oracle). The throttled path returns a distinct
  429 rather than 401, matching the edge zone's own `limit_req_status 429` convention, with a
  `Retry-After` header computed from the remaining throttle window.

## 5. Disclosed risk: this reopens a narrow account-existence oracle

`AuthService.login`'s not-found and wrong-password branches deliberately return a
byte-identical `401 UNAUTHORIZED`/`'Invalid credentials'` so that probing an email address
cannot confirm an account exists (see the code's own comment on that symmetry, predating this
ADR). This decision's `429` response breaks that symmetry for one narrow case: an attacker who
sends `AUTH_LOGIN_THROTTLE_THRESHOLD` (10) wrong-password attempts against one email and then
receives `429` instead of `401` has thereby confirmed the account exists (a nonexistent email
always short-circuits at the `findUnique` check and never reaches `recordFailedLogin`, so it can
never accumulate a streak or throttle).

This is accepted, not fixed, for two reasons: first, the Nginx edge zone (§1) already bounds the
attacker to roughly one request/second on this path, so confirming one candidate email costs on
the order of 10+ seconds — enumerating any meaningful list is impractical, unlike a synchronous,
unthrottled oracle; second, collapsing the `429` back into the generic `401` would defeat the
actual purpose of this decision (`Retry-After`-driven client backoff — already consumed by
`frontend/lib/api.ts`, `mobile/{worker,checker}-app/src/lib/api.ts`'s existing 429 handling)
without closing the oracle either, since response *timing* alone (the throttle check short-circuits
before the `bcrypt.compare` cost) would still leak the same one bit. If this residual gap becomes
unacceptable, the fix is a rate-limited, generic-response CAPTCHA challenge at the threshold
rather than a distinguishable status code — a larger change, deliberately out of this decision's
scope.

## 6. Non-goals

- No per-account throttling on `signup`, `refresh`, or `password-reset` (request/confirm) — the
  audit's stated concern was login/password-reset guessing; password-reset request is already
  bounded to one standing token per account (`HOTFIX-AUTH-002`) and confirm requires possessing
  that token, so the marginal value of a second app-layer control there is materially lower than
  on `login`, and is left for a future decision if a concrete need arises.
- No CAPTCHA, no device fingerprinting, no exponential backoff (a fixed window was chosen for
  auditability and to keep `recordFailedLogin`'s existing "increment, single write" concurrency
  shape unchanged).
- No change to the edge-level Nginx configuration — it remains the IP-keyed, first-line control;
  this is an additional, narrower, account-keyed control layered behind it.
