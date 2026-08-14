# E2E Run — 2026-08-14 — scenario 03 against merged main

- **Commit under test:** `120dcd3` — `main` after #458, #461, #460, #462 all merged.
- **Environment:** local dev, **no Docker** (daemon unavailable in this container) — Postgres 16
  and Redis run natively. A deviation from scenario 00 §1, recorded rather than glossed.
- **Executed by:** Claude Opus 5 (Claude Code)

## Why this run exists

Three merged PRs changed authorization (checker RBAC, the `updateUserRole` assignment gate, and
worker leaderboard scope under `ADR-067`). Scenario 03 is the suite built to catch cross-scope
leaks and had not been run all session — the scope tests written alongside those changes are
unit-level.

## Scenario 00 gate

`No difference detected.` — **first clean run.** The `DailyShiftSummary` FK mismatch that made
this gate fail since the table was introduced was fixed in #461. Any difference reported from
now on is new and means something.

## Results

| Step | Result | Notes |
|---|---|---|
| 1 Manager queue | **PASS** | Sees `E-S03-A` (own hotel), does **not** see `E-S03-B` (other group). Positive and negative both established, per the scenario's own trap warning. |
| 2 RM queue | **PASS (expectation stale)** | Empty — see divergence below. |
| 3 Admin queue | **PASS** | Sees the unrouted applicant; **no `password_hash`** in payload. |
| 4 Worker / Checker | **PASS** | `403` for both. |
| 5 Cross-scope actions | **PASS** | `approve` / `reject` / `assign` / `deactivate` all `403`. |
| 6 Document access | **PASS** | In-scope manager `200`, out-of-scope manager `403`, worker self `200`, worker cross-worker `403`. |
| 7 Frontend gating | **NOT RUN** | |
| 8 Deactivated actor loses scope | **NOT RUN** | Covered in scenario 06. |

## Scenario expectation that is now stale

**Step 2** states an RM "sees applications targeting hotels within group A". The queue is no
longer group-wide: it is filtered by `resolveReviewerRecipients()` — the same resolver that
routes review notifications — so an application appears only for its *designated* reviewer.

`E-S03-A` targets a hotel that has a manager, so it routes to that manager and correctly does
**not** appear for the RM or for Admin. `E-S03-B` targets a hotel with no manager and falls
through to Admin. The RM's empty queue is the documented state #454 exists to explain, not a
defect.

Step 2 should be reworded to "an RM sees applications for hotels in their group **that have no
manager to route to**", with a positive case seeded accordingly. Not corrected in this pass.

## Method note for the next run

Step 5's `assign` and `deactivate` first returned `422`, not `403` — the request bodies were
malformed (`assign` needs `hotel_group_id`; `deactivate` needs `deactivation_reason`, not
`reason`), so validation rejected them *before* the scope check ran. A `422` here proves
nothing about authorization. Re-run with valid bodies: both then returned `403`. The scenario's
snippet omits the bodies; supply them or the step silently tests the wrong thing.

## Still not verified

1. **Scenario 04 (S3 upload)** — no AWS credentials. Documents seeded via Prisma throughout;
   the real upload path remains unexercised.
2. **Scenario 05 (race conditions)** — not run.
3. **Scenario 03 steps 7 and 8** — not run.
4. **UI parity, mobile vs web** — never done systematically; pages were verified to render, not
   compared for label/flow consistency.
5. **`docker-compose` itself** — never validated, since the daemon is unavailable here.

## Scenario files updated this run

None. The Step 2 staleness and the Step 5 request-body trap are recorded above; correcting the
scenario file is the next pass's work.

---

# Scenario 05 — Race Conditions (same run, same commit)

## Results

| Step | Result | Evidence |
|---|---|---|
| 1 Concurrent approve + reject | **PASS** | `approve 200`, `reject 422`, final `ACTIVE`, **one** history row `PENDING->ACTIVE` |
| 2 Concurrent identical approvals | **PASS** | `200` + `409`, final `ACTIVE`, **one** history row |
| 3 Concurrent assign to two groups | **PASS** | `200` + `409`, one group won, `version=2` |

No step produced two successes or two history rows — the failure shape the scenario exists to
catch (`PENDING->REJECTED` **and** `PENDING->ACTIVE` both claiming to start from `PENDING`) did
not occur.

## The trap that nearly produced a false pass

The first attempt looked like a pass and was **vacuous**. Step 1 returned `approve 409` /
`reject 200` with exactly one history row — which matches the stated pass criteria almost
exactly. It was wrong: the `409` was the **contract gate**
(*"the worker does not have an approved contract"*), not the optimistic-concurrency guard. The
two requests never actually raced; one was refused on a precondition before reaching the write.

Step 2 exposed it, because there **both** approvals returned `409` and no transition happened at
all — impossible to read as a concurrency pass, which forced a look at the response bodies.

`approve` requires a `Contract` in `ACTIVE`/`EXTENDED`/`PERMANENT`. Seeding a submitted
`EmploymentRecord` is **not** sufficient to exercise the approve race. With contracts seeded,
all three steps raced genuinely and passed.

**The scenario's preconditions should say so.** They currently warn only that "a consumed record
silently makes a race test vacuous"; an *ungated* record does the same thing, and the resulting
409 is indistinguishable from the concurrency 409 unless the body is read. Always assert on the
error **message**, not just the status code.

## Deviation from the scenario's stated codes

Step 1's loser returns **422** *"Illegal employment status transition: ACTIVE -> REJECTED"*, not
the `409 "Record has been modified by another process."` the scenario predicts. Both are correct
refusals and the invariant holds (one winner, one history row) — the loser is caught by the
status-transition guard, having read the post-approve state, rather than by the version guard.
Step 2 and step 3 do return the documented `409` from the version guard. Worth reflecting in the
scenario so a future run does not treat the 422 as a failure.
