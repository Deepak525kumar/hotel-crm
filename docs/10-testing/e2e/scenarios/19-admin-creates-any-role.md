# Scenario 19 — Admin Creates Any Role

**New scenario, added 2026-09-02.** Covers `POST /api/v1/users` as amended 2026-09-01/02
(commits `8dc58cfb`, `bb44b527`; RULE A amendment in `backend/src/lib/role-hierarchy.ts`) — a
significant change to the account-creation hierarchy that shipped with **no dedicated
scenario**, only scattered corrections in `00-environment-setup.md` and
`02-manager-rm-onboarding.md`. This file has now been run live in full — Steps 1–5 all show
`PASS` with real observed output (Steps 1, 2, 4 from the first 2026-09-02 pass; Steps 3 and 5
from a second pass the same day, which also found and fixed a real defect in Step 5). Only
Step 6 (downstream review-queue routing, side-by-side against an RM-created/Manager-created
applicant) remains unrun.

**Preconditions:** Scenario 00 complete (multipart create shape, mandatory photo, consent
gate). Two hotel groups + hotels for the cross-scope cases.

---

## What changed, and why this scenario exists

Before 2026-09-01, an Admin could create **only** `regional_manager` accounts (RULE A's
original one-level-down rule, applied literally: admin is one level above RM only).
Everything below that had to come from the person one level above it — a Manager could not
be created except by an RM, a Worker/Checker except by a Manager. The owner decision on
2026-09-02 amended this: **Admin may now create any non-admin role directly** —
`regional_manager`, `manager`, `worker`, or `checker` — while admin creating another **admin**
remains refused. The one-level-down rule (`isExactlyOneLevelAbove`) still governs who
**reviews/approves** an application; it no longer governs who may **create** one, which is a
separate function (`canCreateRole`) now.

## Step 1 — Admin creates each of the four permitted roles

```bash
for ROLE in regional_manager manager worker checker; do
  curl -s -X POST http://localhost:3001/api/v1/users -H "Authorization: Bearer $T" \
    -F "email=e2e-$ROLE@test.local" -F "password=E2EPass123!" \
    -F "first_name=$ROLE" -F "last_name=E2E" -F "phone=+4915100000${RANDOM:0:3}" \
    -F "role=$ROLE" \
    $([ "$ROLE" = "regional_manager" ] && echo "-F hotel_group_id=$G1" || echo "-F hotel_id=$H1 -F hotel_group_id=$G1") \
    -F "photo=@/path/to/photo.png;type=image/png"
done
```

**PASS (verified 2026-09-02):** all four `201`, each `EmploymentRecord` created `PENDING`
with **zero live scope** (`hotel_group_id`/`primary_hotel_id` both `null`) and the supplied
hotel/group recorded only on `target_hotel_group_id`/`target_primary_hotel_id` — confirmed at
the data layer, not from the response body:

```
        email          |       role       | status  | tgt_hotel | tgt_grp | no_live_scope
------------------------+------------------+---------+-----------+---------+---------------
 e2e-rm@test.local      | REGIONAL_MANAGER | PENDING | f         | t       | t
 e2e-mgr@test.local     | MANAGER          | PENDING | t         | t       | t
 e2e-worker2@test.local | WORKER           | PENDING | t         | t       | t
 e2e-checker@test.local | CHECKER          | PENDING | t         | t       | t
```

This is `ADR-065` Decision 2 (no operational scope until approval + assignment) applying
identically regardless of who created the record — the amendment changes **who may create**,
not the onboarding gate itself.

## Step 2 — Admin creating an admin must still be refused

```bash
curl -s -X POST http://localhost:3001/api/v1/users -H "Authorization: Bearer $T" \
  -F "email=e2e-admin2@test.local" -F "password=E2EPass123!" \
  -F "first_name=admin2" -F "last_name=E2E" -F "phone=+4915100000006" -F "role=admin" \
  -F "photo=@/path/to/photo.png;type=image/png"
```

