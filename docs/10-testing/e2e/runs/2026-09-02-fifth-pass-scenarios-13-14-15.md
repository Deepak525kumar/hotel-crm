# E2E Run — 2026-09-02 (fifth pass) — new scenarios 13, 14, 15

- **Commit under test:** `bb9c7f37` (main) plus `fix/manager-queue-guard-and-reactivate-scope`
  (PR #622)
- **Environment:** local dev — backend (`:3001`), frontend (`:3000`), real Postgres, real S3,
  headless Chromium via Playwright for the browser-dependent checks
- **Executed by:** Claude (agent), per the user's instruction to run the remaining scenarios
  and author new ones for the three long-standing documented gaps (13, 14, 15)
- **Stack versions:** unchanged

## Results

All three previously-unauthored scenario gaps are now written, and all three were run live
(not just documented from source) to the extent feasible in this environment.

| Scenario | Result |
|---|---|
| 14 — Payslip requests | PASS, thorough. Worker self-request (with real date-boundary validation — pre-join and future-ending periods both correctly refused); manager sees it, an unrelated worker does not (IDOR); manager fulfils it, verified at the data layer; a cross-group manager is refused; manager-initiated creation on a worker's behalf works, and is refused for an out-of-scope worker. Frontend "Payslip Requests" card noted but not independently driven through a browser this pass |
| 15 — Re-onboarding | PASS, thorough. `triggerReonboarding` correctly refused while the contract is valid (pointing at `reactivate()` instead); with a genuinely expired contract, succeeds — `employment_cycle` incremented, all 6 documents preserved, a new `PENDING` contract auto-created, the old one left as history. Submit correctly blocked until the new contract is signed, with a distinct message from the first-onboarding-cycle gate. Full cycle completes identically to first-time onboarding. Real browser check: a `DEACTIVATED` account is route-guarded to `/onboarding` even when a different URL (`/calendar`) is requested directly — a real guard, not a hidden nav link |
| 13 — Language and RTL | PASS, after finding and fixing **two real, related defects** — see below. All six locales persist; a seventh is rejected. A fresh login now correctly renders the right language and text direction with no reload required, verified live end-to-end |

## New defects found

**Two real defects, both found live while authoring scenario 13, both fixed in this pass —
together they meant every non-default-language user saw the wrong language (and, for
Arabic/Urdu, the wrong text direction) on every fresh login, correcting only on a manual
reload:**

1. **`POST /auth/login`'s response omitted `preferred_language`** —
   `backend/src/modules/auth/service.ts`. The same bug *class* this file's own code comments
   describe having hit twice before, for `employment_status` (2026-08-13) and the
   profile-photo flag — a field present on `GET /auth/me` (the reload-time endpoint) but
   missing from the fresh-login response. Fixed: field added to `login()` and `signup()`'s
   response shapes, added to the shared `AuthUser` type. Two new backend unit tests.

2. **The frontend's locale `reconciled` flag never reset after a real login** —
   `frontend/stores/auth.ts`. Even with defect 1 fixed, the UI still didn't apply the correct
   language on a fresh login. The public, unauthenticated login screen legitimately sets
   `reconciled: true` (so it too can render in a negotiated language); `router.replace(
   "/dashboard")` after login is client-side navigation, so the component holding the
   reconciliation effect never remounts, and its `if (!reconciled)` guard then silently skips
   reconciling against the newly-authenticated user's real preference for the rest of the
   session. Fixed by having `setUser` — the one call that only ever carries fresh,
   authoritative server data — reconcile the locale store directly and unconditionally,
   bypassing the flag entirely rather than trying to make the flag itself smarter.

   **A genuine circular-require surfaced while fixing this and is recorded so it isn't
   rediscovered:** a static top-level import from `stores/auth.ts` to `stores/locale.ts`
   closes a real cycle through `lib/api.ts` (which imports `stores/auth.ts`, while
   `stores/locale.ts` imports `authApi` from `lib/api.ts`), breaking module evaluation under
   Jest/CJS interop in some test files (`ReferenceError: Cannot access 'ApiError' before
   initialization`). Fixed with a lazily-`require()`'d reference inside the function body
   instead of a top-level import.

Both fixes verified together, live, end-to-end: the exact original repro (set
`preferred_language: "ar"`, then a genuinely fresh login through the real form) now shows
correct `dir="rtl"`, `lang="ar"`, and real Arabic text, immediately, with no reload. One new
frontend regression test (`LocaleProvider.test.tsx`, calling the real `setUser` action
directly rather than `.setState`, so it actually exercises the fix). Full backend suite: 148
suites, 3582 tests, serial, all passing. Full frontend suite: 23 suites, 162 tests, all
passing. Both `npx tsc --noEmit` and `npx eslint` clean on every changed file.

## Confirmed NOT defects (investigated, ruled out)

- Scenario 15's contract-expiry seeding initially targeted `Contract.end_date` instead of the
  actual field `isContractValid()` reads, `Contract.expires_at` — these are two genuinely
  distinct columns on the schema. Not a defect; a harness mistake, caught by re-reading the
  real validation function rather than assuming the column name.

## Could not test / not run this pass

- Scenario 13: mobile apps (worker-app, checker-app) — web only this pass. The `LanguageSwitcher`
  UI component itself was not driven through the browser (the underlying `PUT /auth/profile`
  call was tested directly instead).
- Scenario 14: the frontend "Payslip Requests" card was not independently driven through a
  browser this pass (only glimpsed as a byproduct of an earlier, unrelated scenario 07
  investigation).
- Scenario 15: whether the `reactivate()`-side cross-entity-pointer defect found and fixed
  2026-09-02 (scenario 06/20) has any analogue for a re-onboarded Worker/Checker — reasoned to
  likely not apply (Worker/Checker's `approve()` is the fused, one-step path with no separate
  `assign()` step whose pointer could go stale) but not independently re-verified live.

## Scenario files added this run

- `13-language-and-rtl.md` — new, fully run live, two real defects found and fixed
- `14-payslip-requests.md` — new, fully run live, no defects found
- `15-re-onboarding.md` — new, fully run live, no defects found
