# Email address verification — research, descoped for now

**Read this before starting the "Verify" button on user creation/email-change.** It records what was tested against the real production host, what was found in the codebase, and what remains an open decision. The feature is not being built right now; this exists so the research isn't repeated or lost.

| Field | Value |
|---|---|
| Status | **Descoped, not building.** Profile photo (the other half of the same original request) proceeded separately. |
| Trigger | User-creation and email-change flows need a "Verify" button next to the email field: check whether the address exists, mandatory before submit, green tick + "Email address verified" on pass, cross + explanation on fail. |
| Hard constraint | Must not send a real email per verification in production — cost, at ~500/day worst case. |
| Blocking finding | Outbound SMTP (port 25) is blocked on the production EC2 host — verified live, not assumed. See §2. |

---

## 1. What "verify an email" can mean, and why the distinction matters

Two different things get called "email verification," and the codebase's own `PUT /users/:user_id/email` context (`backend/src/modules/users/service.ts`) makes clear which one this request is:

- **Validation** — is this address *syntactically real and capable of receiving mail*? Checks: format, MX records for the domain, sometimes an SMTP handshake short of actually delivering. Never proves anyone controls the mailbox.
- **Ownership verification** — does the person entering this address *control* the mailbox? Requires sending something (an OTP, a magic link) and waiting for it to come back.

The user's requirement — "just check if that email address exists or not," no OTP, no confirmation link, and explicitly no email sent in production — is **validation**, not ownership verification. That distinction should stay explicit in any future UI copy: a green tick from a validation check means "this looks like a real, reachable mailbox," not "we confirmed this person owns it."

## 2. Why Resend was ruled out

