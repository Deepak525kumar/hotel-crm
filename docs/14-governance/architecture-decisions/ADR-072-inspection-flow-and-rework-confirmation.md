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

## 4. What this does not decide

- The auto-close delay itself is not fixed here. It is an operational constant, and setting it
  requires knowing how quickly checkers actually review — which nothing currently measures.
- Whether a checker sending a rework back creates a second rework assignment or reopens the first.
  `ADR-069`'s reasoning (never mutate a closed unit of work) points at a new linked assignment, but
  the loop-count implications are not worked through here.
- Payroll treatment of rework time. `ADR-069` flagged it as a possible effect and it remains open.
