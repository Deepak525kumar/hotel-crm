# ADR-069: Rework Is a New Assignment Linked to the Original

- **Status:** Accepted — ratified by the commissioning human on 2026-08-18, choosing "create a new
  linked rework assignment" from the three options put to them, with the cost (roster, metrics,
  possible payroll effects) stated in the question.
- **Date:** 2026-08-18
- **Scope:** `CONFIRMED_REQUIREMENTS_REGISTER.md` §14 (REWORK FLOW); `SPEC-QUAL-001` `[TARGET]`
  rework loop; `WorkerAssignment` and `QualityVerification` in `schema.prisma`.
- **Supersedes:** none. **Amends:** nothing frozen. `SPEC-QUAL-001` records the rework loop as
  `[TARGET] … UNBUILT` and deliberately leaves the operational shape open; this decides that shape.
- **Change class:** Product + architecture decision. It creates domain rows that other modules
  already aggregate, so it is a Decision Record rather than an implementation choice.

---

## 1. Context

CRR §14 confirms a rework flow — checker assigns rework to a specific worker, worker is notified via
inbox **and** push, worker uploads a photo and marks it done, checker is notified, and a
**20-minute** miss escalates to Manager and Checker. All of §14 is `✅`/`🔵` (confirmed include /
confirmed rule); none of it is excluded.

What exists today is only the word. `QualityService.createVerification` derives
`NEEDS_REWORK` from a 40–69 score and enqueues one notification. The assignment is untouched, no
rework artifact is created, and the dormant `QualityVerification.rework_required`,
`rework_notes`, `rework_completed_at` and `photo_urls` columns are never written.

`SPEC-QUAL-001` specifies the loop but deliberately does not settle what rework *is* operationally.
Three shapes were put to the commissioning human:

1. Track it on the verification only (assignment untouched).
2. Reopen the original assignment (`COMPLETED → IN_PROGRESS`).
3. Create a new assignment linked to the original.

## 2. Decision

**Rework creates a NEW `WorkerAssignment`, linked to the assignment that failed inspection.**

1. The new row carries `rework_of_assignment_id` pointing at the original, and
   `rework_verification_id` pointing at the `QualityVerification` that triggered it. Both are
   nullable; a normal assignment has neither.
2. The original assignment is **not** mutated. It stays `COMPLETED` with its own attendance and
   history intact.
3. The triggering verification records `rework_required`, `rework_notes` and — on completion —
   `rework_completed_at`, so the verification remains the inspection record and the assignment
   remains the unit of work.
4. The rework assignment is created for the **same worker** (CRR §14: "a specific worker") at the
   same hotel, dated the day the rework is assigned.

Option 2 was rejected on a concrete ground rather than taste: `completion_rate` and `on_time_rate`
are computed from assignment status (`refreshWorkerOverallRating`), so reopening a COMPLETED
assignment silently rewrites the worker's historical performance. Option 1 was rejected because it
leaves rework unschedulable and invisible to every roster surface.

## 3. Metrics: rework is excluded from the ratio denominators

This is the part with real blast radius, and it is decided here rather than left to the
implementation.

The 2026-08-13 fix to `refreshWorkerOverallRating` established the principle that the denominator
counts assignments the worker was **actually responsible for completing** — which is why cancelled
and not-yet-due assignments are excluded. A rework assignment is a *second* row for work the
worker was already counted on once.

**Rework assignments are therefore excluded from `total_assignments`, `completion_rate` and
`on_time_rate`** (`rework_of_assignment_id IS NULL` is added to `dueAssignmentWhere`, and the
attendance numerator inherits it through the same relation filter that the 2026-08-18 fix
introduced).

Counting them would double-count one room: the original already counts as COMPLETED, and the
rework would count again — halving a worker's completion rate for a single failed inspection, then
restoring it on completion. That is a compounding, non-obvious penalty on top of the quality score
the inspection already produced, which is the mechanism the platform actually uses to record poor
work.

**Consequence, accepted:** rework does not itself depress completion metrics. Poor work is already
reflected in the 0–100 quality score and its aggregate. If the business later wants rework to carry
its own metric, it should be a distinct counter (like `worker_cancellations`, which is reported as
a plain count and deliberately kept out of every ratio) rather than folded into these ratios.

## 4. What this does NOT decide

- **Payroll.** Whether a rework assignment is paid is not settled here and no payroll code reads
  these rows today. It is a business decision; the link field makes rework identifiable so payroll
  can exclude or price it deliberately when that decision is made.
- **Rating tiers and recency-weighted averaging** (CRR §15) remain blocked on `OQ-02`/`OQ-08` —
  tier thresholds and the weighting function are unresolved product decisions and are not invented
  here.
- **The inspection checklist.** CRR §15 confirms dust / bathroom / bed linen / mirror / floor /
  minibar / fragrance / other, while `Rating.criteria_scores` is documented as punctuality /
  quality / attitude. That divergence is real and is left open.
- **Who may assign rework.** Unchanged from the existing quality gate (`quality:write`,
  checker/admin).

## 5. Implementation

- `schema.prisma` — `WorkerAssignment.rework_of_assignment_id` + self-relation, and
  `rework_verification_id`; migration adds both, nullable, with an index on the link.
- `quality/service.ts` — `createVerification` accepts photo evidence; `assignRework` creates the
  linked assignment and notifies the worker; `completeRework` records the photo and notifies the
  checker; `dueAssignmentWhere` gains the rework exclusion from §3.
- `documents/storage.ts` — reused as-is; quality evidence gets its own key prefix.
- `lib/scheduler.ts` — a job that escalates rework older than 20 minutes to Manager + Checker.

## 6. Alternatives rejected

- **Reopen the original assignment.** Rejected: it rewrites completion history and moves worker
  metrics as a side effect of an inspection outcome (see §2).
- **Verification-only tracking.** Rejected by the commissioning human: rework stays unschedulable,
  absent from the roster, and invisible to anything that reads assignments.
- **Counting rework in the ratio denominators.** Rejected in §3 — double-counts one room and
  compounds a penalty the quality score already applies.
