# E2E Run — 2026-08-25 — checker-app login verification

- **Commit under test:** `0de3fe0` (branch `claude/checker-login-credentials-ewb7n8`)
- **Environment:** local dev, rebuilt from scratch in a fresh container (no pre-existing database)
- **Executed by:** agent (Claude Code), at the project owner's request
- **Stack versions:** backend on `tsx src/server.ts`, port 3001; PostgreSQL 16.13 (local cluster,
  not Docker — no Docker daemon in this container); Node 22.22.2; mobile apps not run as apps
  (see "Could not test")

**Scope:** one question — *can a CHECKER sign into the checker app with their credentials?* — NOT
a run of the numbered scenarios. Scenario rows are therefore blank rather than PASS. Recorded here
because the login result is worth keeping, and because the run raised a suspected defect in the
mobile test setup that turned out to be a locally-broken `node_modules` — writing down a disproved
defect is what stops the next session re-investigating the same dead end.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–12 | NOT RUN | Out of scope for this pass |
| — (ad-hoc) checker login | **PASS** | Real endpoints, real database, real client module — detailed below |
| — (ad-hoc) mobile test suites | NOT A DEFECT | Investigated after a local failure; the failure was self-inflicted (below) |

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

**None.** One suspected defect was investigated and **disproved** — recorded here in full because
the disproof is the useful part.

*The claim I initially made, and why it was wrong.* In this container `npx jest` in
`mobile/checker-app` aborted with a jest-expo validation error — `@react-native/jest-preset` not
found — before running a single test, in both mobile apps and for the `unit` project too. It is
declared in no `package.json`, so I concluded the `components` project was dead on a clean
checkout and "fixed" it by declaring the dependency.

*That was wrong, and here is the evidence.* `react-native@0.86.2` declares
`@react-native/jest-preset` as a **peer dependency**, and npm installs peers automatically. Checked
at the base commit `0de3fe0`, in a clean `git worktree` with no prior state:

| Install at base commit `0de3fe0` | `@react-native/jest-preset` present? | `npx jest --ci` |
|---|---|---|
| per-app `npm ci` in `mobile/checker-app` (what CI does) | yes | 18 suites, **150/150**, 2 projects |
| root workspace `npm ci --include=dev` | yes | 18 suites, **150/150**, 2 projects |

CI on `main` at that same commit agrees: job `Mobile · checker-app` logs
`Tests: 150 passed, 150 total` / `Ran all test suites in 2 projects`. **The suites were never dead,
in CI or on a clean checkout.** The change was reverted; the repository needed no fix.

*What actually broke my tree.* `--legacy-peer-deps`, which I reached for to get past an unrelated
peer conflict. That flag **disables automatic peer installation**, so it silently removed the
preset that `react-native` would otherwise have pulled in. Combined with the `NODE_ENV=production`
problem below — each partial install pruning the previous one's packages — it produced a tree no
clean checkout ever produces.

*The lesson worth keeping.* A tool failure in a hand-repaired `node_modules` is evidence about that
tree, not about the repository. Before filing a dependency defect, reproduce it in a clean worktree
and check what CI actually did on the base commit — both were one command away here, and either
would have caught this before it reached a PR description.

## Environment problems (not repository defects)

1. **`NODE_ENV=production` is set in this container image**, which makes `npm ci`/`npm install`
   silently skip **all** devDependencies — no `tsx`, no `jest`, no babel presets — so the backend
   cannot start and no suite can run until it is overridden:
   `NODE_ENV=development npm ci --include=dev`. Worth knowing before diagnosing anything else: it
   looks like a broken lockfile, and each partial install prunes the previous one's packages.
   **Do not reach for `--legacy-peer-deps` to escape it** — that disables automatic peer
   installation and cost this run a false defect report (above).

2. **No Docker daemon**, so scenario 00's `docker compose up -d postgres redis` does not apply.
   A local PostgreSQL 16 cluster (`pg_ctlcluster 16 main start`) served instead; Redis was not
   needed for this pass.

## Could not test

1. **The login screen as a running app on a device or simulator** — no Expo/Metro run, no
   emulator in this container. `login.tsx` was verified by reading it plus its component tests
   (`LoginInputs.test.tsx`, which covers the login inputs' autoCapitalize/autoCorrect settings);
   the store and transport beneath it were verified for real against the live backend, as described
   above. The rendered screen itself is a gap.
2. **Anything after the login screen** — `router.replace('/(app)')`, `AuthGuard`, and the daily
   consent gate a freshly-created checker meets on first entry (their `employment_status` is
   `PENDING`) were not exercised. Scenario 11 covers the consent gate; this run did not.
3. **Production/staging login** — every result here is against a local database seeded in this
   session. Nothing about the deployed environment was inspected.
4. **The seeded-user password drift** recorded as defect 5 of
   `2026-08-25-auth-and-push-verification.md` — this run built its own accounts on a fresh
   database and so neither confirms nor clears it.

## Scenario files updated this run

- `README.md` — ADR-070 login throttling removed from the "not yet exercised by any scenario" note,
  now pointing here. Its claim that the mobile jest configs collect only `*.test.ts` corrected: both
  apps now run a second `components` project over `*.test.tsx`, and it does run (150 tests in
  checker-app, 210 in worker-app, in CI and on a clean checkout).
