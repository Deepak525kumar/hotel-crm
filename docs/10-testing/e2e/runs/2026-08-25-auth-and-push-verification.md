# E2E Run — 2026-08-25 — auth + push-notification verification

- **Commit under test:** `6a3f958` (`main`, after PR #524)
- **Environment:** local dev (`hotelcrm_dev` on localhost, 66 users)
- **Executed by:** agent (Claude Opus 5), at the project owner's request
- **Stack versions:** backend on `tsx src/server.ts`, port 3001; Expo SDK 57 mobile apps; Postgres 5432

**Scope:** a targeted verification of two questions — "does authentication work?" and "does push
notification delivery work?" — NOT a run of the numbered scenarios. Scenario results below are
therefore blank rather than PASS: they were not executed. Recorded here anyway because the push
findings are configuration defects that were invisible to every existing test, and this suite's own
rule is that a defect found and not written down gets found again from scratch.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–12 | NOT RUN | Out of scope for this pass |
| — (ad-hoc) auth | PASS | Real endpoints against a real database, detailed below |
| — (ad-hoc) push | FAIL | Cannot deliver to any device; four independent causes below |

### Authentication — PASS, verified at the data layer

Exercised the real endpoints; no mocks, and no direct DB write substituted for the path under test.
A fixture user was created through the real `POST /auth/signup` (not seeded), used, then deleted.

| Check | Result |
|---|---|
| `POST /auth/signup` | 201, bcrypt `$2a$` hash written to `User.password_hash` |
| `POST /auth/login`, correct password | 200, access + refresh token returned |
| `POST /auth/login`, wrong password | 401, `User.failed_login_count` incremented in the DB |
| `GET /auth/me` with the access token | 200 |
| `GET /auth/me` with a tampered token | 401 |
| `GET /auth/me` with no token | 401 |

Role and permissions are derived server-side (`role: "worker"` plus a 10-entry permission list), not
accepted from the client.

### Push notifications — FAIL

`POST /notifications/push-tokens` itself works: it is consent-gated (403 `CONSENT_REQUIRED` until
today's `daily-access-gate` decision is `GRANTED`, exactly as `PushRegistration`'s doc comment
describes), and after granting consent it wrote a real `PushToken` row. Re-registering the same
token as a second user correctly **moved** ownership — one row, new `user_id` — the property
`PushToken.token`'s UNIQUE constraint provides.

Delivery to a device, however, cannot happen. Four independent causes, all configuration or build
wiring rather than application logic.

## New defects found

1. **Android builds never contained `google-services.json`** — `mobile/{worker,checker}-app/app.json`
   did not declare `expo.android.googleServicesFile`, so Expo never placed the file in the build and
   `getDevicePushTokenAsync()` could not return an FCM token. The file was present on disk but
   untracked and unreferenced. **Critical** — filed and fixed in PR #527, with
   `android-fcm-config.test.ts` in both apps to prevent recurrence.

2. **A `DELIVERED` PUSH outbox event does not mean a device received anything** —
   `PushTransportHandler.deliver()` returns early without throwing when the recipient has no
   registered devices, and `outbox-worker.ts:116` marks any non-throwing `deliver()` as `DELIVERED`.
   At the time of this run the database held **32 PUSH events in `DELIVERED` and zero `PushToken`
   rows, ever** — every one of those was "nobody had a device", not "sent". **High, observability**
   — not filed as a code change: per-event success is `ADR-029`'s deliberate model, so
   distinguishing "skipped" from "delivered" is a spec change, not a bug fix. Anyone reading outbox
   status as proof that push works will be misled until then.

3. **`FIREBASE_SERVICE_ACCOUNT_KEY_BASE64` was undocumented** in `backend/.env.example`, which
   listed only `FIREBASE_PROJECT_ID`. FCM HTTP v1 needs both; with the key absent no FCM client is
   constructed and every Android device is *skipped* — and a skipped device is not a delivery
   failure, so nothing surfaces. **High** — documented in PR #526. The value itself is still unset.

4. **`backend/.env` push credentials are `.env.example` placeholders** —
   `APNS_PRIVATE_KEY_BASE64`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `FIREBASE_PROJECT_ID` are
   byte-identical to the example file, verified by comparison. iOS sends would fail at JWT signing.
   **Environment issue, not a repository defect** — needs real credentials from the project owner.

5. **The seeded test users' passwords have drifted from the scripts** — `worker1@test.local` does
   not accept `password123`, which `scripts/05-concurrency.mjs:15` hard-codes, and that account
   sits at `failed_login_count: 5`. That script would fail on this database for a reason unrelated
   to what it tests. **Medium** — not filed; needs a decision on whether the seed or the script is
   authoritative.

## Could not test

1. **Actual push receipt on a device** — needs a real FCM service-account key, real APNs
   credentials, and a physical device or emulator with a development build. Reported as a gap, not
   a pass.
2. **Production (EC2) configuration** — every credential finding above is from the local
   `backend/.env`. Production values were not inspected; there is no deploy script carrying a host
   in `scripts/`. Production may or may not be configured correctly.
3. **The Firestore push-token store** (PR #526) against a live Firestore — with Firebase
   unconfigured, the resolver fell back to Postgres, which is the path this run actually exercised.
   The Firestore path is covered only by unit tests against an in-memory double.

## Scenario files updated this run

- None. No scenario covers push-notification delivery — added to the coverage-gaps table in
  `README.md` as the missing `16-push-notification-delivery.md`.