**PASS (verified 2026-09-02):** `403 FORBIDDEN`, message: *"A admin may only create users
with role: regional_manager, manager, worker, checker (attempted: admin)"*. This is the one
edge the amendment deliberately did not touch — there is still exactly one Admin creation
path (SSM/direct DB, outside the API), and this test is the regression guard for it.

## Step 3 — The multipart contract itself

```bash
curl -s -X POST http://localhost:3001/api/v1/users -H "Authorization: Bearer $T" \
  -F "email=..." -F "password=..." -F "first_name=..." -F "last_name=..." \
  -F "phone=..." -F "role=worker"
  # no -F photo=...
```

**PASS (verified 2026-09-02, second pass, live).** `422`,
`"A profile photo is required"` — the exact `ValidationError` message, from `controller.ts`,
not a generic multer error.

`job_title`, `start_date`, and `employment_type` are **no longer accepted fields** at all
(removed from `CreateUserSchema`). **PASS (verified 2026-09-02, live)** — sent all three on a
real create call (`job_title=Should Be Ignored`, `start_date=2020-01-01`,
`employment_type=PART_TIME`) and confirmed at the data layer they had zero effect:
`EmploymentRecord.job_title` stayed the default `"TBD"`, `employment_type` stayed the default
`FULL_TIME`. This is the inverse of the `skills` bug below: an unknown key silently
disappearing is *correct* here only because these three fields were deliberately retired, not
because dropping unknown keys is safe in general — now proven, not assumed.

## Step 4 — Skills: validated, deduplicated, and NOT silently dropped

This is the specific defect the `skills` field's addition fixed — assert both directions.

```bash
# valid, with a deliberate duplicate
curl ... -F 'skills=["CLEANER","KITCHEN_DISHWASHER","CLEANER"]' -F role=worker ...
```

**PASS (verified 2026-09-02):** `201`, and `EmploymentRecord.skills` is
`{CLEANER,KITCHEN_DISHWASHER}` — the duplicate collapsed, order-preserving on first
occurrence.

```bash
# invalid tag
curl ... -F 'skills=["CLEANER","NOT_A_REAL_SKILL"]' -F role=worker ...
```

**PASS (verified 2026-09-02):** `422`, field `skills.1`, *"Invalid enum value"* — naming the
exact bad index, not a generic failure. This is the regression test for the original defect:
before this schema entry existed, `skills` was an unknown key to Zod and every worker created
through the UI silently got **no skills at all**, with no error telling anyone why. A silent
`201` with empty skills on this exact request is the failure mode to watch for if this ever
regresses.

`skills` is `worker`-only and optional (owner decision — can be set later from the profile);
sending it for any other role is accepted but has no effect (not itself validated against
role, since the field is simply unused outside `createEmployee`'s worker branch — confirm this
does not silently populate a Manager/RM/Checker's `EmploymentRecord.skills`).

## Step 5 — The role-appropriate target field

`regional_manager` creation takes `hotel_group_id` directly (no hotel); every other role takes
`hotel_id`. The API derives `target_hotel_group_id` from that hotel server-side — it does
**not** trust an independently-sent `hotel_group_id` for these roles, even though the client
is technically free to send one alongside `hotel_id`.

```bash
# a mismatched pair: H1 belongs to G1, but G2 is sent as hotel_group_id
curl ... -F role=manager -F hotel_id=$H1 -F hotel_group_id=$G2 ...
```

**REAL DEFECT, found live 2026-09-02, fixed in the same pass.** Before the fix: `201` success,
and `EmploymentRecord.target_hotel_group_id` was stored as the **sent** `G2` — the wrong
group — while `target_primary_hotel_id` correctly pointed at H1 (in G1). This was not merely
cosmetic: `getReviewQueue()` routes a Manager application by `target_hotel_group_id`, so G2's
Regional Manager — someone with no relationship to the real target hotel — would gain
visibility into and approval authority over the application, while G1's RM (who actually owns
the target hotel) would never see it. Root cause: `createEmployee`'s `admin` actor branch
validated that a Manager application *has* a `target_hotel_group_id`, but unlike the sibling
`regional_manager`/`manager` actor branches just below it in the same function — both of which
derive the group from the actor's own hotel and reject a mismatch — it never cross-checked the
admin-supplied group against the hotel's real one at all.

