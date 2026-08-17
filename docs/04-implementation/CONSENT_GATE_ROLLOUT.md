# Daily Consent Gate — Rollout and Kill Switch

Operational runbook for `FEATURE_CONSENT_GATE` (RULE-CONSENT-01, REQ-CONSENT-001/003).

This control can lock **every non-admin user out of the entire platform**. Read the kill
switch section before enabling it anywhere.

---

## Kill switch

```bash
# On the app server
FEATURE_CONSENT_GATE=false      # in the backend .env
pm2 restart hotel-crm-backend
```

Recovery is one env edit plus a restart — seconds, not a deploy. The flag is read
per-request, so nothing is captured at module load.

**Narrower lever**, when the gate is working but a role must be unblocked:

```bash
CONSENT_GATE_ROLES=worker       # drop manager,regional_manager,checker
pm2 restart hotel-crm-backend
```

This keeps the worker-facing GDPR obligation live while unblocking the people who
administer the system.

**`admin` is never gated**, regardless of either variable. That is deliberate: if the gate
misfires, someone must remain able to log in and turn it off.

---

## Rollout order

The ordering constraint is hard, not advisory.

1. **Backend, flag off.** Deploy. No behaviour change — the middleware does not even query
   consent state while disabled.
2. **Ship the clients** (web + both mobile apps) and **wait for real adoption.** The client
   gates read `/consent/status` directly and work with the flag off, so they are safe to
   ship early.
3. **Enable in staging.** Run the manual matrix below in full.
4. **Enable in production with `CONSENT_GATE_ROLES=worker`**, mid-afternoon, monitored.
5. **Widen to the remaining roles** once step 4 has survived a full morning.

### Why step 2 must precede step 4

Mobile clients update asynchronously. If the flag flips before an old build is replaced,
that build receives a `403 CONSENT_REQUIRED` it has no handler for and shows a generic
error with **no path to consent** — total lockout for every un-updated device.

An old build is not completely stranded: the pre-existing self-service consent screen
(`consent.tsx`, reachable from Profile) still works, so support can talk a user through
accepting manually. Budget for those calls, or delay step 4 until adoption telemetry is
convincing.

### Why mid-afternoon, not morning

The whole workforce logs in inside a ~90-minute window. Enabling mid-afternoon means the
first *large* exposure is a morning you have already had 16 hours to watch.

---

## Manual test matrix (before production enable)

Automated tests cannot cover these. Run every row.

| # | Case | Expected |
|---|---|---|
| 1 | Log in as worker, checker, manager, regional_manager on a fresh day | Gate appears for all four |
| 2 | Log in as admin, no consent record | No gate; full access |
| 3 | Accept, then immediately hit a gated endpoint | Passes — no stale lock |
| 4 | Decline → locked screen → **accept from that screen** | Access restored; manager notification fired on the decline |
| 5 | **Sit on the locked screen >15 minutes, then accept** | Works. This is the `/auth/refresh` exemption — access tokens expire in 15m and this is the only way to catch it |
| 6 | Change language on the gate, re-read the notice | Renders in the new language; RTL flips for `ar`/`ur` |
| 7 | Hold a session across midnight Berlin time | Re-gated on the next request |
| 8 | Install the **pre-gate** mobile build, enable the flag | Observe exactly what the user sees; decide if it is survivable |
| 9 | Stop the database, hit a gated route as a worker | Request succeeds (fail-open), `consent_gate_check_failed` logged |

---

## Design decisions worth knowing before you debug this

**Fails open on a consent-lookup error.** Do not "fix" this to fail closed. OD-CONSENT-006's
fail-closed posture is about *ambiguous consent state* — never infer a consent you do not
have. A database error is not ambiguity, it is unavailability, and failing closed there
locks out every non-admin simultaneously including the managers who would respond. No
consent record is written on that path, so nothing is falsely recorded as granted.

**Positive-only cache, 60s TTL.** Only grants are cached, so a worker who has just accepted
is never left locked. Entries are keyed on Berlin calendar date and notice version, which
is what re-gates a session crossing midnight or spanning a version bump.

Under pm2 cluster mode the cache is per-process. A grant takes effect immediately
everywhere (no negative was cached); a *withdrawal* may leave access on sibling processes
for up to 60s.

**Exemption list.** `backend/src/middleware/consentGate.ts`. Every entry is an escape hatch
without which a gated user could never reach the state that ungates them. `/auth/refresh`
and `/auth/profile` are the two whose absence causes an unrecoverable lockout rather than
an inconvenience. The list is pinned by a meta-test, so widening it is a deliberate,
reviewed change.

---

## Watch on flip day

- `consent_gate_check_failed` — should be zero. Non-zero means the fail-open path is firing.
- **`CONSENT_DECLINED` notification volume.** Every decline notifies a manager and there is
  no rate limit. A spike suggests the notice renders badly in some locale — check that
  before assuming workers are declining on purpose.
- API p95. The gate adds one indexed query on top of the `user.findUnique` that auth already
  does per request; the cache should make it invisible, but verify rather than assume.

## Not covered by this gate

Notice content is still a structural placeholder in all 13 languages — no locale, German
included, serves legally-reviewed copy. Enabling this gate makes workers accept a
**placeholder** daily. That is a product decision to take deliberately, not a side effect
to discover: the gate enforces the *act* of consent, and real DPO-authored copy remains
outstanding.
