# ADR-052: Calendar's Auto-Cancel Responsibility Ends at Cancellation — Re-Broadcast Policy Belongs to Job Dispatch

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-CAL-11`, the fourth and final sub-decision of `GD-18` (Calendar module scope, M2). Authored by the Lead Architect from `SPEC-CALENDAR-001`'s own `OD-CAL-11` entry and the commissioning human's explicit approval of Option (b), reframed as a bounded-context boundary decision rather than a manual-vs-automatic implementation choice.
- **Date:** 2026-07-28
- **Scope:** `SPEC-CALENDAR-001`'s `RULE-CAL-04` (same-day auto-cancel). Explicitly does not decide any Job Dispatch behavior — that remains `GD-20`'s (Job-Dispatch two-tier calendar+broadcast pivot) own scope, still open.
- **Supersedes:** none (additive — narrows disclosure of an already-built mechanism's boundary; the auto-cancel call itself, `RULE-CAL-04`, is already shipped).
- **Change class:** Architecture decision per Constitution §6/§7.

## Problem

`RULE-CAL-04`'s same-day auto-cancel (a direct in-process call to `AssignmentService.update()`, already built and ratified as permanent transport by `ADR-032`) cancels a worker's same-day assignment when they mark sick/vacation. What was left unspecified: when the cancelled assignment was itself sourced from a broadcast (a gap-fill request any eligible worker could accept), does the freed slot reopen or re-enter the broadcast pool automatically, or does it simply become vacant pending a manager's own action?

## Decision

1. **Calendar's responsibility ends at cancellation.** `RULE-CAL-04`'s existing direct in-process call to `AssignmentService.update()` is the entire extent of Calendar's involvement in this flow. Calendar does not reopen, recreate, or re-broadcast the freed slot itself, and does not call into any broadcast-initiation mechanism.

2. **Whether the freed slot reopens or re-broadcasts is a Job Dispatch decision, not a Calendar decision.** This question belongs entirely to the Job Dispatch bounded context, to be addressed (if and when it is) during `GD-20` (Job-Dispatch two-tier calendar+broadcast pivot), which remains open.

3. **This decision does not prohibit future dispatch-side automation.** Job Dispatch may later decide, as part of `GD-20`'s own resolution, to automatically re-broadcast a Calendar-cancelled slot, or to require manual manager re-initiation, or any other policy — that choice is unconstrained by this ADR. What this decision fixes is only that Calendar itself never becomes the trigger or decision-maker for that policy, regardless of what Job Dispatch eventually decides.

## Rationale

- **This is a bounded-context boundary question, not an implementation-shape question.** The original framing (auto-re-broadcast vs. manual vs. conditional-on-source) treated this as "how should the platform behave," but the more precise question is "which module decides how the platform behaves" — and the answer is Job Dispatch, since broadcast policy (what happens to an unfilled slot, under what conditions, with what urgency) is squarely that module's own domain, not Calendar's.
- **Deciding this now, ahead of `GD-20`, would risk conflicting with whatever `GD-20` eventually settles about the broadcast model's shape.** `GD-20` is explicitly about restructuring Job Dispatch's calendar/broadcast relationship — pre-committing Calendar to trigger or not trigger re-broadcast would constrain that still-open decision unnecessarily.
- **Explicitly disclaiming prohibition of future automation** avoids this ADR being misread as a permanent "no auto-re-broadcast, ever" ruling — it is a boundary statement (who decides), not a policy statement (what is decided).

## Consequences

- `SPEC-CALENDAR-001`'s `OD-CAL-11` is resolved: Calendar's auto-cancel scope is confirmed to end at the cancellation call itself; no re-broadcast behavior is added to or expected of Calendar.
- `GD-20` (still open) retains full latitude to decide re-broadcast policy for Calendar-cancelled slots as part of its own resolution — this ADR neither answers nor forecloses that question.
- **This is the fourth and final `GD-18` sub-decision — `GD-18` (Calendar module scope, M2) is now fully resolved**, alongside `ADR-049` (timezone anchor), `ADR-050` (RM edit scope), and `ADR-051` (`/operations` stub disposition).
- No code changes are made or authorized by this record — `RULE-CAL-04`'s existing cancellation call already matches this decision's scope exactly.

## Compatibility

No runtime behavior changes — `RULE-CAL-04`'s cancellation call is already shipped and already stops at cancellation (no re-broadcast code exists to remove). No migration, no rollback concern.

## Scope note

This settles only the boundary question (which module decides re-broadcast policy). It does not decide the policy itself — that is `GD-20`'s own scope, unconstrained by this record.
