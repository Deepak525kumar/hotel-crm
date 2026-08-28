# Scenario 17 — Email Delivery (ADR-029 §4, Epic 7 PR 7.4)

Verifies that an email a producer enqueues actually reaches an inbox: the
transport resolves to a real handler, the recipient and body are resolved
correctly, the provider accepts the message, and the sending domain is
authenticated well enough that it is not filed as spam.

Written 2026-08-29. Until then EMAIL had unit tests but no end-to-end scenario,
while PUSH had neither — and the gap in PUSH is what let a placeholder bundle ID
take out every iOS notification (Scenario 16). The same class of silent
configuration failure applies here and is arguably worse: a password-reset email
that never arrives locks a user out of the product with no error anywhere.

**Preconditions:** Scenario 00 complete. `EMAIL_SERVICE`, the matching API key
and `EMAIL_FROM_ADDRESS` configured — see Step 0.

> Email has **no in-app fallback**. A push that fails still leaves a
> `Notification` row the user sees in the app; the four email-only flows below
> have no such backstop. If email is down, those messages simply do not exist
> for the recipient.

---

## Step 0 — The transport resolves to a real handler, not the no-op

```bash
pm2 logs hotel-crm-worker --lines 50 | grep -i "EMAIL transport"
```

**PASS:** nothing. The warning line is only logged on the fallback path.

**FAIL:** `EMAIL transport not fully configured … falling back to the no-op
handler`. `LoggingNoopTransportHandler` marks every row `DELIVERED` **without
sending anything**, so the outbox looks perfectly healthy while no mail leaves
the building. Record every step below as **could not test** — not as a pass.

`resolveEmailTransportHandler` needs all three of `EMAIL_SERVICE` (exactly
`resend` or `sendgrid`, lowercase), the matching API key, and
`EMAIL_FROM_ADDRESS`. Any one missing silently degrades to the no-op.

## Step 1 — The sending domain is authenticated

```bash
FROM_DOMAIN=fhmhotelservice.de   # the domain of EMAIL_FROM_ADDRESS
dig +short TXT  send.$FROM_DOMAIN            # SPF
dig +short MX   send.$FROM_DOMAIN            # bounce handling
dig +short TXT  resend._domainkey.$FROM_DOMAIN   # DKIM
dig +short TXT  _dmarc.$FROM_DOMAIN
```

**PASS:** SPF contains the provider's include (`include:amazonses.com` for
Resend), the DKIM selector resolves, and DMARC exists.

Then ask the provider directly, which is the only authority on whether it will
actually accept a send from that address:

```bash
curl -s -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains
```

**PASS:** the domain is listed with `status: verified`.

A domain that is merely *added* but not verified fails every send with a 403,
and the failure looks identical to a transient provider outage: the events ride
the backoff schedule into `DEAD_LETTER` with no line naming the cause. This is
the email twin of Scenario 16's `BadTopic`.

## Step 2 — A real send, without touching a human inbox

Resend publishes test sinks. `delivered@resend.dev` always accepts;
`bounced@resend.dev` accepts and then hard-bounces. Use them rather than a
colleague's address, so the check is repeatable and leaves no mess.

Drive it through the shipped code — `resolveEmailTransportHandler` →
`EmailTransportHandler.deliver()` → `ResendProviderClient` — not through `curl`
to the provider. A `curl` proves the API key works; it proves nothing about
recipient resolution, the body override, or the from address the code actually
passes.

Cover all three body/recipient shapes, because they are three different code
paths and only one is exercised by the common case:

| Shape | Producer | What is special |
|---|---|---|
| plain | password reset (`auth`) | body is `notification.message` |
| `emailText` override | account created (`users`) | body differs from the in-app message, so the temporary password never lands in `GET /notifications` |
| `emailTo` pin | email changed (`users`) | destination is the **old** address, which is no longer the one on the user row |

**PASS:** all three accepted. Recorded 2026-08-29: 5/5 including the two
failure cases below.

## Step 3 — Failure handling

**A recipient with no address on file** must be skipped, not retried.

**PASS:** `deliver()` returns normally. A throw would ride the backoff schedule
to `DEAD_LETTER` for a condition no retry can fix.

**A hard-bouncing address** is accepted at send time.

**PASS:** `deliver()` returns normally — and this is the important limitation to
understand, not a defect. The provider accepts the message and bounces it
afterwards, asynchronously. The outbox marks the event `DELIVERED` and is
**structurally incapable of knowing** the mail never arrived. Bounces are
visible only in the provider dashboard; nothing in this system reacts to them,
and no user-facing surface reports "we could not reach you".

## Step 4 — The link in the mail goes somewhere

For password reset specifically, the body embeds
`${FRONTEND_URL}/reset-password?token=…`.

```bash
grep -E "^FRONTEND_URL=" backend/.env
curl -s -o /dev/null -w "%{http_code}\n" https://<frontend>/reset-password
```

**PASS:** `200`. An email that arrives and links to a 404 is worse than one that
never arrives — the user believes the product is broken rather than their mail.

Note the reset link's host and the sender's domain are **different domains**
here (`deepcleaninghub.de` versus `fhmhotelservice.de`). That is legitimate and
DKIM is on the sender, but it is a mild spam signal and worth knowing when
diagnosing a "the email went to junk" report.

---

## What sends email at all

Eight notification types, out of thirty-two. Everything else is PUSH-only, and
that is a deliberate design, not an oversight — but it means **a user with no
registered device gets an in-app row and nothing else** for shift assignments,
rework, ratings and absences.

| Type | Channels | Module |
|---|---|---|
| `SYSTEM` (password reset) | EMAIL | `auth` |
| `ACCOUNT_CREATED` | EMAIL | `users` |
| `USER_EMAIL_CHANGED` (new address) | EMAIL+PUSH | `users` |
| `USER_EMAIL_CHANGED` (old address) | EMAIL | `users` |
| `HOTEL_ACTIVATED` / `HOTEL_DEACTIVATED` | EMAIL+PUSH | `crm` |
| `HR_PAYSLIP_REQUESTED` | EMAIL+PUSH | `hr` |

## Known gaps in this scenario

- **Bounces and complaints are invisible to the platform** (Step 3). Nothing
  consumes the provider's webhooks, so a permanently undeliverable address stays
  on the account and every send to it is recorded as a success.
- **No HTML part.** `ResendProviderClient` sends `text` only; rendering and
  client compatibility are therefore not exercised anywhere.
- **Spam placement is not measured.** Steps 1 and 2 prove the mail is accepted
  and authenticated, not that it lands in the inbox rather than junk.
- **SendGrid is unexercised.** `EMAIL_SERVICE=sendgrid` selects a different
  provider client that no run has ever driven.
