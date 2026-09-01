# Scenario 12 — Checker Photo Evidence and the Rework Loop (CRR §14/§15)

Verifies that a Checker's rating carries photo evidence, that a failed check can be sent back
to the worker as a linked rework assignment, that the worker cannot close it without a photo,
and that an unfinished rework escalates. Covers CRR §14 (the rework loop) and §15 (photo
uploaded *with* the rating), and `ADR-069` (rework assignments are excluded from the worker's
own performance denominators, and from the active-slot uniqueness index).

**Preconditions:** Scenario 00 complete. One Checker, one Worker with an active assignment
today, one Manager in scope. `S3_BUCKET` set — see Step 0.

> Every step below is an **HTTP** step. Most of the defects this scenario encodes were
> invisible to the unit suite because they only appear when a real multipart request, a real
> S3 client, or two concurrent requests are involved.

---

## Step 0 — Confirm the storage path is real, not the stub

`backend/src/config/env.ts` refuses to boot in production/staging without `S3_BUCKET`, but in
**local dev it falls back to a stub storage client**. A full pass against the stub proves
nothing about evidence retrieval.

```bash
grep -n "S3_BUCKET" backend/.env
```

**PASS:** `S3_BUCKET` is set and the backend log at boot does not mention the stub client.
If it is unset, record every photo step below as **could not test** — do not report a pass.

## Step 1 — A rating without a photo is refused

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $CT" \
  -F "assignment_id=$ASSIGNMENT_ID" -F "score=45" -F "notes=missed bathroom" \
  http://localhost:3001/api/v1/quality/verifications
```

**PASS:** `400`. CRR §15 requires the photo with the rating.

## Step 2 — A rating *with* a photo succeeds, and `score` survives multipart

```bash
curl -s -X POST -H "Authorization: Bearer $CT" \
  -F "assignment_id=$ASSIGNMENT_ID" -F "score=45" -F "notes=missed bathroom" \
  -F "photos=@/path/to/real.jpg;type=image/jpeg" \
  http://localhost:3001/api/v1/quality/verifications
```

**PASS:** `201`, and the response `score` is the **number** `45`.

**This is a real defect this scenario exists to catch.** `score` was declared
`z.number()`, but a multipart field always arrives as the *string* `"45"`, so every
photo-bearing rating was rejected with a validation error while the JSON-bodied unit tests
passed. Fixed by `z.coerce.number()` in `backend/src/modules/quality/types.ts`. A JSON
request will **not** reproduce it — the request must be multipart.

## Step 3 — Photo evidence is readable, and only by the right people

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT id, photo_urls FROM \"QualityVerification\" WHERE id='$VERIFICATION_ID';"

for TOKEN in "$CT" "$WT" "$OTHER_WORKER_T" "$AT"; do
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/v1/quality/verifications/$VERIFICATION_ID/photos
done
```

**PASS:** `photo_urls` holds a key (not a URL, not empty); Checker `200`, subject Worker
`200`, Admin `200`, and **an unrelated Worker `403`**.

**The unrelated-worker case is the whole point of this step.** Workers hold `quality:read`
(ADR-067), so an authorization check written as "manager-scoped or better" lets *any* worker
read *any* other worker's evidence photos — an IDOR. The handler must be deny-by-default and
match the subject worker explicitly. Do not drop this assertion because the other three pass.

> **Table note (corrected 2026-08-24).** `rework_completed_at`, `rework_escalated_at`,
> `rework_required` and `rework_notes` live on **`QualityVerification`**, not on
> `WorkerAssignment`. The assignment side carries only `rework_of_assignment_id` and
> `rework_verification_id`. Querying the wrong table returns
> `ERROR: column "rework_completed_at" does not exist`, which is easy to misread as a
> missing migration.

## Step 4 — Assign rework, and check the linked assignment

```bash
curl -s -X POST -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' \
  -d '{"verification_id":"'$VERIFICATION_ID'","notes":"redo the bathroom"}' \
  http://localhost:3001/api/v1/quality/rework

docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT id, status, rework_of_assignment_id, rework_verification_id
     FROM \"WorkerAssignment\" WHERE rework_of_assignment_id='$ASSIGNMENT_ID';"
```

**PASS:** a new assignment row exists, linked back to the original **and** to the
verification, and the worker has a `REWORK_ASSIGNED` notification queued.

