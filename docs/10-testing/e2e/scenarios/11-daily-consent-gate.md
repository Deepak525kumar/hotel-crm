# Scenario 11 — Daily Consent Gate (RULE-CONSENT-01)

Verifies that a worker must accept the daily data-protection notice before using the system,
and is blocked until they do. Covers `REQ-CONSENT-001/003`, `RULE-CONSENT-01/02/03`, and
`ADR-068` (notice served in the user's own language).

**Preconditions:** Scenario 00 complete. At least one **non-admin** user who has *not* yet
consented today, plus the Admin.

> **This gate can lock every non-admin out of the platform.** Read
> `docs/04-implementation/CONSENT_GATE_ROLLOUT.md` before enabling it anywhere shared.

---

## Step 0 — Establish the baseline with the gate OFF

Confirm `FEATURE_CONSENT_GATE` is absent/false in `backend/.env`, then:

```bash
curl -s -H "Authorization: Bearer $RT" \
  "http://localhost:3001/api/v1/consent/status?consent_instance=daily-access-gate"   # absent
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $RT" \
  http://localhost:3001/api/v1/notifications                                          # 200
```

**This 200-with-absent-consent is the defect the gate exists to fix.** Record it; it is the
before-picture that makes the rest of the scenario meaningful.

Then set `FEATURE_CONSENT_GATE=true`, restart the backend, and re-run the second command.

**PASS:** `403` with `{"error":{"code":"CONSENT_REQUIRED"}}`.

## Step 1 — Escape hatches must all be reachable while gated

**Getting this wrong is a total lockout**, so test every one:

```bash
for p in "consent/status?consent_instance=daily-access-gate" "auth/me"; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" -H "Authorization: Bearer $RT" \
    http://localhost:3001/api/v1/$p
done
curl -s -o /dev/null -w "refresh -> %{http_code}\n" -X POST -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$RF\"}" http://localhost:3001/api/v1/auth/refresh
curl -s -o /dev/null -w "profile -> %{http_code}\n" -X PUT -H "Authorization: Bearer $RT" \
  -H 'Content-Type: application/json' -d '{"preferred_language":"uk"}' \
  http://localhost:3001/api/v1/auth/profile
```

**PASS:** all `200`.

`/auth/refresh` is the one that matters most. Access tokens expire in **15 minutes**, and a
worker reading the notice will routinely hit that mid-decision. If refresh were gated, the
client would get a 403 where it expects a 401, never refresh, and the accept call would fail —
**permanent lockout, recoverable only by reinstalling the app.**

Note `/auth/profile` is **PUT**, not PATCH (PATCH returns 404 and looks like a missing
exemption).

## Step 2 — Gated routes are actually blocked

```bash
for p in notifications users attendance documents hr/payroll calendar; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" -H "Authorization: Bearer $RT" \
    http://localhost:3001/api/v1/$p
done
```

**PASS:** every one `403`.

## Step 3 — Accept, and verify in the database

```bash
curl -s -X POST -H "Authorization: Bearer $RT" -H 'Content-Type: application/json' \
  -d '{"consent_instance":"daily-access-gate","decision":"GRANTED","notice_version":"v1"}' \
  http://localhost:3001/api/v1/consent/decisions

docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT decision,notice_version,decided_at FROM \"ConsentRecord\" WHERE worker_id='<id>';"
```

**PASS:** a `GRANTED` row exists **and** the previously-403 route now returns `200`
immediately. The immediacy is the point — it proves cache invalidation. A pass here that
required waiting 60s would be a bug.

## Step 4 — Decline blocks, and re-accepting restores access

```bash
# decline
curl -s -X POST ... -d '{"...","decision":"DECLINED","notice_version":"v1"}'
# gated route -> 403 ; consent routes -> still 200
# then GRANT again
curl -s -X POST ... -d '{"...","decision":"GRANTED","notice_version":"v1"}'
```

**PASS:** blocked after the decline; access restored after the grant; **both rows retained** in
`ConsentRecord` (immutable, `RULE-CONSENT-05`), the GRANTED superseding by recency
(`RULE-CONSENT-02`).

A declining worker must always be able to accept afterwards. If the locked screen ever loses
its accept path, a single mis-tap costs someone their working day.

## Step 5 — Manager notified on decline (`REQ-CONSENT-003`)

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT type::text,user_id FROM \"Notification\" WHERE type::text='CONSENT_DECLINED';"
```

Note the `::text` cast — `type` is an enum and `LIKE` on it errors.

**PASS:** a row addressed to the group's `regional_manager_user_id`.

> **Trap:** this only fires for an **ACTIVE** employment record with a `hotel_group_id`.
> Against a `PENDING` user it correctly no-ops, which looks identical to a missing
> notification. Set the worker ACTIVE and in a group with an RM before concluding anything.

## Step 6 — Admin is never gated

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT count(*) FROM \"ConsentRecord\" c JOIN \"User\" u ON u.id=c.worker_id
   WHERE u.email='e2e-admin@test.local';"        # expect 0
```

**PASS:** count is 0 **and** the Admin still gets `200` everywhere. This is a safety property,
not a convenience: if the gate misfires, someone must remain able to log in and turn it off.

## Step 7 — No bypass, and 401 still beats 403

```bash
for p in consent-fake consentXYZ healthz "users/../notifications"; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" -H "Authorization: Bearer $RT" \
    http://localhost:3001/api/v1/$p
done
curl -s -o /dev/null -w "no-token -> %{http_code}\n" http://localhost:3001/api/v1/notifications
```

**PASS:** the four prefix-confusion attempts all `403` (they must not inherit `/consent`'s
exemption); the unauthenticated call is **`401`, not 403** — an expired or revoked token is an
authentication problem, and reporting it as a consent problem would send the user in circles.

Then confirm the gate has not swallowed authorization: as a **consented** out-of-scope user,
`/employees/review-queue` must still return `FORBIDDEN`, not `CONSENT_REQUIRED`.

## Step 8 — Withdrawal is immediate; yesterday's grant does not admit

```bash
curl -s -X POST ... /consent/withdraw -d '{"consent_instance":"daily-access-gate"}'
# gated route -> 403 immediately, NOT after 60s

# day rollover:
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "UPDATE \"ConsentRecord\" SET decided_at = decided_at - interval '1 day' WHERE worker_id='<id>';"
sleep 62      # outlive the positive-cache TTL
# gated route -> 403
```

**PASS:** both `403`. The second is `RULE-CONSENT-02` — consent is per calendar day
(Europe/Berlin), so a session open across midnight is re-gated.

## Step 9 — Notice language follows the user (`ADR-068`)

While still gated, change the language and re-fetch:

```bash
curl -s -X PUT ... /auth/profile -d '{"preferred_language":"uk"}'
curl -s -X POST ... /consent/request -d '{"consent_instance":"daily-access-gate"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['language'],d['rtl'])"
```

**PASS:** `uk False`. Before ADR-068 this fell back to German. Repeat with `ar` — expect
`rtl=True`.

This exercises two escape hatches in sequence and is the reason `/auth/profile` is exempt: a
worker shown a notice in a language they cannot read must be able to change it **before**
consenting.

## Step 10 — Browser check

The API steps cannot see whether the wall actually renders. Log in as a gated user in a real
browser and confirm the consent panel appears **instead of** the dashboard body, with the app
chrome still present.

> **Trap that cost real time:** Playwright's own web server (`:3100`) can serve a **stale
> build**. The symptom is the dashboard rendering with no consent wall, several 403s in
> console, and **no `/consent` request at all** — indistinguishable from a missing component.
> Re-run against the live dev server (`E2E_BASE_URL=http://localhost:3000`) before concluding
> the UI is broken.

**PASS:** the wall renders; **Grant is the visually emphasised action** and Decline is
secondary. (Reversed affordance on a GDPR prompt was a real defect found this way — the DOM
assertions passed and only a screenshot caught it.)

## Pass criteria

- [ ] Gate-off baseline reproduces the 200-with-absent-consent hole
- [ ] All escape hatches 200 while gated — `/auth/refresh` especially
- [ ] All data routes 403 while gated
- [ ] Accept → `GRANTED` row in Postgres → access restored **immediately**
- [ ] Decline blocks; re-accept restores; both rows retained
- [ ] `CONSENT_DECLINED` notification to the responsible RM (ACTIVE worker in a group)
- [ ] Admin unblocked with zero consent records
- [ ] No prefix-confusion bypass; 401 beats 403; authorization still returns FORBIDDEN
- [ ] Withdrawal immediate; yesterday's grant does not admit
- [ ] Notice language follows `preferred_language`
- [ ] Browser: wall renders, Grant emphasised
