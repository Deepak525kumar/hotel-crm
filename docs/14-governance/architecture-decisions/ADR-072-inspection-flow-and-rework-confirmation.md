# ADR-072: Checker-Initiated Inspection, Rework Confirmation, and Rework/Attendance Separation

- **Status:** Accepted — ratified by the commissioning human on 2026-08-26, answering three options
  put to them (rework deadline, unconfirmed-rework disposition, inspection picker scope) with the
  cost of each stated in the question.
- **Date:** 2026-08-26
- **Scope:** `CONFIRMED_REQUIREMENTS_REGISTER.md` §14 (REWORK FLOW) and §15 (QUALITY & RATINGS);
  `ADR-069`; `QualityService`; `ReworkEscalationJob`; `WorkerAssignment` and `QualityVerification`
  in `schema.prisma`; checker app, worker app, and the web manager surfaces.
- **Supersedes:** none. **Amends:** `ADR-069` §2 (adds a confirmation state between the worker's
  upload and closure) and its silence on attendance. **Does not amend CRR §14** — see §2.1.
- **Change class:** Product + architecture decision. It adds a state to a shipped state machine and
  changes which rows reach attendance, so it is a Decision Record rather than an implementation
  choice.

---

## 1. Context

The rework loop shipped under `ADR-069`: rework is a new `WorkerAssignment` linked to the one that
failed inspection, the worker uploads mandatory photo evidence and marks it done, and a 20-minute
miss escalates. What shipped is sound but incomplete against how the flow is actually used:

- **There is no way to start an inspection.** The checker app opens on an attendance queue
  (`mobile/checker-app/src/app/(app)/index.tsx`) listing unverified attendance records. Inspecting a
  worker means finding their attendance row. There is no "start inspection" action and no way to
  pick a worker.
- **The worker's upload closes the rework.** `QualityService.completeRework` sets the rework
  assignment to `COMPLETED` and notifies the checker. The checker is told, but has no say: by the
  time they look, the loop is already closed. There is no queue of reworks awaiting their review.
- **Rework is not separated from attendance.** `ADR-069` excluded rework from the performance-ratio
  denominators and the day-exclusivity index, but said nothing about attendance.
  `rework_of_assignment_id` appears nowhere in the attendance module, so nothing prevents a rework
  assignment producing an attendance record or surfacing in an attendance queue.
- **The worker cannot see the checker's evidence.** The API has always permitted it
  (`assertCanViewVerification` returns early for the inspection's subject,
  `backend/src/modules/quality/service.ts:892`). No client screen consumes it.

## 2. Decisions

### 2.1 The worker is shown 15 minutes; escalation stays at 20

The rework countdown presented to the worker is **15 minutes**. The auto-escalation threshold stays
at **20 minutes** (`REWORK_DEADLINE_MS`).

This is deliberate and is **not** a divergence from CRR §14, which specifies the escalation
threshold, not what the worker is shown. The five-minute gap is a grace period: the worker is asked
for urgency, and the manager is not pulled in the moment the worker is thirty seconds late. Both
numbers are stated here so a future reader does not "fix" the mismatch by aligning them — that would
either weaken CRR §14 or make every slightly-late rework an escalation.

### 2.2 Escalation notifies the inspecting checker and the worker's manager, and is openable

On a 20-minute miss, the recipients are **the specific checker who performed the inspection**
(`QualityVerification.verified_by_id`, not "any checker at the hotel") and **the worker's manager**.

The notification must be **openable**: its payload carries enough for the client to route to a
detail view showing the inspection photos, the rework notes, the worker, the hotel, and the shift
the work belongs to. A notification that only says "rework is overdue" makes the recipient hunt for
the context; the whole point of escalating is that someone can act immediately.

### 2.3 Rework closes on checker confirmation, and auto-closes if the checker is silent

The worker's upload no longer closes the rework. It moves the rework to **awaiting checker review**,
and the checker gets two outcomes, mirroring the inspection itself: confirm (closing the rework) or
send it back.

If the checker never confirms, the rework **auto-closes after a delay**. Silence is treated as
acceptance. This was chosen over "stays open indefinitely" (work hangs, and the roster carries an
assignment nobody will close) and over "escalate to the manager" (the manager is already escalated
for the overdue case in §2.2; escalating again for a checker's silence turns a review backlog into
manager noise).

The cost is stated plainly: **a bad rework can auto-close unreviewed.** That is accepted because the
evidence is retained on the verification either way, and because the alternative — an unbounded
queue of open reworks — was judged worse operationally.

To make the confirmation real rather than nominal, the checker app gains a **dedicated review tab**
listing every rework in flight and its state. Confirmation cannot depend on the checker still having
the push notification.

### 2.4 A rework assignment never produces attendance

Rework assignments are excluded from attendance entirely: no attendance record is created for one,
and they do not appear in any attendance queue.

