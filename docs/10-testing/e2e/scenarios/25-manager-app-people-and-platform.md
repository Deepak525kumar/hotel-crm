# Scenario 25 — Manager app: people, i18n, connectivity and push

Verifies the people half of `mobile/manager-app` (review queue, the approval
chain, team, hotels) and the platform behaviours that cut across every screen
(six locales and RTL, offline, push delivery, layout at 375pt). Governing
records: `ADR-065` (two-step approval for Manager/RM), `ADR-030` D-4b (named
transitions, no field edits), `ADR-068` (locale), `ADR-071`/Epic 7 PR 7.8
(push topics), `SIR-GLOB-022` (transport errors are English in every locale).

**Status:** New scenario, added 2026-09-22.

**Preconditions:** scenario 00's data. Pending applications in **two different
groups** — one group alone makes every scope assertion below pass vacuously.
A real device; the simulator cannot receive a push.

> **Trap:** an empty review queue proves nothing. It may be correctly empty,
> or the scope filter may be wrong. Only a queue seeded in two groups, viewed
> by two reviewers, distinguishes them.

---

## Step 1 — The queue is scoped, not merely role-gated

Sign in as Manager-A (group 1) and as RM-B (group 2).

**PASS:** each sees only their own group's pending applications. Neither sees
the other's.

**FAIL condition (real past defect):** admin-style visibility for a scoped
reviewer — "why is admin seeing all the applications" is the report that
produced the 2026-08-13 routing rewrite.

## Step 2 — Approving a worker is one step

Approve a pending **worker**.

```sql
SELECT status FROM "EmploymentRecord" WHERE id = '<id>';
SELECT COUNT(*) FROM "EmploymentStatusHistory" WHERE employment_record_id = '<id>';
```

**PASS:** status advanced and **exactly one** history row added for the
transition. Two rows means the transition ran twice.

## Step 3 — Approving a manager is TWO steps, and the app says so

Approve a pending **manager**.

**PASS:** the app performs approve **and** prompts for / performs the assign,
and does not report plain success after the approve alone.

```sql
SELECT manager_user_id FROM "Hotel" WHERE id = '<hotel id>';
```

**PASS:** the hotel now names the approved user. **Read the Hotel, not the
response** — scenario 02's defect table records `assign` returning 200 with
`Hotel.manager_user_id` still null, and the failure here is its mirror image:
never calling assign at all, leaving an approved-but-unassigned record and a
hotel with no manager.

**FAIL condition:** a success toast after approve, with the hotel unchanged.

## Step 4 — A peer manager cannot approve a manager

As Manager-A, attempt to approve a pending **manager** in the same group.

**PASS:** refused. Try the same through `rehire` as well — scenario 02 records
that both paths needed the check.

## Step 5 — No employment-record field edit exists

**PASS:** the team member screen offers the named transitions only. There is
no form for identity, legal, payroll, tax, compensation or employment terms.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PUT \
  -H "Authorization: Bearer $MANAGER_T" -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' http://localhost:3001/api/v1/users/$TARGET
