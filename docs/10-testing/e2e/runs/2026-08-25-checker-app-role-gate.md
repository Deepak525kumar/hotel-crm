# E2E Run — 2026-08-25 — checker-app role gate on sign-in

- **Commit under test:** `e46c4bb` (branch `claude/checker-app-auth-access-1ra86h`)
- **Environment:** local dev container; jest only. The Expo apps were not run as apps and no
  backend or database was started, so nothing below is verified at the data layer.
- **Executed by:** agent (Claude Code), at the project owner's report that a WORKER account could
  reach the checker app.
- **Scope:** one question — *can an account whose role the checker app does not serve obtain a
  session in it?* NOT a run of the numbered scenarios.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–12 | NOT RUN | Out of scope for this pass |
| — (ad-hoc) checker-app role gate | **DEFECT FOUND, FIXED** | Static reading + unit tests; see below |

## Defect — a WORKER could hold a checker-app session

`ALLOWED_ROLES` in `mobile/checker-app/src/constants/app-config.ts` has always excluded `worker`,
but the only place that consulted it was the login *screen*
(`src/app/(auth)/login.tsx`), after `await login(...)` had already populated the auth store. Two
ways through:

1. **Session restore.** `useAuthStore.initialize()` reads the stored tokens, calls `api.auth.me()`
   and sets `user` with no role check at all. A session that got in once — by any route, including
   the race below — is restored on every subsequent launch, permanently, without ever passing the
   screen's check.
2. **The screen's check races the guard.** `login()` sets `user`, which is exactly what
   `AuthGuard` watches; its effect navigates into `(app)` as soon as a user exists. The screen's
   `logout()` then runs behind a network round-trip. The account is inside the app in the
   meantime.

**Fix:** the gate moved into `src/stores/auth-store.ts`, which is the one place every session
passes through. `login()` now checks the role *before* the store is populated, revokes the tokens
the backend just issued, and throws `RoleNotAllowedError`; `initialize()` applies the same check to
a restored session and discards it (tokens cleared from the API module and from storage). The
screen no longer role-checks — it only translates `RoleNotAllowedError` into `auth.noAppAccess`.

## Evidence

`mobile/checker-app`, `jest`: `src/__tests__/auth-store.test.ts` — 15 passed, including four new
`role gate` cases (login refused and nothing persisted; refused even when the revoking `logout()`
call throws; a stored `worker` session not restored; `checker` still admitted).
`npx tsc -p tsconfig.test.json` clean.

Full suite: 15 of 18 suites pass. `LoginInputs.test.tsx` and `AttendanceQueueCard.test.tsx` fail
with `TypeError: actImplementation is not a function` — **pre-existing**, confirmed by stashing
this branch's changes and re-running on the clean tree. Not investigated further here.

`src/__tests__/login-email-normalization.test.ts` had a fixture with `role: 'worker'` — copied from
worker-app — which the new gate correctly rejected. Corrected to `checker`; it was never a
checker-app fixture.

## Could not test

- **No run of the real app against a real backend.** Whether a WORKER's credentials are refused by
  a built checker app on a device is *not* established by this pass; only that the store refuses
  the session given the backend's response. Worth an ad-hoc run when a backend is available.
- **Server-side scoping.** Nothing here changes the backend: a worker's access token remains a
  valid token, and the checker-app endpoints' own authorization was not re-examined in this pass.
  The client gate is not the last line of defence and should not be treated as one.
