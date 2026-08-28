# Scenario 16 — Push Notification Delivery (ADR-029 §4, Epic 7 PRs 7.5–7.8)

Verifies that a notification enqueued by a domain module actually reaches a device: token
registration through the consent gate, `PushToken` ownership reassignment, the PUSH outbox
fan-out, the APNs/FCM send itself, and invalid-token pruning.

This scenario was listed as a **known coverage gap** from 2026-08-22 until it was written on
2026-08-28, after a configuration defect took out 100% of iOS push for both apps and went
unnoticed for as long as it stood. Everything about the failure looked healthy from the
outside. That is what this file exists to prevent.

**Preconditions:** Scenario 00 complete. A real device or simulator for at least one platform,
or the token-substitution shortcut in Step 3. `APNS_*` / `FIREBASE_*` configured — see Step 0.

> The decisive steps here are **not** HTTP calls against the API. The API's job ends when the
> outbox row is written; everything that actually delivers happens in the Platform Worker
> process (`backend/dist/worker.js`), against Apple's and Google's servers. A pass that only
> observes `202`s and `DELIVERED` rows proves nothing — see Step 5.

---

## Step 0 — The APNs topic must equal the app's bundle identifier

```bash
grep -E "^APNS_BUNDLE_ID_(WORKER|CHECKER)=" backend/.env
grep -n "bundleIdentifier" mobile/worker-app/app.json mobile/checker-app/app.json
```

**PASS:** `APNS_BUNDLE_ID_WORKER` equals worker-app's `expo.ios.bundleIdentifier`, and
`APNS_BUNDLE_ID_CHECKER` equals checker-app's, character for character.

**This is a real defect this scenario exists to catch.** Both variables shipped as the
`.env.example` placeholders `com.hotelcrm.workerapp` / `com.hotelcrm.checkerapp`, while the
apps build as `com.fhmhotelservices.*`. APNs rejects a mismatched `apns-topic` with
`400 BadTopic`, so **every iOS push for both apps failed**, for as long as those values stood.

Nothing surfaced it:

- `resolvePushTransportHandler` logs `APNs configured for {worker: configured, checker:
  configured}` when the variables are merely *present*. It cannot tell a correct topic from a
  plausible-looking wrong one.
- `push-provider.ts` classified `BadTopic` as **transient** — it is neither a `410` nor a
  `BadDeviceToken` — so every notification rode the full backoff schedule into `DEAD_LETTER`.
  That reads as a healthy worker with a delivery backlog.
- Android had a guard for exactly this class of mistake
  (`mobile/checker-app/src/__tests__/android-fcm-config.test.ts`, written after a near-miss
  with a mismatched Firebase project). iOS had none, which is why the defect survived on the
  iOS side only.

Now guarded from both ends: `backend/src/__tests__/apns-topic-config.test.ts` pins
`.env.example` to both `app.json` files, and `PushConfigurationError` turns a topic rejection
into a single ERROR log naming the topic instead of a silent slide into `DEAD_LETTER`.
**Neither guard can see a deployed `.env`** — it is untracked, and not present in CI. That is
why this step is a manual check against the running environment and not "the unit test covers
it".

## Step 0b — FCM is configured for the same Firebase project the apps were built against

```bash
grep -E "^FIREBASE_PROJECT_ID=" backend/.env
jq -r '.project_info.project_id' mobile/checker-app/google-services.json
```

**PASS:** identical. An FCM registration token is scoped to the *sender project*; a config from
a different project builds, runs, and mints tokens happily, then fails every send with
`SENDER_ID_MISMATCH` (403) — which `push-provider.ts` does not classify as `UNREGISTERED`, so
the token is never pruned and each notification retries to `DEAD_LETTER` instead. This nearly
shipped once, with the backend pointed at `hotel-crm-b0a24` while the configs were for
`fhm-hotelservice`.

## Step 1 — Registration is refused before consent, and succeeds after

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $CT" \
  -H "Content-Type: application/json" \
  -d '{"token":"fake-device-token-1","platform":"IOS","app":"CHECKER"}' \
  http://localhost:3001/api/v1/notifications/push-tokens
```

**PASS:** `403 CONSENT_REQUIRED` before today's consent is granted; `200`/`201` after.

The ordering is the point, and it is why `<PushRegistration />` renders *inside* `ConsentGate`
rather than as a `useEffect` in the `(app)` layout. React runs effects on mount regardless of
what a component renders, so the effect fired before the gate resolved, took a 403, and — since
registration is swallowed by design and never retried — the device received no push for the
rest of that session. Covered in the unit suite by `push-consent-order.test.ts`; asserted here
because the unit test cannot see the real gate.

## Step 2 — Re-registering a token reassigns ownership

Register the same `token` string as a *different* user.

```bash
psql -c "select user_id, app, platform from \"PushToken\" where token = 'fake-device-token-1';"
```

**PASS:** exactly **one** row, owned by the second user. `token` carries the unique constraint,
not `(user_id, token)`. This is a security requirement, not a tidiness one: on a shared device,
a stale row would keep delivering a new user's notifications to the previous account.

## Step 3 — A domain event writes one outbox row per transport

Trigger a real producer (e.g. assign a shift, or complete a rework), then:

```bash
psql -c "select transport, status, attempt_count from \"OutboxEvent\"
         where aggregate_id = '<notification id>' order by transport;"