```

**PASS:** refused **at the route/schema boundary** (400/404), not merely
denied by service logic — `ADR-030` D-4a requires that a scoped caller never
reaches a handler that can write `User.role`.

## Step 6 — A manager does not see peers

**PASS:** the Team list for Manager-A contains their hotel's workers and
checkers, and **not** Manager-B, and **not** their own RM.

## Step 7 — Six locales, and two of them right-to-left

Switch the language through each of `de en ur ar fr uk`.

**PASS:** every screen renders in that language; `ar` and `ur` lay out RTL
including the back arrow. The choice survives a relaunch and syncs to
`preferred_language`.

**FAIL conditions (real past defects):**
- The login response omits `preferred_language`, so the choice is lost on next
  sign-in (found live 2026-09-02)
- A stale `reconciled` flag leaves the cached locale winning over the stored one
- **Any screen showing a raw key** such as `nav.more` — i18next renders a
  missing key as the key itself

**Record, do not fix here:** transport-layer error messages remain English in
every locale (`SIR-GLOB-022`). Note whether the manager app inherited that.

## Step 8 — 375 points, measured

On a 375pt-wide device, walk every screen.

**PASS:** no horizontal scroll anywhere; long hotel and person names
ellipsise rather than widening the row. **Measure the page width; do not
eyeball it.**

**FAIL condition:** a row that cannot shrink pushes the layout past the
viewport and anything pinned right lands off-screen — the web learned this
from the other side (`frontend/CLAUDE.md`).

## Step 9 — Airplane mode is readable, not blank

Enable airplane mode and open each tab; then attempt a write (verify an
attendance record, move a placement).

**PASS:** a readable error on every screen — never a blank page and never a
spinner that never ends. The write fails **visibly**; it is not silently
dropped. On reconnect, pull-to-refresh recovers.

## Step 10 — Push reaches the manager app, on its own topic

Register the device, accept the daily consent notice, then trigger a
manager-directed notification (`APPLICATION_RECEIVED`).

```sql
SELECT app, platform FROM "PushToken" WHERE user_id = '<manager id>';
```

**PASS:** `app = 'MANAGER'`. Then observe the **Platform Worker's** send.

**PASS:** the notification arrives on the device and the tap opens the review
queue.

**FAIL conditions:**
- A `DELIVERED` outbox row is **not** evidence. Scenario 16's rule applies
  verbatim: the decisive step is the provider call, not the queue state
- `DeviceTokenNotForTopic` → the manager token was sent to another app's APNs
  topic, which is the exact outage `PushApp` exists to prevent
- The token registers **before** consent is accepted → 403 `CONSENT_REQUIRED`,
  and the token is then absent for the whole session

## Step 11 — The lifecycle transitions, and the two that are not interchangeable

From a team member's screen, run the transitions the record's status offers.

**PASS:** each writes **exactly one** `EmploymentStatusHistory` row, and the
`employment_cycle` counter is correct. A verb the server refuses from that
state surfaces its own message, not a generic failure — the client narrows
the list as a convenience and `applyTransition()` owns the real state machine.

**The pair worth its own check:** from `DEACTIVATED`, both `reactivate` and
`trigger-reonboarding` are offered. They are **not** alternatives —
`reactivate` returns someone whose contract is still valid,
`trigger-reonboarding` restarts the gate for someone whose contract expired,
and the server enforces which applies (scenario 15). Verify the wrong one is
refused rather than quietly doing the other.

**FAIL conditions:**
- Two history rows for one tap
- `delete` or `restore` offered to a manager — both are admin-only and cross
  the account boundary (`deleted_at`/`is_active`/`token_generation`)
- Any employment-record FIELD editable anywhere on the screen (ADR-030 D-4b)

## Step 12 — Blocking someone from a hotel

Add a blocklist entry from a hotel's screen, with and without a reason.

**PASS:** the reason is required (`SetBlocklistSchema` min(1)) and the entry
is readable back from `EmployeeBlocklistEntry`. This bars a named person from
a named property; the reason is the only record of why.

## Step 13 — Exports reach the share sheet

Export the team report and the own-data report from Settings.

**PASS:** the file downloads and the system share sheet opens. A report with
**zero rows** reports "no rows" rather than sharing an empty file.

**FAIL conditions (both real traps):**
- Nothing happens and no error appears → `FileSystem.downloadAsync` was used.
  It is still exported in SDK 57 as a stub that unconditionally THROWS;
  `File.downloadFileAsync` is the working call
- The whole Settings screen fails to render → a native module was imported at
  the top level. Its absence takes down every importer, not just the button

## Pass criteria summary

- [ ] Review queue scoped, proven with **two** groups
- [ ] Worker approval: one history row, not two
- [ ] Manager approval: `Hotel.manager_user_id` set, **read from the Hotel**
- [ ] Peer manager refused via both `approve` and `rehire`
- [ ] `role` in a `PUT /users/:id` body refused at the boundary
- [ ] Manager sees no peers and no RM
- [ ] Six locales render; `ar`/`ur` RTL; no raw keys anywhere
- [ ] 375pt with the width **measured**
- [ ] Airplane mode readable; writes fail visibly
- [ ] `PushToken.app = 'MANAGER'`; real provider send observed
- [ ] Each lifecycle transition writes exactly one history row
- [ ] `reactivate` vs `trigger-reonboarding` enforced by the server
- [ ] Blocklist refuses a missing reason; entry readable at the data layer
- [ ] Both exports open the share sheet; an empty report says so

## Knowingly untested here

- **Push without credentials.** If APNs/FCM are unconfigured, Step 10 is
  **Not Run** and must be recorded as a gap — never as a pass. Per the
  suite's own rule, a direct DB write is not a substitute for the path under
  test.
- **The org chart's rendered shape.** The client does not yet pin that
  response's type and renders a readable summary; asserting its structure
  would be asserting a shape nobody has read back.
- **Contract upload and payslip fulfilment.** The API methods exist in the
  client but have no screen yet, so there is nothing to walk.
- **Deep links for every notification type.** Only `APPLICATION_RECEIVED` is
  exercised above; the rest of the manager map is pinned by unit test only.