**Note what this proves about the uniqueness index.** The worker already has an active
assignment today; a rework row is a *second* active row for the same day. Migration
`20260818120000_add_rework_assignment_link` redefines `WorkerAssignment_active_slot_unique`
to exclude rework rows precisely so this insert is allowed. Re-verify the *other* half too —
an ordinary second assignment for the same worker/day must still be rejected — or a
regression that drops the index entirely will pass this step.

## Step 5 — Assigning rework twice is a conflict, not a second assignment

Fire the Step 4 request twice concurrently (`&` both curls).

**PASS:** exactly one `201` and one `409`, and exactly **one** new assignment row. The claim
is a compare-and-swap (`updateMany ... where rework_required: false`), not a read-then-write;
a read-then-write passes a sequential test and creates two assignments under concurrency.

## Step 6 — The worker cannot close rework without a photo

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $WT" \
  http://localhost:3001/api/v1/quality/rework/$REWORK_ASSIGNMENT_ID/complete
```

**PASS:** `400`. Then repeat **with** `-F "photos=@..."`.

**PASS:** `200`, and in the database:

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT status, rework_required, rework_completed_at, score
     FROM \"QualityVerification\" WHERE id='$VERIFICATION_ID';"
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT round_number, completed_at, array_length(photo_urls,1)
     FROM \"ReworkRound\" WHERE verification_id='$VERIFICATION_ID' ORDER BY round_number;"
```

- `rework_completed_at` is set, and the rework assignment is `COMPLETED`;
- **`status` is now `PASSED` and `rework_required` is `false`** — the room
  AUTO-PASSES on submission (owner decision, 2026-09-01). Before that change
  nothing in the codebase could move a verification out of `NEEDS_REWORK`, so a
  fixed room stayed failed forever and dragged the worker's rating (analytics
  filters on `status: PASSED`);
- **`score` is UNCHANGED** (still 45). The room passed operationally; the
  original number stays as the honest record that it took two attempts. A
  score that moved would mean somebody fabricated it;
- the worker's evidence is on the **`ReworkRound`**, not on the verification —
  `QualityVerification.photo_urls` still holds only the checker's photographs.
  (Corrected 2026-09-01: this step used to claim `photo_urls` "grows from 1 to
  2" on the verification, which stopped being true on 2026-08-30 when the two
  sets of photographs were deliberately separated — a checker could not tell
  their own pictures from the worker's proof of the fix.)
- the Checker has a `REWORK_COMPLETED` notification, pushed, and its message
  says the room passed and can be sent back again. With auto-pass this push is
  the **only** moment a human is invited to look at the fix, so a message that
  merely said "marked it done" would be a real gap.

Repeat the successful call once more. **PASS:** `200` again — not `409`.
Resubmission is deliberately allowed so a worker can add more evidence; the
round's `photo_urls` grows, `completed_at` does **not** move (it records when
the room was done, and re-stamping it would restart the 20-minute story), and
the checker's second notification says "added more evidence" rather than
repeating "completed". (Corrected 2026-09-01: this step previously asserted a
`409` and a frozen photo count.)

## Step 6b — The checker can reopen a room after the auto-pass

Re-run Step 4's `POST /quality/rework` against the same `$VERIFICATION_ID`.

**PASS:** `201` — a second `ReworkRound` (`round_number = 2`) is created, the
verification returns to `NEEDS_REWORK`, and `rework_completed_at` is reset to
`null`. This is what makes auto-pass safe: acceptance is automatic, but it is
not final. Note the guard is per-ROUND, not per-verification: `assignRework`
refuses (`409`) only while a round is still **open**, so reopening works after
a completion but a double-assign while one is outstanding is still a conflict.

## Step 7 — Cross-worker completion is refused

Call Step 6's successful request with a *different* worker's token.

**PASS:** `403`/`404`, and `QualityVerification.rework_completed_at` stays null. The endpoint is self-scoped;
the assignment id is guessable.

## Step 8 — Escalation after 20 minutes, and the race against completion

Backdate the rework assignment's creation by 21 minutes, then run the escalation job.

**PASS:** `QualityVerification.rework_escalated_at` is set once, and **both** the Manager and the Checker receive
`REWORK_OVERDUE` (CRR §14 requires both). Run the job a second time: no duplicate
notifications.

Now the case worth encoding: set `QualityVerification.rework_completed_at` on an overdue row and run the job.

