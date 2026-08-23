# ADR-071: Dual-Transport Authentication — httpOnly Cookies for Web, Bearer Tokens for Mobile

- **Status:** **Proposed** — authored retroactively 2026-08-23 to record a model that has been live
  since 2026-08-09. Ratification is reserved human authority (Constitution §12) and is **not**
  claimed here. The precedent for a retroactive record is `ADR-061`, authored during a
  documentation-synchronization pass after the code it describes had already shipped.
- **Date:** 2026-08-23 (describes behaviour shipped 2026-08-09, PR #391/#394)
- **Scope:** `SPEC-AUTH-001`; `backend/src/lib/cookies.ts`; `backend/src/middleware/auth.ts`;
  `backend/src/modules/auth/controller.ts`; `frontend/next.config.ts` rewrite proxy.
- **Supersedes:** none. **Amends:** nothing frozen. `SPEC-AUTH-001` was silent on transport — it
  contained no occurrence of the word "cookie" — so this record fills a gap rather than reversing a
  decision. The as-built behaviour is described in that spec's Status Addendum (2026-08-22).
- **Change class:** Architecture decision, recorded retroactively. No behaviour change.

## 1. Context

Security hardening item #4 (2026-08-08/09) moved the web client off `localStorage` token storage,
which was readable by any successful XSS. The obvious fix — httpOnly cookies — cannot be applied
uniformly, because the two mobile applications use bare `fetch()` clients that ignore `Set-Cookie`
outright and have no cookie jar to send back.

The change shipped as part of a security batch rather than through a Decision Record. Its reasoning
survived only as comments in `lib/cookies.ts` and `middleware/auth.ts` — unusually complete
comments, but not a governance artifact, and not discoverable from any specification. This record
exists because the next client surface to be built is the Chatbot's (a web widget plus two mobile
screens), and it would otherwise have to rediscover all of this from the middleware.

## 2. Decision

Serve **both** transports unconditionally on every authentication response. No client-type branching
on the server.

| | Web | Mobile |
|---|---|---|
| Access token | `access_token` httpOnly cookie | `Authorization: Bearer` header |
| Refresh token | `refresh_token` httpOnly cookie, no body | `refresh_token` in the JSON body |

Login, signup and refresh all set cookies *and* return tokens in the JSON body. Mobile ignores the
`Set-Cookie`; web ignores the body tokens. Unconditional issuance is what removes the need for the
server to know what kind of client it is talking to.

**Precedence differs by token, in opposite directions, and both directions are deliberate:**

- **Access token — the header wins** (`middleware/auth.ts:17-21`). An explicit credential must never
  be silently shadowed by an ambient cookie. This also guarantees the change could not alter mobile
  behaviour, since mobile never sends the cookie.
- **Refresh token — the cookie wins** (`auth/controller.ts:17`). Web sends only the cookie and no
  body at all; mobile sends only the body and never has the cookie. The two cases are disjoint in
  practice, so precedence here is a tie-break that should never fire.

## 3. Cookie attributes, and the CSRF posture this depends on

Set by `cookieOptions()` in `backend/src/lib/cookies.ts`:

| Attribute | Value |
|---|---|
| `httpOnly` | `true`, unconditional — never make this conditional; it is the entire point |
| `secure` | `NODE_ENV === 'production'` |
| `sameSite` | `'lax'` |
| `path` | `'/'` |
| `domain` | `env.COOKIE_DOMAIN` (optional) |

**`SameSite=Lax` is sufficient, and no CSRF token scheme is required, only because the browser never
talks to the API cross-origin.** `frontend/next.config.ts` rewrites `/api/:path*` to the internal
backend, so every request the browser makes is same-origin. These are not cross-site cookies.

**This is the constraint most likely to be violated by accident.** If any future client calls the
API cross-origin — a separately-hosted chat widget, a partner integration, a native app using a web
view against the public API — the reasoning above does not carry over and a CSRF defense must be
designed before that client ships. It is recorded as a decision, not an implementation detail, for
that reason.

`setAuthCookies` and `clearAuthCookies` deliberately share one options object: `res.clearCookie()`
silently no-ops unless its attributes exactly match those used to set the cookie, so drift between
the two would produce a logout that does not log out.

## 4. Consequences

- The web client can no longer read its own tokens from JavaScript. Anything that needs token
  *contents* client-side must obtain them from an API response, not from storage.
- Two transports mean two code paths for any future auth change; the shared `cookieOptions()` and
  the single `resolveAccessToken()` seam are what keep that bounded.
- Mobile retains bearer tokens and therefore retains the storage exposure that motivated the change
  on web. Whether mobile token storage needs its own hardening is **not decided here** and is
  recorded as an open item.

## 5. Open items

| ID | Item | Status |
|---|---|---|
| `OD-AUTH-T1` | Ratification of this record | **OPEN** — reserved human authority |
| `OD-AUTH-T2` | CSRF design for any cross-origin client | **OPEN** — blocks any such client, including a separately-hosted chatbot widget |
| `OD-AUTH-T3` | Mobile token-storage hardening | **OPEN** — not assessed |

## 6. Non-goals

Token lifetime, refresh rotation, revocation (`ADR-031`), algorithm pinning, and login throttling
(`ADR-070`) are all settled elsewhere and unaffected. This record is about transport only.