Rework is corrective work on a shift that already happened and already has its own attendance row on
the original assignment (`ADR-069` §2.2 keeps the original intact). A second attendance record for
the same shift would double-count the worker's presence and pollute the checker's queue with rows
that have no check-in. This is the attendance-side counterpart of the exclusions `ADR-069` already
made for the ratio denominators and the day-exclusivity index, and is stated here because
`ADR-069` did not.

### 2.5 Inspection starts from a worker picker scoped to today's shifts

The checker starts an inspection from an explicit action and picks the worker. The picker lists
**workers with an assignment dated today at any hotel in the checker's scope**.

"Any hotel in scope" rather than the checker's own hotel: a checker who covers several hotels in a
day should not have to re-scope between them. Check-in state is deliberately **not** a filter — a
checker may need to inspect (or record the absence of) work by someone whose attendance is missing,
and filtering on check-in would hide exactly that case.

### 2.6 Evidence visibility is symmetric, and universal

A worker can view the checker's photos for their own work — **all of it, not only rework**. The
authorization for this already exists and is unchanged; what is added is the client surface.

This is stated as a decision because it is a disclosure rule, not a UI preference: the worker is the
subject of the record, and a score that affects their rating tier should not be evidence they cannot
see.

## 3. Consequences

- `QualityVerification` gains a state for "rework done, awaiting checker confirmation" and a
  confirmation timestamp. `rework_completed_at` keeps its current meaning (the worker finished);
  closure becomes a separate, later fact.
- A second scheduled job (or a second predicate on the existing one) auto-closes unconfirmed
  reworks. It must be idempotent in the same way `ReworkEscalationJob` is — a marker column in the
  same transaction as the state change, and part of the query predicate.
- The attendance module gains an explicit `rework_of_assignment_id IS NULL` predicate. This is the
  third place that predicate appears; if a fourth arrives, it should become one named helper.
- The checker app gains: a start-inspection entry, a worker picker, explicit approve/rework outcomes,
  and a review tab. The worker app gains a screen for viewing checker evidence. The web manager
  surfaces gain the rework state so a manager can see what their escalation is about.
- Existing reworks in flight at deploy time have no confirmation timestamp. They are already
  `COMPLETED`; the migration must not retroactively reopen them.

## 4. The three follow-on decisions

Taken 2026-08-27, after the section above recorded them as open. Kept in this ADR rather than a
new one: they settle this ADR's own gaps and are meaningless apart from it.

### 4.1 Unconfirmed rework auto-closes after one hour

The delay left open in §2.3 is **one hour** from the worker marking the rework done.

An hour is long enough that a checker mid-inspection is not racing a timer, and short enough that a
rework does not sit unreviewed past the shift it belongs to. Nothing currently measures how quickly
checkers actually review, so this is a judgement, not a derivation — if review latency is ever
measured, this is the number to revisit first.

### 4.2 Sending a rework back creates a second rework assignment

A checker who rejects the evidence creates **another** rework assignment linked to the same
verification, rather than reopening the one just completed.

This follows `ADR-069`'s reasoning rather than diverging from it: a unit of work that the worker
finished and submitted is not retroactively unfinished. Each cycle is therefore its own
`WorkerAssignment` row, and the cycle history is the set of rework assignments hanging off the
verification — which is where a reviewer would look for "how many times did this come back".

The consequence to hold onto: the verification's `rework_completed_at` means *the current cycle is
complete*, not *rework is finished*. Closure is `rework_confirmed_at`, and only that. Anything
reading `rework_completed_at` as "done" is reading it wrong.

Nothing here bounds the number of cycles. An unbounded send-back loop is possible and is accepted
for now; if it happens in practice the cap belongs in a later decision, with a number that came
from real data.

### 4.3 Rework time is not tracked for payroll

Rework carries **no payroll or time-tracking treatment**. It produces no attendance (§2.4), no
worked-time record, and no payroll line.

This closes the question `ADR-069` left open. Rework is corrective work on a shift already paid
through its original assignment. If that changes commercially, it is a new decision — not something
to be inferred from the absence of a column.

---

## 5. Structural findings from a second, closer audit (2026-08-27)

The first pass through this ADR treated the requested flow as mostly wiring over what `ADR-069`
shipped. A closer audit of the schema and the checker app says otherwise. Four findings below block
the flow as described; none can be settled by implementation choice.

### 5.1 There is no room-level unit of work anywhere

The requested flow is phrased per room — "he has to do **that room** in 15 minutes". The data model
has no room-level work unit at all. `schema.prisma:421` states it outright: *"full-day
WorkerAssignment — no room-level task layer implied."*

Rooms exist only as `RoomsCompletedEntry`, a **manager-entered count** against the whole assignment
(`schema.prisma:1278`), not as individually assignable, inspectable things. So "that room" has
nothing to point at: an inspection cannot name a room, a rework cannot be scoped to one, and a
worker cannot be told which room to redo except in free text in the notes.

Either the flow is per-assignment (the notes carry the room, informally), or a room-level task layer
is introduced — which is a substantially larger change than this ADR anticipated, touching
assignment, inspection, rework and the roster.

### 5.2 One inspection per assignment, ever

