# E2E Run — 2026-08-28 — checker app: push delivery, inspection history, rework reachability

- **Commit under test:** branches `fix/apns-push-topic-config` (PR #581),
  `feat/quality-inspection-history` (PR #582), `feat/checker-inspection-history` (PR #583),
  each off `229ff52`.
- **Environment:** local dev. Postgres 15 in Docker (`hotel-crm-postgres-1`), backend on
  `npx tsx src/server.ts` port 3099 (port 3001 was already held by another session's server
  running stale code — the first `/quality/my-inspections` call there returned 404, which is
  how the staleness was noticed; that process was left alone).
- **Executed by:** agent (Claude Code), from an owner report of three symptoms in the checker
  app.
- **Stack versions:** backend `hotel-crm-backend@0.1.0`, Expo SDK 56 checker-app, Postgres 15.

**Scope:** the three reported symptoms and their causes. NOT a run of the numbered scenarios —
Scenario 12's HTTP steps were read rather than re-executed, and are extended by this run
(see below). No device was available, so Scenario 16 Steps 5–6 could not be executed at all.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–11 | NOT RUN | Out of scope for this pass |
| 12 Checker evidence / rework | **NOT RE-RUN; EXTENDED** | Steps 10–11 added — see below |
| 16 Push delivery | **WRITTEN, PARTIAL** | Steps 0–0b executed by inspection; 5–6 could not test |
| — `GET /quality/my-inspections` | **PASS** | New endpoint, verified over HTTP against the dev DB |
| — self-scoping / IDOR | **PASS** | Spoofed `user_id`/`checker_id` ignored |
| — per-record authorship | **DEFECT FOUND, FIXED** | See defect 3 |
| — checker-app bundle | **PASS** | `expo export --platform ios` succeeds with the new screens |

### Verified at the data layer, over HTTP, with real checker JWTs

Three author profiles in the dev database, each queried through the running API:

```
checker1@test.local      (2 ratings, 0 verifications)  -> 2 rows, verification: null on both
qa-chk-31324@test.local  (1 rating, 3 verifications)   -> 3 rows, incl. NEEDS_REWORK + FAILED
                                                           with rework_required = true
a WORKER (holds quality:read, cannot inspect)          -> 200, total 0  (not a 403)
```

Pagination checked at the boundary: `page=1&per_page=2` and `page=2&per_page=2` returned
disjoint `assignment_id` sets.

## New defects found

1. **`APNS_BUNDLE_ID_WORKER` / `APNS_BUNDLE_ID_CHECKER` were the `.env.example` placeholders**
   (`com.hotelcrm.*`) while both apps build as `com.fhmhotelservices.*` — `backend/.env.example`
   lines 51–52 as shipped. **Critical:** 100% of iOS push, both apps, rejected by APNs with
   `400 BadTopic`. Compounded by `push-provider.ts` classifying that reason as transient, so
   every notification dead-lettered instead of reporting a config fault. Filed as **PR #581**
   (config + `PushConfigurationError` + `apns-topic-config.test.ts`).
   **Not fixed by that PR in any deployed environment** — `.env` is untracked. See "Could not
   test" below.

2. **"Assign rework" was unreachable in the shipped checker app.** The feature is complete on
   `verification/[id]`, but the only in-app link is the post-submit redirect from
   `quality/[id]`, which is linked only from `attendance/[id]` — a route **nothing in the app
   navigates to**. The remaining door was a `REWORK_COMPLETED` push, disabled by defect 1.
   Compounding it: the checker's own flow writes a `Rating`, while rework can only be assigned
   against a `QualityVerification`, so even a reachable screen would not have helped without a
   way to record the second record. **High.** Filed as **PR #582** (read endpoint) and
   **PR #583** (History tab, and the offer to record a verification).

3. **`GET /quality/my-inspections` returned a colleague's record as the caller's own.** Both
   models hang off one assignment, so the `OR` that matches the assignment carried the other
   author's row with it. **Low severity, high confusion:** not a disclosure (a rater already
   passes `assertCanViewVerification` for that assignment), but wrong on a "what did I score"
   screen and misleading where it drives the rework decision. Found on the **first real-database
   run**; the mocked unit tests asserted the Prisma arguments and could not have seen it. Fixed
   within PR #582 before merge, with tests both ways.

4. **`route-targets-exist.test.ts` read only string `router.push()` targets.** Because
   `typedRoutes` cannot type a pathname with an appended query string, every params-carrying
   link is written in object form — so all of them were unchecked, including
   `select-worker → /rating/[id]`, the link that starts an inspection. Exactly the class of dead
   link the file was written to catch. **Medium.** Fixed in PR #583; the widened guard
   immediately picked up three previously-unchecked links.

## Could not test

1. **Actual push delivery to a device** (Scenario 16 Steps 5–6) — no device, simulator, or
   APNs/FCM credentials in this environment. This is the only check that distinguishes
   "delivered" from "rejected on every attempt"; everything observable inside the system was
   green throughout the outage. **Recorded as a gap, not a pass.**
2. **The deployed production `.env`** — SSH to the EC2 host is not available from this session.
   Defect 1 is *proven* in the local file (which carries production `NODE_ENV`, `CORS_ORIGIN`
   and `FRONTEND_URL` with only `DATABASE_URL` swapped, so it is a production copy) and
   *inferred* for the host. It must be confirmed there and corrected by hand:
   `grep APNS_BUNDLE backend/.env` on the host, then
   `pm2 restart hotel-crm-worker --update-env`, then check the boot log's
   `PUSH transport: APNs configured for …` line. Until that is done, **iOS push is still down
   regardless of these PRs.**
3. **The iOS sandbox/production entitlement split** — depends on how the reported build was
   produced. If push is still missing after the env fix, check `aps-environment` in
   `ios/HotelCRMChecker/HotelCRMChecker.entitlements`: a locally-built Release install mints a
   sandbox token that the production APNs endpoint rejects with `BadDeviceToken`.
4. **Email** — no checker action sends one. Every `EMAIL` transport call site is in auth
   (password reset), CRM, users, or HR; quality, assignments, attendance and calendar enqueue
   `PUSH` only. "No emails as a checker" is current behaviour, not a regression. Whether
   `fhmhotelservice.de` is a verified sender domain in Resend was not checked.

## Scenario files updated this run

- **`scenarios/16-push-notification-delivery.md`** — written. Closes a coverage gap open since
  2026-08-22. Encodes the `BadTopic` defect, the sandbox/production trap, the no-op-handler
  false pass, and the table of internal observables that all stayed green during the outage.
- **`scenarios/12-checker-photo-evidence-and-rework.md`** — Steps 10 and 11 added
  (inspection is findable afterwards; history is authorship-scoped and not client-steerable),
  plus a note in "Known gaps" that they narrow the mobile-path gap without closing it. The
  lesson recorded there is general: a scenario driven entirely by `curl` cannot catch an
  unreachable feature, because `curl` supplies by hand the very ids the UI had no way to get.
- **`README.md`** — Scenario 16 added to the index and the run order; the coverage-gap table
  reduced from four entries to three.