**Fixed:** the admin branch now derives `target_hotel_group_id` from `target_primary_hotel_id`
authoritatively (when a hotel is supplied and the target role isn't `regional_manager`),
discarding whatever group value the client sent, before the existing "Manager requires a
group" check runs — so a hotel with no group of its own still correctly refuses, rather than
silently passing a since-overwritten value. Verified live: the identical mismatched request
now stores `target_hotel_group_id` as `G1` (derived, correct), not `G2` (sent, wrong). Three
new unit tests in `employee-management.test.ts` pin the derivation, the ungrouped-hotel
refusal, and that a Regional Manager application (no hotel to derive from) is untouched.

## Step 6 — Downstream: the created applicant is reviewable and routes correctly

Every record created this way still needs the full onboarding lifecycle (documents, contract,
submit, approve) — see scenario 01/02 — and routes through review-queue exactly as any other
applicant would (scenario 03 Step 3's reviewer-of-last-resort chain: a Worker/Checker targeting
a hotel with no manager and no RM falls to Admin). This scenario does not re-test that chain;
it only tests the creation call itself. Confirm the two compose cleanly — an admin-created
Worker should reach an RM's or Manager's queue exactly like an RM-created or Manager-created
one would, since routing keys on the applicant's role and target, never on who created the
account.

---

## Pass criteria summary

- [x] Admin creates `regional_manager`, `manager`, `worker`, `checker` — all `201`, all
      `PENDING` with zero live scope, target fields recorded
- [x] Admin creating `admin` — `403`, exact refusal message
- [x] Missing photo — `422`, explicit message (not a generic multer error) — verified live
- [x] `job_title`/`start_date`/`employment_type` silently accepted-and-ignored (deliberately
      retired fields) — verified live at the data layer (defaults unaffected)
- [x] Valid `skills` — persisted, deduplicated
- [x] Invalid `skills` tag — `422` naming the bad index, never silently dropped
- [x] Mismatched `hotel_id`/`hotel_group_id` pair — **was a real defect** (wrong group stored,
      misrouted review-queue authority), found and fixed live this pass; re-verified after the
      fix derives the correct group
- [x] Manager targeting an ungrouped hotel — covered by the same fix's regression test
      (unit-level; not separately re-run live against a real ungrouped hotel)
- [ ] Downstream review-queue routing for an admin-created applicant, side-by-side against an
      RM-created / Manager-created one — not run as its own comparison

## Defects this scenario would have caught (already fixed before this scenario existed)

| Symptom | Root cause | Fixed in |
|---|---|---|
| Every worker created via the form silently had no skills | `CreateUserSchema` had no `skills` field; Zod stripped the key | `8dc58cfb` |
| `skills: ""` (untouched multipart field) rejected as invalid | `.optional()` sat outside the preprocess, testing the raw `""` input instead of the post-transform `undefined` | `8dc58cfb` |
| An admin-created Manager/RM was invisible in the Users tab to everyone including their own approver | `approve()` was status-only and never promoted `target_*` onto the live record | `03ad0ab3` (pre-dates this feature; documented here because Step 6 depends on it) |

## Governing decisions

- RULE A amendment, 2026-09-02 owner decision — `backend/src/lib/role-hierarchy.ts`'s own
  governance note
- `ADR-065` Decision 2 — no operational scope until approval + assignment, unchanged by this
  amendment
- `ADR-065` §6 item 6 — reviewer routing (scenario 03), composes with this feature but is
  scenario 03's own subject, not re-tested here