**PASS:** **no** `REWORK_OVERDUE` is sent. The job's claim must re-check
`rework_completed_at IS NULL` inside the compare-and-swap, not just `rework_escalated_at IS
NULL` — otherwise a worker who finishes between the job's SELECT and its CLAIM still gets
reported overdue to their manager.

## Step 9 — Rework must not distort the worker's own metrics (ADR-069)

```bash
curl -s -H "Authorization: Bearer $AT" \
  "http://localhost:3001/api/v1/analytics/workers/$WORKER_ID/stats" | jq
```

**PASS:** `completion_rate` and `on_time_rate` are each **≤ 1.0**.

Both could previously exceed 100%: the numerator counted rework rows while the denominator
did not. Any per-worker count in `analytics/service.ts` `getWorkerStats` and in
`refreshWorkerOverallRating` must carry `rework_of_assignment_id: null` on **both** sides.
Platform-wide tiles are deliberately *not* filtered — rework is real work the hotel paid for.

A stat above 1.0 is the visible symptom; the invisible one is a denominator fixed on one side
only, so assert the ratio rather than eyeballing the counts.

## Step 10 — The checker can find the inspection again afterwards

```bash
curl -s -H "Authorization: Bearer $CT" \
  "http://localhost:3001/api/v1/quality/my-inspections" | jq
```

**PASS:** the inspection just recorded is in `inspections`, carrying `verification.id`,
`verification.status`, `verification.rework_required`, and `rating.photo_count` /
`verification.photo_count`.

**This step encodes a defect every earlier step in this file walked straight past.** Steps 1–9
drive the rework loop with `curl`, holding ids in shell variables — so they proved the loop
works while saying nothing about whether a checker could ever *start* it from the app. They
could not:

- The quality module had **no list endpoint**. `/verifications/:id` and `/ratings/:id/photos`
  are reachable only by someone who already holds the id, and nothing handed one out.
- "Assign rework" lives on checker-app's `verification/[id]`. Its only in-app link was the
  redirect fired immediately after submitting a verification, from `quality/[id]` — which was
  itself linked only from `attendance/[id]`, a screen **nothing in the app navigates to** (the
  attendance queue it belonged to was deleted; the Attendance tab shows the checker's own
  record and routes to `shift/[id]`).
- The one remaining door was a `REWORK_COMPLETED` push — and push was simultaneously dead, see
  Scenario 16 Step 0.

So `POST /quality/rework` was fully working, fully tested here, and unreachable in the shipped
app. **A scenario driven entirely by `curl` cannot catch that class of defect**, because `curl`
supplies by hand exactly the ids the UI had no way to obtain. Where an HTTP step stands in for
something a person does in an app, say which screen leads there — and check that it does.

## Step 11 — The history is the caller's own work, not their colleagues'

Have a *second* checker record a verification on an assignment the first checker rated, then
re-run Step 10 as the **first** checker.

**PASS:** the row appears (it is their rating), but `verification` is `null`.

Both `Rating` and `QualityVerification` hang off the same assignment and the two actions
routinely have different authors, so the `OR` that finds the assignment will happily carry the
other person's record along with it. Not a disclosure — anyone who may rate an assignment
already passes `assertCanViewVerification` for it — but wrong on a screen answering "what did
I score", and actively misleading where it drives the rework decision. Found against a real
database; the mocked unit tests were structurally incapable of seeing it, since they asserted
the query arguments rather than what Postgres returned.

Also confirm the scoping cannot be steered from the client:

```bash
curl -s -H "Authorization: Bearer $CT" \
  "http://localhost:3001/api/v1/quality/my-inspections?user_id=$OTHER_CHECKER_ID&checker_id=$OTHER_CHECKER_ID" | jq '.data.pagination.total'
```

**PASS:** unchanged from Step 10. There is no actor parameter; the filter is the caller's own
id from `req.auth`.

---

## Known gaps in this scenario

- Presigned-URL **expiry** (15-min TTL) is not exercised; a clock-skew or TTL regression
  would pass here.
- The mobile capture path (`usePhotoPicker`) is not driven; these steps use `curl`, so an
  Expo-side picker regression is not covered. Steps 10-11 narrow this but do not close it:
  they check that the ids the UI needs are *obtainable*, not that a tap obtains them.
- Escalation timing is verified by backdating, not by waiting — a wrong *interval constant*
  would still pass. Assert the constant in the unit suite instead.