```

**PASS:** one `PUSH` row (and an `EMAIL` row only for the producers that request it — most
enqueue `PUSH` alone), `status = 'PENDING'`, sharing one `correlation_id` with the
`Notification`.

## Step 4 — The worker claims and delivers it

Run the Platform Worker (`node backend/dist/worker.js`, or `pm2 logs hotel-crm-worker`) and
watch its boot lines.

**PASS:** the boot log shows `PUSH transport: APNs configured for …` **and** does not show
`PUSH transport not configured … falling back to the no-op handler`.

**A no-op fallback marks rows `DELIVERED` without sending anything.** `LoggingNoopTransportHandler`
logs at WARN precisely so this is unmistakable, but a `DELIVERED` row looks identical either
way at the database level. If the boot log shows the fallback, record every step below as
**could not test** — do not report a pass.

## Step 5 — A device actually receives it — verify off-platform

**PASS:** the notification appears on the device's lock screen.

This is the step with no shortcut, and it is the one the whole scenario turns on. Every
observable *inside* the system was green throughout the `BadTopic` outage:

| Observable | During the outage | What it means |
|---|---|---|
| `POST /notifications/push-tokens` | `200` | the token registered fine |
| `PushToken` rows | present | the device is known |
| `OutboxEvent` rows | written | the producer did its job |
| worker boot log | `APNs configured` | the variables are set |
| `OutboxEvent.status` | eventually `DEAD_LETTER` | reads as a backlog, not a config fault |

Nothing short of a device — or Step 6's direct APNs probe — distinguishes "delivered" from
"rejected with a 400 on every attempt".

## Step 6 — Probe APNs directly when no device is available

```bash
# Requires the same key material the worker uses. Reports Apple's own reason string.
curl -v -d '{"aps":{"alert":"probe"}}' \
  -H "apns-topic: $APNS_BUNDLE_ID_CHECKER" \
  -H "authorization: bearer $APNS_JWT" \
  --http2 "https://api.push.apple.com/3/device/$DEVICE_TOKEN"
```

**PASS:** `200`.

**FAIL, and what each reason means:**

| Reason | Cause | Fix |
|---|---|---|
| `BadTopic` / `TopicDisallowed` | `apns-topic` is not a bundle ID this key's team owns | Step 0 |
| `DeviceTokenNotForTopic` | the token belongs to the *other* app | wrong `PushApp` at registration |
| `BadDeviceToken` | sandbox token sent to the production endpoint | see below |
| `410 Unregistered` | app uninstalled — the only *correct* pruning case | none |

**The sandbox/production split is a second, independent iOS trap.** A build installed directly
from Xcode carries `aps-environment: development` and mints a **sandbox** token, which the
production endpoint (`https://api.push.apple.com`, the client's hardcoded authority) rejects
with `BadDeviceToken` — and *that* reason **is** classified as permanent, so the token is
deleted and the device silently stops being a push target until it re-registers. EAS
`production` builds rewrite the entitlement themselves, so this bites local Release builds, not
TestFlight ones. Check `aps-environment` in `ios/<App>/<App>.entitlements` before concluding
the backend is at fault.

## Step 7 — An invalid token is pruned, a misconfiguration is not

Register a syntactically valid but dead token, trigger a notification, run the worker.

**PASS:** on `410`/`BadDeviceToken` the `PushToken` row is **deleted** and the event settles
without retrying. On `BadTopic` the row is **kept** and an ERROR line names the topic.

The asymmetry is deliberate. A topic rejection means the token is fine and the *header* was
wrong; deleting it would force every device to re-register before push worked again, turning a
one-line environment fix into a fix-plus-reinstall across the fleet.

## Step 8 — A healthy platform keeps delivering while the other is broken

With APNs misconfigured and FCM correct, trigger a notification for a user who has **both** an
iOS and an Android token.

**PASS:** the Android device receives it, and the event is not retried on the iOS token's
account.

This was the real production shape during the outage: Android worked throughout, which is
itself a reason the iOS failure took so long to notice — "push works" was true for whoever
happened to be testing on Android.

---

## Known gaps in this scenario

- **Steps 5 and 6 need real credentials and a real device**; there is no local emulation of
  APNs or FCM in this repository. A run without them is a partial pass and must say so.
- The **JWT refresh path** (`ApnsProviderClient` caches for 20 minutes of a 60-minute life) is
  not exercised — a token-expiry regression would need a run longer than the cache window.
- **Payload size** (the 4KB APNs cap) is asserted in the unit suite, not here.
- The **tap-through routing** (`REWORK_COMPLETED` → `/verification/[id]`) is asserted by
  source inspection in `rework-evidence-route.test.ts`; no run has driven a real tap.
