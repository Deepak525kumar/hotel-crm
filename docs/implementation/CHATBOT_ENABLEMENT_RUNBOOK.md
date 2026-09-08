# Enabling the chatbot in production

`FEATURE_CHATBOT` is **false everywhere**, deliberately. This is the sequence to turn it on,
and the things that will stop you if you skip one.

Nothing here is reversible-by-accident: every step is a configuration change on the host, and
turning the flag back off is always a safe rollback.

## 0. What must already be true

| | Why it blocks |
|---|---|
| Every registered tool is **approved** | `assertAllToolsApproved()` runs at boot behind the flag and **refuses to start**, naming each offender. This is the only hard blocker in this document. |
| `SPEC-CHATBOT-001` is `FROZEN` | Governance, not code. It is (2026-09-09). |
| A provider is reachable | Not a blocker — without one, L0 still answers the highest-frequency questions at zero cost. |

**Check the first one before touching anything:**

```bash
grep -c "PENDING" backend/src/modules/chatbot/tools/definitions/*.ts
```

Any `approvalRef` containing `PENDING` will stop the process from starting. That is by design:
`ADR-053` item 4 makes each tool its own explicit approval, and the gate exists so the
requirement is mechanical rather than remembered.

## 1. Secrets on the host

`.env` on EC2 is an untracked production copy and is edited by hand. Generate on the host:

```bash
openssl rand -hex 32   # CHATBOT_CONFIRM_TOKEN_SECRET  — REQUIRED when the flag is on
openssl rand -hex 32   # CHATBOT_TRANSCRIPT_KEY        — optional; absent disables memory
```

- **`CHATBOT_CONFIRM_TOKEN_SECRET`** is enforced at boot by `config/env.ts` when
  `FEATURE_CHATBOT=true`. Without it the process refuses to start, because an unsigned
  confirmation flow would accept forged tokens — a high-risk write nobody approved.
- **`CHATBOT_TRANSCRIPT_KEY`** is optional and its absence is a supported state: memory is
  simply off and every turn starts cold. It is never a licence to store transcripts
  unencrypted. **Losing this key makes existing transcripts unreadable** — they are not
  recoverable, and the export path will surface that rather than silently omitting rows.

## 2. Provider

```
CHATBOT_PROVIDER=none | bedrock | mantle
```

`none` is a real, supported choice: L0 answers the most common questions deterministically at
zero token cost, and anything else falls back gracefully. Starting there is a reasonable way to
enable the surface without spending anything.

For `mantle`, no API key exists — it signs with the instance role. Region defaults to
`eu-central-1` (data residency). Before switching a provider on, run both live checks; neither
is in CI because each is a paid model call:

```bash
cd backend
npx tsx scripts/chatbot-routing-check.ts     # tool selection — baseline 32/32
npx tsx scripts/chatbot-injection-check.ts   # containment    — baseline 10/10
```

Re-run them after **any** change to a tool description or a model. Selection quality lives
entirely in those descriptions and nothing else in the repository tests them.

## 3. Turn it on

```
FEATURE_CHATBOT=true
```

Then restart, and **read the first 50 lines of the log**. Expected:

- `chatbot_provider_installed` with the configured provider
- no `ValidationError`
- no `not approved` error (that one is fatal — see step 0)

## 4. What is already bounded

Nothing further to configure; the defaults are deliberate.

- **Rate**: 20 model turns/min and 40 actions/min, per **user** — not per IP, because a hotel's
  staff share one office NAT and IP-keying would let one worker throttle their colleagues.
- **Spend**: per-conversation, per-user-daily and monthly token caps, checked before each turn.
- **Writes**: every high-risk write requires explicit confirmation of the exact call.
- **Transcripts**: 30 days, then swept.

## 5. Rolling back

Set `FEATURE_CHATBOT=false` and restart. The routes return 404, exactly as before enablement.
Stored transcripts remain until the 30-day sweep removes them; delete the key as well if the
intent is to make them unreadable immediately.

## Known limitations at the time of writing

- **The in-memory rate-limit store assumes one process.** `ecosystem.config.js` is
  `instances: 1, exec_mode: 'fork'`, and a test asserts that. Moving to cluster mode silently
  multiplies the effective limit by the worker count and needs a shared store first.
- **Concurrency is not fully closed** (`OD-CHAT-016`). Two truly simultaneous confirmations can
  both pass the read-then-write check; the idempotency key narrows the window rather than
  closing it.
- **Routing is stochastic.** The live checks are indicative, not gates — the same input can
  route differently on consecutive runs.