`QualityVerification.assignment_id` and `Rating.assignment_id` are both `@unique`
(`schema.prisma:1152`, `:1188`) — 1-to-1 with `WorkerAssignment`.

A checker therefore cannot inspect the same worker's shift twice. Picking a worker who has already
been inspected today cannot produce a second inspection; it collides. The requested flow — start an
inspection, pick any worker on shift — assumes inspections are repeatable, and today they are not.

This is independent of §4.2's send-back decision: reworks are assignments and multiply freely; it is
*inspections* that are capped at one.

### 5.3 The checklist and the score live on two unconnected records

The checker app's inspection screen calls `createVerification({ assignment_id, score, notes })`
(`mobile/checker-app/src/app/quality/[id].tsx:64`) — score and notes, **no checklist**.

The checklist (`criteria_scores`, keyed to `INSPECTION_CHECKLIST_ITEMS`) lives on **`Rating`**, via a
separate `createRating` call. Rework hangs off **`QualityVerification`**. Both are 1-to-1 with the
assignment, and nothing in the client links them.

So the requested sequence — photos → checklist → score → approve/rework — spans two records that are
created by different endpoints, and the rework decision attaches to only one of them. Whether these
become one record, or one flow writing both in a transaction, is a decision, not a detail.

### 5.4 Approve versus rework is currently derived from the score, not chosen

`deriveStatus()` (`quality/[id].tsx:35`) maps score to outcome: ≥70 `PASSED`, 40–69 `NEEDS_REWORK`,
below that failing. The service then refuses rework on a `PASSED` verification
(`quality/service.ts:380`).

The requested flow gives the checker two explicit buttons after the checklist. That conflicts
directly: a checker who scores work 85 but wants it redone cannot currently ask for rework, because
85 derives `PASSED`. Either the score stops deciding the outcome, or the buttons are constrained by
it. Both are defensible; they are not the same product.

### 5.5 Status

Resolved the same day in §6 below. §§1–4 of this ADR stand and are unaffected.

---

## 6. Resolutions to §5, and their costs

Taken 2026-08-27, each answering one finding above.

### 6.1 A room field that names the room and does nothing else

The inspection gains a **dedicated room field**, separate from the notes. It is a label: it names
which room the inspection and any resulting rework are about, and **no logic reads it**. No room-level
task layer is built (§5.1's third option is explicitly declined).

Kept separate from `rework_notes` deliberately — the notes say *what was wrong*, the room field says
*where*. Merging them would make the room unreadable to any future screen that wants to show it.

The cost, stated so it is not discovered later: the room is **not validated against the hotel's
actual rooms**, not queryable as a relation, and two checkers may write the same room differently
("204", "Room 204"). That is accepted for now. Making it real data later means adding the relation
and backfilling free text — which is why it is a distinct field rather than prose, so the backfill
has something to parse.

### 6.2 Inspections become repeatable per shift

The `@unique` on `QualityVerification.assignment_id` (and on `Rating.assignment_id`, which the same
flow writes) is **dropped**. A checker may inspect the same worker's shift as often as needed —
including re-inspecting after a rework, which §2.3's confirmation step effectively requires.

Consequences: the 1-to-1 relations become one-to-many, and anything reading "the verification for
this assignment" must now choose — latest, or all. Every such reader is part of PR 1's scope, not a
follow-up.

### 6.3 One flow writes both records in one transaction

Rating and `QualityVerification` **stay separate records**; the inspection flow writes both in a
single transaction. No migration merging them, and `Rating` keeps feeding `WorkerOverallRating`
exactly as it does now.

This was chosen over merging them because the merge touches the leaderboards, the rating tiers and
the rework loop at once, for an end state that is tidier but not more capable. The two records stay
consistent by construction because nothing writes one without the other.

The rule that follows: **there is no supported path that creates a verification without its
rating, or the reverse.** If a second caller ever needs one alone, that is a decision to revisit
this, not a reason to add a partial write.

### 6.4 The checker decides the outcome; the score is a record, not a gate

Approve and Rework are both always available, whatever the score. `deriveStatus()`'s thresholds stop
deciding the outcome, and the service check that refuses rework on a `PASSED` verification
(`quality/service.ts:380`) is removed.

A checker may rework work they scored 85, or approve work they scored 55. The score remains the
quality record and still feeds the rating; it no longer constrains the checker's judgement about
whether the work must be redone.

The cost: outcome and score can disagree, and reporting that assumed "passed means score ≥ 70" will
be wrong. Anything deriving an outcome from a score must read the recorded outcome instead.

### 6.5 Every inspection counts toward the rating

With §6.2 allowing many inspections per shift, **all of them feed the rating** — the existing
aggregation is unchanged.

The cost was put explicitly and accepted: **a worker inspected three times in a day carries three
times the weight of a worker inspected once.** Inspection frequency therefore influences a worker's
rating independently of their work. If that distorts the leaderboard in practice, the fix is a
per-shift weighting decision, and it should be made from real data rather than pre-empted here.

