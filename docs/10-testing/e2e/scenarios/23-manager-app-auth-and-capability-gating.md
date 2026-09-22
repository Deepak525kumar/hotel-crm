# Scenario 23 — Manager app: sign-in, role admission and capability gating

Verifies that `mobile/manager-app` admits exactly the three roles it is for,
sends every other role somewhere that explains itself, and renders no control
the caller may not use. Governing records: `ADR-075` (the app itself),
`ADR-030` §3/D-5 (the capability matrix and RM parity), `ADR-065` (the
onboarding gate), and `backend/src/config/constants.ts` (`ROLE_PERMISSIONS`,
the only authority on what a role holds).

**Status:** New scenario, added 2026-09-22 with the manager app. Steps 1–6 are
device steps and cannot be run with curl — that is the point of them.

**Preconditions:** scenario 00's seed data, plus one user of every role.
`FEATURE_RM_ROLE` on. A manager whose hotel is in a group that also contains a
second hotel managed by someone else — without that second hotel, every
cross-scope assertion below passes vacuously.

> **Trap:** a green screen is not a passing gate. The client gate and the
> server gate are different things, and this app's gates are a convenience
> over server-scoped data. Every "is hidden" assertion below must be paired
> with the matching "is refused" assertion at the API, or it proves only that
> a button is missing.

---

## Step 1 — A manager signs in and lands on Today

Install the build, sign in as the hotel manager.

**PASS:** the app opens on Today, not on Consent and not on a blank screen.
The five tabs are Today, Rota, Team, Attendance, More.

**FAIL conditions (all real past defects):**
- Opens on the consent screen whether or not consent was given — `anchor`/
  `initialRouteName` missing from the root layout, which is exactly the
  worker-app defect this app's layout comment records
- A white flash before the stored dark theme applies — splash hidden before
  `themeHydrated`
- Tabs render in the device language rather than the user's stored one

## Step 2 — A worker and a checker are refused, by name

Sign out. Sign in as a worker. Repeat as a checker.

**PASS:** the wrong-app screen, naming *which* app to open — "Worker app" for
a worker, "Checker app" for a checker — and offering only Sign out.

**FAIL conditions:**
- The normal shell with every request 403ing. This is the checker-app defect
  recorded in `runs/2026-08-25-checker-app-role-gate.md`: it reads as "the app
  is broken" and generates a bug report for a working gate
- A blank dashboard
- Still signed in after force-quit and relaunch

## Step 3 — A regional manager sees everything a manager sees, plus the org chart

Sign in as the RM. Walk every tab and every `More` entry.

**PASS:** every screen a manager can open, the RM can open. The org chart is
reachable for the RM **and refused for the manager**.

**Why this step exists:** role gates are exact-match strings, so
`['manager','admin']` omits `regional_manager` at every site with no error
anywhere — `backend/CLAUDE.md` puts it at ~40 sites. `org_chart:read` is the
ONE token where the two roles legitimately differ (`ADR-030` C-33, D-5), so
any other difference found here is a bug, not a design.

**Verify at the API, not only the UI:**

```bash
# As the MANAGER's token — must be refused
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $MANAGER_T" \
  http://localhost:3001/api/v1/employees/hotel-groups/$GROUP/org-chart
# As the RM's token — must succeed
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $RM_T" \
  http://localhost:3001/api/v1/employees/hotel-groups/$GROUP/org-chart
```

**PASS:** `403` then `200`. A `200` for the manager means the route gate lost
its permission check; a `403` for the RM means the role string was omitted.

## Step 4 — No quality write exists anywhere

As manager and as RM, open an assignment that has been inspected.

**PASS:** inspection results, scores and rework flags are readable. There is
**no** rate control, **no** score input and **no** "assign rework" button on
any screen.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $MANAGER_T" -H 'Content-Type: application/json' \
  -d '{"score":80}' http://localhost:3001/api/v1/quality/assignments/$ASSIGNMENT/checks
```

**PASS:** `403`. `quality:write` is Checker-only (`ADR-030` C-27).

## Step 5 — No room-log write exists

**PASS:** the assignment screen offers only the aggregate rooms-completed
count. There is no per-room add/remove UI.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $MANAGER_T" -H 'Content-Type: application/json' \
  -d '{"room_key":"101"}' http://localhost:3001/api/v1/rooms/mine
```

**PASS:** `403` — those routes are `requireRole('worker')`.

## Step 6 — Master data is absent for manager and RM, present for admin

**PASS:** no create/edit/archive control for hotels or groups as manager or
RM; the `More` menu shows no Archive entry. As admin, the Archive entry
appears.

**Verify the server agrees**, because hiding a button is not a gate:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $RM_T" -H 'Content-Type: application/json' \
  -d '{"name":"X","city":"Y","country":"DE","address":"Z","timezone":"Europe/Berlin"}' \
  http://localhost:3001/api/v1/crm/hotels
```

**PASS:** `403`.

**Record, do not assert:** with `FEATURE_GD02_MATRIX` **off** this route reads
`requireRoleFlagged(['admin','manager'], 'admin')`, so a *manager* may pass the
role gate where an RM does not. That asymmetry is `SIR-CRM-020`, open and
deliberately unfixed. Record the flag state and the observed codes; do not
"fix" the test to match whichever you see.

## Step 7 — The onboarding lockout confines a manager with an incomplete record

Give the manager an employment record in `documents` state.

**PASS:** only onboarding, settings and profile are reachable; the operational
tabs are not.

**FAIL condition:** the gate runs *after* state is set, so the dashboard
renders for a frame and then redirects — a client-side gate that runs after
state is set is not a gate (README, Known coverage gaps).

## Step 8 — Scope claims resolve, and an archived hotel confers none

**PASS:** `scope_hotel_id` set for the hotel manager, null for RM and admin;
`scope_hotel_group_id` set for the RM only. Archive the manager's hotel, then
sign in fresh **and** replay a stale token.

**PASS:** neither grants scope. `resolveScope()` filters `deleted_at: null`
(scenario 20).

## Pass criteria summary

- [ ] Manager, RM and admin all admitted; worker and checker sent to the
      wrong-app screen **by name**
- [ ] Every screen a manager opens, an RM opens
- [ ] Org chart: RM/admin `200`, manager `403`
- [ ] No quality write in the UI **and** `403` at the API
- [ ] No room-log write in the UI **and** `403` at the API
- [ ] Master data absent for manager/RM **and** `403` at the API
- [ ] `FEATURE_GD02_MATRIX` state recorded alongside the hotel-create codes
- [ ] Onboarding lockout holds with no dashboard flash
- [ ] Archived hotel confers no scope on fresh login or stale token

## Knowingly untested here

- **The APNs/FCM half of sign-in.** Push registration happens inside the
  consent gate; whether a token is *delivered to* is scenario 25's problem and
  needs real credentials, which this environment does not have.
- **Biometric or SSO sign-in.** Neither exists in this product.
- **A manager whose scope is null.** The app renders a "no permission" note
  and the server denies every scoped call, but no seed fixture produces that
  state, so it has only been reasoned about — flagged here rather than left to
  be rediscovered.
