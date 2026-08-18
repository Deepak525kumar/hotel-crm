# Daily Consent Gate — Rollout and Kill Switch

Operational runbook for `FEATURE_CONSENT_GATE` (RULE-CONSENT-01, REQ-CONSENT-001/003).

This control can lock **every non-admin user out of the entire platform**, and it is **ON by
default** from the first version. Read the kill switch below before deploying anywhere.

---

## Kill switch

```bash
# On the app server
FEATURE_CONSENT_GATE=false      # in the backend .env
pm2 restart hotel-crm-backend
```

Recovery is one env edit plus a restart — seconds, not a deploy. The flag is read
per-request, so nothing is captured at module load.

**What the kill switch reaches.** It stops the API gating immediately, and the clients
stop prompting with it: web and both mobile apps read `GET /consent/gate-state`, which
returns `{enforced: false}` once the flag is off (or for any caller the gate does not
apply to, including every admin). So pulling the switch removes both the 403s and the
consent screen.

Two failure modes are deliberately asymmetric:

- If `/consent/gate-state` cannot be read, the clients assume **enforced** and still show
  the gate. Consent keeps working; nothing is bypassed on a failed lookup.
- If `/consent/status` cannot be read, the clients **fail open** and render the app. The
  server is the real gate and still refuses every gated call, so this degrades to visible
  request failures rather than a wall the user cannot dismiss — which is what would
  otherwise happen at exactly the moment you pull the switch because consent endpoints
  are broken. Verified by `frontend/__tests__/ConsentGateFailOpen.test.tsx` and each
  app's `consent-gate-decision.test.ts`; before 2026-08-18 all three claimed this in a
  comment while actually falling through to the wall.

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

## Rollout: enabled by default in the first version

**`FEATURE_CONSENT_GATE` defaults to `true`** (owner decision, 2026-08-18). It is on wherever
the env var is unset.

This deliberately skips the staged rollout an earlier draft of this document prescribed. That
staging existed for one reason: an older, gate-unaware mobile build receiving a `403
CONSENT_REQUIRED` it has no handler for, stranding the user with no path to consent. **That
risk does not exist here** — the gate ships as part of the first version, so there is no
older client already in the field. Every client in this release renders the notice.

The staged approach becomes necessary again the moment there *are* deployed clients predating
a gate change. If this flag is ever turned off and later back on against a live fleet, restore
the ordering: ship gate-aware clients first, wait for adoption, then flip.

### Still true regardless of the default

- **Enable it in staging first and run the manual matrix below.** Default-on removes the
  adoption risk; it does not remove the configuration risk.
- **Prefer a mid-afternoon flip over a morning one** on any environment with real users. The
  workforce logs in inside a ~90-minute window, so an afternoon change gives you 16 hours to
  watch before the first large exposure.
- **`CONSENT_GATE_ROLES` still narrows without disabling** — see the kill switch above.

## Manual test matrix (before shipping to a real environment)

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
| 8 | *(n/a for v1 — no pre-gate client exists. Reinstate if the flag is ever re-enabled against a live fleet: install the older build, flip the flag, observe what the user sees.)* | — |
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
included, serves legally-reviewed copy. With the gate on by default, workers accept a
**placeholder** daily from the first version onward.

This is a known and accepted state for v1 (owner decision, 2026-08-18: "we will change the
notice later"), not an oversight. What the gate delivers now is the *mechanism* — the daily
prompt, the block, the immutable record, the manager notification on decline. What it does
not deliver is legally-reviewed text, and the consent records written before real copy ships
attest to a placeholder rather than to the eventual notice. Whether those pre-copy records
need re-consenting once real text lands is a DPO question; `notice_version` is the lever
(bumping it re-gates everyone, by design), which is why RULE-CONSENT-02 ties a grant to a
specific version.
