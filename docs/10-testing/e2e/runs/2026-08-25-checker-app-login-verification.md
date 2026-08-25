# E2E Run — 2026-08-25 — checker-app login verification

- **Commit under test:** `0de3fe0` (branch `claude/checker-login-credentials-ewb7n8`)
- **Environment:** local dev, rebuilt from scratch in a fresh container (no pre-existing database)
- **Executed by:** agent (Claude Code), at the project owner's request
- **Stack versions:** backend on `tsx src/server.ts`, port 3001; PostgreSQL 16.13 (local cluster,
  not Docker — no Docker daemon in this container); Node 22.22.2; mobile apps not run as apps
  (see "Could not test")

**Scope:** one question — *can a CHECKER sign into the checker app with their credentials?* — NOT
a run of the numbered scenarios. Scenario rows are therefore blank rather than PASS. Recorded here
because the run also found a defect that makes both mobile test suites unrunnable from a clean
checkout, which is exactly the class of thing this suite exists to stop being rediscovered.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–12 | NOT RUN | Out of scope for this pass |
| — (ad-hoc) checker login | **PASS** | Real endpoints, real database, real client module — detailed below |
| — (ad-hoc) mobile test suites | **FAIL → FIXED** | Both apps' `npm test` aborted before running a single test; fixed in this pass |

### Checker login — PASS, verified at the data layer

The account under test was created through the **real** `POST /users` path by a real MANAGER
(`e2e-mgr@test.local`), not seeded — so the password hash under test was written by application
code. Login was then exercised over HTTP against the running backend.

| Check | Result |
|---|---|
| `POST /auth/login`, correct password | 200; access + refresh token returned |
| `role` in the response body | `"checker"` (lower-cased server-side by `auth/service.ts`) |
| Role passes the app's own gate | `ALLOWED_ROLES` in `mobile/checker-app/src/constants/app-config.ts` contains `checker` — no casing mismatch |
| `GET /auth/me` with the access token | 200, same user |
| `GET /auth/me`, no token / tampered token | 401 / 401 |
| Mixed-case email (`E2E-Checker@Test.Local`) | 200 — normalized by the zod layer (`.toLowerCase()`) *and* client-side in `auth-store.login()` |
| `POST /auth/login`, wrong password | 401 `Invalid credentials` |

Data-layer verification (`psql`, not the API response):

- `User.role = CHECKER`, `is_active = t`, `password_hash` begins `$2a$12$` (real bcrypt, cost 12).
- `Session` rows created — one per successful login.
- `AuditLog`: `LOGIN` per success, `LOGIN_FAILED` with `details->>'reason' = 'invalid_password'`
  per failure.
- `User.failed_login_count` incremented on the failed attempt and **reset to 0** by the next
  successful login, per TREQ-AUTH-007.

**ADR-070 login throttle, exercised for the first time** (the README notes it landed after the
newest run log and was covered by no scenario). Against a second checker account: attempts 1–10
returned 401, attempt 11 returned **429 `RATE_LIMIT_EXCEEDED`** with `Retry-After: 900`, and
`login_locked_until` was set in the database. The **correct** password also returned 429 during
the window — i.e. the throttle is enforced before the bcrypt comparison, as ADR-070 §3 specifies.
Threshold fires at exactly 10 (`AUTH_LOGIN_THROTTLE_THRESHOLD` default), above the notify
threshold of 5.

**The checker app's own client module was run against the live backend**, not just the API by
curl: `mobile/checker-app/src/lib/api.ts` imports only types, so it executes unmodified under
`tsx`. Driving it exactly as `auth-store.login()` does (trim + lowercase → `api.auth.login`):
tokens returned, `{status,data}` envelope correctly unwrapped, `api.auth.me()` round-tripped,
wrong password surfaced as `ApiError` status 401, and the throttled account surfaced as
`ApiError` status 429 with `retryAfterSeconds` parsed from `Retry-After` — which is the value
`login.tsx` renders in `auth.tooManyAttemptsRetry`.

**Conclusion: yes, a checker can sign in with their credentials.** No defect was found in the
login path, on either side.

## New defects found

1. **Both mobile apps' test suites could not run at all from a clean install** —
   `jest.config.js`'s `components` project uses `preset: 'jest-expo/ios'`, and `jest-expo`
   requires the peer dependency `@react-native/jest-preset`, which was declared in **no**
   `package.json` and was **absent from `package-lock.json`**. `npx jest` aborted with a
   `Validation Error` before running a single test — so **zero** tests ran, `unit` project
   included, in `mobile/checker-app` *and* `mobile/worker-app`. **High.** Fixed in this pass:
   `@react-native/jest-preset: 0.86.2` added to both apps' `devDependencies` and to the lockfile.
   Verified by deleting `node_modules`, re-running `npm ci --include=dev` from the committed
   lockfile, and getting 150/150 (checker) and 210/210 (worker) tests green.

   This matters more than a missing dependency usually would. The `components` project exists
   *because* the 2026-08-25 mobile flow verification found five defects living in `.tsx` files
   that no test could reach. One of the tests it unblocks, `LoginInputs.test.tsx`, guards the
   `autoCapitalize="none"` fix on the password field — the bug where iOS silently upper-cased the
   first character of a typed password and login failed with "Invalid credentials" on correct
   credentials. That guard was not running.

2. **`NODE_ENV=production` is set in the container image**, which makes `npm ci`/`npm install`
   silently skip **all** devDependencies — no `tsx`, no `jest`, no babel presets — so the backend
   cannot start and no suite can run until it is overridden (`NODE_ENV=development npm ci
   --include=dev`). **Environment issue, not a repository defect**, but it costs a lot of time to
   diagnose because the failure looks like a broken lockfile, and each partial install prunes the
   previous one's packages.

## Could not test

1. **The login screen as a running app on a device or simulator** — no Expo/Metro run, no
   emulator in this container. `login.tsx` was verified by reading it plus its component tests
   (`LoginInputs.test.tsx`, which now runs); the store and transport beneath it were verified for
   real against the live backend, as described above. The rendered screen itself is a gap.
2. **Anything after the login screen** — `router.replace('/(app)')`, `AuthGuard`, and the daily
   consent gate a freshly-created checker meets on first entry (their `employment_status` is
   `PENDING`) were not exercised. Scenario 11 covers the consent gate; this run did not.
3. **Production/staging login** — every result here is against a local database seeded in this
   session. Nothing about the deployed environment was inspected.
4. **The seeded-user password drift** recorded as defect 5 of
   `2026-08-25-auth-and-push-verification.md` — this run built its own accounts on a fresh
   database and so neither confirms nor clears it.

## Scenario files updated this run

- `README.md` — ADR-070 login throttling removed from the "not yet exercised by any scenario"
  note, now pointing here; a note added that the mobile suites were unrunnable and since fixed.