Resend is a transactional **sending** API. It has no endpoint that answers "does this address exist" — its own blog post on the subject recommends third-party verification APIs rather than positioning Resend itself for this ([Resend: The 7 Best Email Verification APIs for Developers](https://resend.com/blog/best-email-verification-apis)). Confirmed by direct research at the time this was investigated (September 2026); worth re-checking if this is picked back up, since providers add features.

## 3. Why an SMTP mailbox probe (Reacher or otherwise) doesn't work here

The most accurate no-send validation technique is an SMTP `RCPT TO` probe: connect to the recipient domain's mail server on port 25, start an SMTP conversation, ask if the mailbox would accept mail for that address, then disconnect before `DATA` — no message is ever sent, so no cost per check.

**Tested directly against the production host and found blocked:**

```
$ (timeout 8 bash -c "cat < /dev/null > /dev/tcp/gmail-smtp-in.l.google.com/25") \
    && echo PORT25_OPEN || echo PORT25_BLOCKED
PORT25_BLOCKED

$ (timeout 8 bash -c "cat < /dev/null > /dev/tcp/api.resend.com/443") \
    && echo PORT443_OPEN || echo PORT443_BLOCKED
PORT443_OPEN
```

This is AWS's standard default (outbound port 25 is blocked account-wide to curb spam) and needs an AWS support request with justification to lift — it is not a local config change. Even granted, this technique has real limits worth knowing before investing in it:

- **Major providers (Gmail, Outlook, Yahoo) commonly answer "accept-all"** to a mailbox probe rather than a clean yes/no, so a meaningful fraction of checks return "unknown," not a verdict.
- **Probing volume from one IP can get that IP throttled or flagged** by receiving mail servers — this is exactly the kind of traffic spam filters watch for, independent of intent.

### Reacher specifically (self-hosted SMTP prober)

Researched as the specific self-hosted option, since it can run as a Docker container alongside the existing PM2 processes rather than as a paid API:

- **What it is**: an open-source backend (`reacherhq/backend`) that performs the DNS/MX/SMTP conversation described above and returns a structured verdict over HTTP (`POST /v0/check_email`).
- **Setup effort**: low — `docker run -p 8080:8080 reacherhq/backend` is the whole basic deployment; a production-ready setup (networking, domain/HELO config, monitoring, load testing) was estimated at 2–4 hours.
- **Compute**: light. It's mostly waiting on network round-trips (DNS, then an SMTP handshake), not CPU-bound. A rough starting point discussed: 2 vCPU / 2–4 GB RAM, with concurrency (default ~5 simultaneous checks) as the real tuning knob, not raw request rate.
- **Volume this project actually needs**: workforce ≈ 600 people, initial rollout ≈ 50, email changes estimated at roughly twice per person over time, worst case ≈ 500 checks/day (≈ 21/hour averaged, likely bursty around onboarding). This is a small volume for Reacher's own stated operating envelope — **compute and rate were never the concern here.**
- **The actual blocker is §3's port-25 finding**, not scale.
- **Licensing**: the self-hosted backend is dual-licensed — AGPL-3.0 for AGPL-compatible open-source use, or a commercial license for proprietary closed-source products. This platform is a closed-source commercial product, so the commercial license would apply, not the free AGPL path. **This is a legal/business decision, not a technical one** — flagging it here rather than deciding it.
- **Recommended architecture, if revisited and port 25 becomes available**: Reacher bound to `127.0.0.1` only (never exposed publicly), called by the app locally; verification run as an async job rather than blocking the HTTP request, since one SMTP conversation can take several seconds and a slow mail server must not hang a form submission.

**Bottom line on Reacher: shelved until/unless port 25 is unblocked (an AWS support request) *and* the licensing question is resolved.** Neither is a coding task.

## 4. What would actually work today, without port 25

Two real options remain, and the tradeoff is accuracy vs. cost, not accuracy vs. effort:

### Option A — Free: syntax + MX record check only
Validates the address format and confirms the domain has mail servers configured. Zero cost, zero new vendor, no email sent. Catches typos (`gmial.com`), fake/non-existent domains, and domains that plainly cannot receive mail.

**Known blind spot, stated plainly because it changes what the UI can honestly claim**: it cannot tell whether a *specific mailbox* exists at a real domain. `anything-at-all@gmail.com` would show a green tick, because `gmail.com` itself is a valid, mail-accepting domain — the check never looks past the `@`. If a green tick needs to mean "this mailbox is real," this option alone does not deliver that.

### Option B — Paid: hosted third-party verification API over HTTPS
Services that do the SMTP-probing work themselves, from their own IP infrastructure (which is built and reputation-managed for exactly this), returned as a simple API call — no port-25 dependency on this project's own infrastructure at all. Researched as viable candidates, each with a free tier that would need to become a paid tier at this project's ~500/day worst case:

| Service | Free tier | What it checks |
|---|---|---|
| Abstract API | 100/month | Format, MX, SMTP, disposable-address detection, quality/risk score |
| ZeroBounce | 100 credits/month | Invalid/disposable detection, spam traps, catch-all detection, SMTP signals |
| Verifalia | 25/day | Ongoing low-volume free usage rather than a one-time trial |
| Kickbox | 100 credits, one-time | Evaluation/testing scale only |
| Hunter | ~25–50/month | Verification plus email-finding, if that's ever needed too |

None of these prove mailbox *ownership* either (see §1) — they're the paid version of Option A's validation, done properly (real SMTP-level checking, from infrastructure not subject to this project's port-25 restriction), not a different category of check.

## 5. If this is picked back up

1. Decide Option A vs. Option B — this is a straight tradeoff between "free but a green tick can be misleading for non-existent mailboxes at real domains" and "a real per-check cost at this project's volume, but the tick means what it visually claims."
2. If Option B: pick a vendor and confirm current pricing/quota before committing — free-tier terms shift, and this write-up should not be trusted as current pricing without re-checking.
3. Either way: **run the check as an async job, not inline in the HTTP request** — an SMTP-backed API can take several seconds per address, and the UI should show a pending state ("Checking…") rather than block the form.
4. Keep the UI copy honest about which of §1's two things the check actually proved.
5. Re-test port 25 if AWS infrastructure ever changes (a new NAT gateway, a support-granted unblock, a move off EC2) — Reacher becomes viable again the moment that's true, and it remains the only option here with no per-check vendor cost.

## 6. What did NOT get built

No code shipped for this feature. `PUT /users/:user_id/email` already existed before this research (see the profile-photo/hierarchy work tracked separately) and already enforces admin/regional_manager-only, hierarchy-scoped access — that endpoint is unrelated to this document and was not touched by it.
