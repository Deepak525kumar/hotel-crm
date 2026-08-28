# E2E Run — 2026-08-29 — email and push delivery audit

- **Commit under test:** `ff5abc6f` (production tip; deploy run 33216409431 succeeded
  2026-08-28T22:20Z, "71 migrations found / No pending migrations to apply").
- **Environment:** deployed credentials, exercised from a local process against the real
  providers (Resend, APNs, FCM) and the local dev Postgres. Recipients were provider test
  sinks; device tokens were deliberate fakes. No human inbox and no real device involved.
- **Executed by:** agent (Claude Code), on the owner's request to check whether emails and
  push notifications are actually triggered and actually reach the user.

**Scope:** Scenario 16 (push) Steps 0–4 and 6, and the whole of the new Scenario 17 (email).
NOT a run of the other numbered scenarios.

## Results

| Check | Result | Evidence |
|---|---|---|
| EMAIL handler is real, not the no-op | **PASS** | `resolveEmailTransportHandler` → `EmailTransportHandler` under the deployed config |
| Sending domain SPF / DKIM / DMARC | **PASS** | `send.fhmhotelservice.de` SPF `include:amazonses.com`, MX `feedback-smtp.ap-northeast-1.amazonses.com`, `resend._domainkey` present, DMARC `p=none` |
| Domain verified at the provider | **PASS** | Resend API: `fhmhotelservice.de status=verified region=ap-northeast-1` |
| Password-reset shape (plain body) | **PASS** | accepted by Resend |
| Account-created shape (`emailText` override) | **PASS** | accepted by Resend |
| Email-changed shape (`emailTo` pin) | **PASS** | accepted by Resend |
| Recipient with no address | **PASS** | skipped cleanly, no throw, no retry storm |
| Hard-bounce address | **PASS (with caveat)** | accepted at send time; see "Limitations" |
| Reset link target | **PASS** | `https://deepcleaninghub.de/reset-password` → 200 |
| APNs worker-app topic | **PASS** | fake token → `400 BadDeviceToken` (auth + topic accepted) |
| APNs checker-app topic | **PASS** | fake token → `400 BadDeviceToken` |
| FCM project + service account | **PASS** | fake token → `404 UNREGISTERED` (OAuth2 exchange succeeded) |

`5 passed, 0 failed` on the email probe; all three provider probes returned the
configuration-good reason.

### The APNs result is the one that matters most

This is the first positive confirmation that the topic correction applied on the host took
effect. `BadDeviceToken` can only be reached *after* APNs has accepted the JWT and validated
the `apns-topic`, so it proves key, team and both bundle IDs are right — the exact thing that
was wrong during the outage, and that the worker's own "APNs configured" boot line cannot
distinguish.

## New defects found

None. Both transports are correctly configured and both providers accept what the shipped
code sends them.

## Limitations found (not defects, but they bound what "PASS" means)

1. **Bounces are invisible to the platform.** A provider accepts a message and bounces it
   asynchronously; the outbox marks the event `DELIVERED` and cannot know otherwise. Nothing
   consumes provider webhooks, so a permanently undeliverable address stays on the account and
   every send to it is recorded as a success. Recorded as a gap in Scenario 17.
2. **The probes cannot see a sandbox-vs-production iOS token mismatch.** A sandbox token
   answers `BadDeviceToken` too — indistinguishable from the fake token used here. A locally
   built Release install still needs Scenario 16 Step 5 on a real device.
3. **Email has no in-app fallback.** Push failures still leave a `Notification` row the user
   sees in the app; the four EMAIL-only flows have no such backstop.
4. **24 of 32 notification types are PUSH-only.** A user with no registered device gets an
   in-app row and nothing else for shift assignments, rework, ratings and absences. Deliberate,
   but worth stating.

## Could not test

1. **Actual receipt on a real device** (Scenario 16 Step 5) — no device or simulator here.
2. **The deployed `.env` values themselves.** The credentials exercised are the local copy of
   production. The owner applied the same correction to the host via SSM and confirmed the boot
   log, but a divergence between the two files would not be visible from here. Running the
   Step 6 probe *on the host* would close this.
3. **Production outbox state.** `GET /notifications/outbox/metrics` and `/dead-letters` need an
   admin token; whether a backlog of pre-fix `DEAD_LETTER` rows still awaits requeue is unknown.

## Scenario files updated this run

- **`scenarios/17-email-delivery.md`** — written. EMAIL had unit tests but no scenario at all.
- **`scenarios/16-push-notification-delivery.md`** — Step 6 gains the fake-token probe, which
  converts a "needs a real device" check into one that runs anywhere from the credentials
  alone, with an explicit warning that it is not a delivery confirmation. Its "known gaps"
  entry narrowed accordingly.
- **`README.md`** — Scenario 17 added to the index and run order.
