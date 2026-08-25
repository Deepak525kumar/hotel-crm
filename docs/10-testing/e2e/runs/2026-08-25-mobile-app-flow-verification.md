# E2E Run — 2026-08-25 — worker & checker app flow verification

- **Commit under test:** `main` through `8b82d0c`, plus the fixes listed below as they landed
- **Environment:** local dev (`hotelcrm_dev` on localhost) + real S3 + live FCM and APNs
- **Executed by:** agent (Claude Opus 5), at the project owner's request
- **Stack versions:** backend on `tsx src/server.ts`; Expo SDK 57 apps; Postgres 5432

**Scope:** every flow both mobile apps actually use, exercised against a running backend and
verified at the data layer. Not a run of the numbered scenarios — those remain NOT RUN. This is
recorded because eight defects were found, all of them silently broken in production code, and
this suite's rule is that an unrecorded defect gets found again from scratch.

## Results

| Area | Result | Notes |
|---|---|---|
| Authentication (mobile path) | **DEFECT** | Email case lockout — fixed, #537 |
| Login, `/auth/me`, refresh rotation, logout revocation | PASS | Old refresh token correctly rejected on reuse; refresh after logout 401 |
| Onboarding — documents list, completeness | PASS | Uploading `ID_CARD` correctly satisfied identity and dropped `PASSPORT` from missing |
| Onboarding — document upload | PASS | Real multipart through to real S3 |
| Onboarding — submit for review | **DEFECT** | Wrong path *and* wrong identifier — fixed, #538 |
| Contract download (both apps) | **DEFECT** | Threw on every attempt — fixed, #536 |
| Contract download (web) | PASS | Same-origin `/api/v1` + `sameSite: lax` cookie, so the `<a href>` carries auth |
| Calendar — absences list, mark SICK, withdraw | PASS | |
| Calendar — mark VACATION | **DEFECT** | Missing required `reason` — fixed, #539 |
| Worker shift list / detail / dashboard | **DEFECT** | No hotel, no date — fixed, #540 |
| Checker attendance queue / detail | **DEFECT** | Rendered the tail of a cuid as the worker — fixed, #541 |
| Quality — create verification with photo | PASS | Multipart score coercion, S3 upload, signed-URL retrieval all correct |
| Quality — evidence screen detail | **DEFECT** | No worker, hotel or date — fixed, #542 |
| Notifications list, attendance list, work requests, broadcasts | PASS | |
| Leaderboard (worker and checker) | PASS | `/quality/leaderboard`, correctly *not* `/analytics/leaderboard` |
| Consent gate | PASS | Behaves exactly as `PushRegistration`'s doc comment describes |
| Push transport (APNs + FCM) | PASS | Both providers authenticate; see the defect note below on what that does and does not prove |

## New defects found

1. **A capital letter in your email locked you out of your account.** Signup lowercased the stored
   address; login did not lowercase its input; Postgres compares case-sensitively.
   `signup {email: "ctrA-1@test.local"}` → stored `ctra-1@...`; `login` with the same string → 401.
   Password reset shared the flaw and returns an anti-enumeration 200, so the user was told "sent"
   while **0 `PasswordResetToken` rows** were created — no self-recovery. **Critical** — fixed in
   #537 with a data migration, since input normalization alone would have locked out the
   already-stored mixed-case rows.

2. **Contract download threw on every attempt, in both apps.** `FileSystem.downloadAsync` is a stub
   in `expo-file-system@57` that unconditionally throws. TypeScript accepted it, the code lived in a
   `.tsx` no suite collects, and the component swallowed the throw into a generic "failed to load".
   **High** — fixed in #536.

3. **Onboarding submission had never worked.** Two independent bugs in one call: the router is
   mounted at `/employees`, not `/employee-management/employees`; and the service resolves by the
   human-facing `employee_id` (`EMP-W-001`), not the user id, which `/auth/me` does not return.
   **High** — fixed in #538.

4. **Marking a vacation always failed.** Both apps offered a VACATION button but sent only
   `{day, kind}`; the backend requires a `reason` for VACATION. **Medium** — fixed in #539.

5. **A worker could not see where or when their shift was.** `/assignments` returned ids and a
   status only, and the client could not enrich it: `/crm/hotels` returns `[]` for a worker and
   `/crm/hotels/:id` 403s **for the hotel they are assigned to**. The mobile screens compounded it
   by rendering hotel/date only inside a `work_request` block, which is null for every
   calendar-placed assignment. **High** — fixed in #540.

6. **A checker could not see whose attendance they were verifying.** The queue rendered
   `Worker ···{worker_id.slice(-6)}` and no hotel. Same root cause as 5. **High** — fixed in #541.

7. **A write returned different data than a read.** Introduced by 5/6 and caught in review: only the
   read paths were enriched, so `PATCH` returned null for fields `GET` populated. Both clients
   assign mutation responses straight into state, so tapping **Verify** erased the worker name and
   hotel that had just been on screen. **High** — fixed alongside #541.

8. **The theme setting did nothing on web.** `use-color-scheme.web.ts` is a platform override Expo
   resolves instead of the native hook, and it still read the OS scheme. **Low** — fixed in #539.

## The structural cause, which is not fixed

Six of the eight are invisible to CI for one reason: the mobile jest config collects only
`**/__tests__/**/*.test.ts`, so **no `.tsx` screen or component is covered by any suite**. Defects 2,
4, 5, 6 and 8 all lived in `.tsx` files and passed typecheck. This is the highest-value remaining
gap in this repository's test estate — every mobile screen is currently unverifiable by CI.

Mitigation used while fixing: logic was extracted into `.ts` modules the existing config does
collect (`lib/contract-download.ts`, `lib/absence-reason.ts`, `lib/map-link.ts`,
`stores/theme-store.ts`), each with tests confirmed to fail against the original defect.

## Could not test

1. **Push actually arriving on a device.** Both providers authenticate — FCM returns a token grant,
   and APNs returns `400 BadDeviceToken` for both bundle ids, which proves the ES256 JWT and topics
   are accepted and only the deliberately-fake device token was rejected. What remains unproven is
   the last hop: no build containing the FCM config has shipped, so **no device has ever registered
   a token**. Reported as a gap, not a pass.
2. **iOS push from a development build.** The APNs endpoint is hardcoded to production
   (`api.push.apple.com`), so a dev build's sandbox token is rejected as `BadDeviceToken` — which
   this code then treats as permanently invalid and deletes. iOS is testable from TestFlight or a
   release build only.
3. **Anything rendered.** The apps were not run; screens are correct by type and test, not by sight.
4. **Production configuration.** All credential checks were against the local `backend/.env`.

## Scenario files updated this run

- None. Push delivery still has no scenario (`16-push-notification-delivery.md`, recorded in the
  coverage-gaps table). The eight defects above are recorded here rather than as scenarios because
  each is now covered by a regression test in the repository.
