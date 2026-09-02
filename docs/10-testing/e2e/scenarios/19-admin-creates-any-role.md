# Scenario 19 — Admin Creates Any Role

**New scenario, added 2026-09-02.** Covers `POST /api/v1/users` as amended 2026-09-01/02
(commits `8dc58cfb`, `bb44b527`; RULE A amendment in `backend/src/lib/role-hierarchy.ts`) — a
significant change to the account-creation hierarchy that shipped with **no dedicated
scenario**, only scattered corrections in `00-environment-setup.md` and
`02-manager-rm-onboarding.md`. This file is the first end-to-end verification pass for the
feature as a whole. **Steps 1, 2, and 4 were run live against a fresh DB on 2026-09-02**
(see `runs/2026-09-02-post-deploy-onboarding-and-rooms.md`) — those are marked
`PASS (verified 2026-09-02)` with real observed output. **Step 3 and part of Step 5 were
not** — those are written from reading the source directly and marked accordingly; treat them
as reasoned, not observed, until someone runs them.

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

**Expected, not run live this pass — from source, not observation:** `422`,
`"A profile photo is required"`. `controller.ts` throws this as an explicit `ValidationError`
after Zod passes (a client that satisfies the schema but omits the file part should get a
clear, specific refusal rather than a generic multer error) — but this specific negative case
was never actually sent in the 2026-09-02 run; every create call in that session included a
photo. Confirm live before checking the box below.

Also confirm the schema itself: `job_title`, `start_date`, and `employment_type` are **no
longer accepted fields** at all (removed from `CreateUserSchema` per owner decision, confirmed
by reading `users/types.ts` directly) — sending them should be silently ignored (Zod strips
unknown keys), not rejected. **Also not sent live this pass** — confirm by actually including
these three fields in a create request and checking they have no effect, rather than trusting
the schema read alone. This is the inverse of the `skills` bug below: an unknown key silently
disappearing is *correct* here only because these three fields were deliberately retired, not
because dropping unknown keys is safe in general — worth proving, not assuming.

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

```bash
# manager with a hotel that belongs to no group
curl ... -F role=manager -F hotel_id=<hotel with no hotel_group_id> ...
```

**Not tested this pass — outcome genuinely unknown, not just unobserved.** Either the create
is refused, or the record's `target_hotel_group_id` is left `null`; the frontend's own
`UserForm` should already prevent this by only offering grouped hotels for a Manager creation,
but that is a UI-only guard unless the service enforces it too. Confirm which layer actually
catches it (service or UI-only) and record the answer — this is exactly the kind of "which
layer is the real gate" question this suite exists to pin down rather than assume, and it has
not been pinned down here.

`regional_manager` creation takes `hotel_group_id` directly (no hotel); every other role takes
`hotel_id`, with the group derived from the hotel server-side, not sent independently by a
well-behaved client (the frontend derives it — see `frontend/app/(protected)/users/new/page.tsx`
— but the API itself does not require the derivation, so also test sending a *mismatched*
`hotel_group_id`/`hotel_id` pair and record what happens; this was not tested in the pass that
authored this scenario).

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
- [ ] Missing photo — `422`, explicit message (not a generic multer error) — expected from
      source, not yet run live
- [ ] `job_title`/`start_date`/`employment_type` silently accepted-and-ignored (deliberately
      retired fields) — expected from source, not yet run live
- [x] Valid `skills` — persisted, deduplicated
- [x] Invalid `skills` tag — `422` naming the bad index, never silently dropped
- [ ] Mismatched `hotel_id`/`hotel_group_id` pair — not tested; record the actual behavior
- [ ] Manager targeting an ungrouped hotel — not tested at the service layer specifically
      (only the frontend's own filtering was inspected)
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
