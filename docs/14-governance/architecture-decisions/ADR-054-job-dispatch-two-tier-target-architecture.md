# ADR-054: Two-Tier Calendar + Broadcast Is the Target Job-Dispatch Architecture — Implementation Timing Deferred

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving the first sub-decision of
  `GD-20` (Job-Dispatch two-tier calendar+broadcast pivot). Authored by the Lead Architect from
  `SPEC-JOB-DISPATCH-001`'s own target-state authority (`TREQ-001` through `TREQ-013`) and
  `PIVOT_DESIGN_DOCUMENT.md` §5.5/§9.1-9.3, restructured at the commissioning human's explicit direction to
  separate the architecture question ("is two-tier dispatch the correct target?") from the delivery-timing
  question ("when is it built?") — the latter reserved for `GD-20` Sub-decision 5 (Migration Strategy).
- **Date:** 2026-07-28
- **Scope:** `SPEC-JOB-DISPATCH-001`. Resolves the "overall job dispatch model" question only. Establishes the
  architectural frame that `GD-20` Sub-decisions 2 (Broadcast Lifecycle), 3 (Assignment Model), and 4
  (Background Execution) detail, and that Sub-decision 5 (Migration Strategy) schedules.
- **Supersedes:** none (additive — ratifies a target architecture already described in
  `PIVOT_DESIGN_DOCUMENT.md` and `SPEC-JOB-DISPATCH-001`, neither of which had prior governance authorization).
- **Change class:** Platform architecture decision per Constitution §6/§7 — comparable in weight to `ADR-053`
  (chatbot orchestration architecture) and `ADR-029` (background-processing architecture), each of which
  ratified a target architecture ahead of, and independent from, its own implementation schedule.

## Problem

`SPEC-JOB-DISPATCH-001`'s frozen target sections (`TREQ-001` through `TREQ-013`) already describe a two-tier
model — **Calendar (direct)** assignment with no worker accept step, plus **Broadcast (gap-fill)** via
`JobRequest` for open slots — replacing the live marketplace `WorkApplication` apply/accept flow
(`work-requests`, `work-applications`, `assignments` modules). This target was described in
`PIVOT_DESIGN_DOCUMENT.md` before this repository's current marketplace implementation existed, but was never
itself governance-ratified as the platform's actual target architecture — it has sat as an unauthorized,
frozen-but-unconfirmed spec section, tracked as 12 open migration gaps (`MIG-GAP-01..12`, `SIR-JOBD-006`).

The original framing bundled two independent questions into one: "should we build the pivot" conflated
*whether* two-tier dispatch is architecturally correct with *when* it should be implemented. Answering both at
once risks the same question being silently re-litigated after MVP, once delivery pressure changes — exactly
the failure mode `ADR-053` and `ADR-029` were structured to avoid by ratifying their target architectures
independent of build schedule.

## Decision

1. **The two-tier Calendar + Broadcast model, as specified in `SPEC-JOB-DISPATCH-001` (`TREQ-001` through
   `TREQ-013`) and `PIVOT_DESIGN_DOCUMENT.md` §5.5/§9.1-9.3, is ratified as the permanent target architecture**
   for job dispatch. This is the destination; there is no open architectural question about whether calendar-
   direct assignment plus broadcast gap-fill is the correct model.

2. **The current marketplace flow (`WorkApplication` apply/accept, live in `work-requests`, `work-applications`,
   `assignments`) is the current implementation, not the legacy implementation.** It remains the platform's
   actual, live, fully-supported behavior until a migration decision says otherwise. "Current" is used
   deliberately instead of "legacy" — legacy implies a system already being phased out or in maintenance-only
   mode, which is not true here: marketplace is under active use and was hardened as recently as Epics 1/8, and
   this record authorizes no change to that status.

3. **This record establishes only the target architecture.** It does not authorize any code change, does not
   schedule implementation, does not retire or freeze the marketplace modules, and does not decide phasing or
   sequencing. Migration, sequencing, and retirement of the current implementation are the exclusive
   responsibility of `GD-20` Sub-decision 5 (Migration Strategy) — including whether marketplace is ever
   formally retired, deferred indefinitely, or run alongside the target model during a transition.

4. **`GD-20` Sub-decisions 2 (Broadcast Lifecycle) and 3 (Assignment Model) detail this target architecture's
   own internals** (JobRequest lifecycle, eligibility, slot arbitration, notifications; WorkerAssignment/
   CalendarEntry shape, WorkApplication removal, daily exclusivity) — both presuppose this ratification and
   proceed from it. Sub-decision 4 (Background Execution) resolves the scheduled-job/concurrency mechanism
   underneath the target, independent of this record.

## Rationale

- **Separating destination from journey keeps the architecture decision durable.** The same pattern was used
  by `ADR-053` (chatbot orchestration architecture ratified with zero code written) and `ADR-029` (background-
  processing architecture ratified before all its consumers existed). Bundling "is this correct" with "when do
  we build it" would make the architecture answer expire the moment delivery priorities shift, forcing the same
  question to be re-asked post-MVP under time pressure rather than settled once, calmly, now.
- **"Current implementation," not "legacy," accurately describes marketplace's actual status.** Calling it
  legacy would misrepresent an actively maintained, recently-hardened system as something already being phased
  out, when in fact no migration has been authorized. The distinction matters because a future reader (or
  Sub-decision 5 itself) should not infer a retirement timeline that this record does not set.
- **No countervailing evidence has surfaced against the original confirmed product direction.** The two-tier
  model was CONFIRMED product intent (`PIVOT_DESIGN_DOCUMENT.md` CONFIRMED §13/§34/§37) before this repository's
  marketplace implementation was built; nothing in the current repository state argues for reversing that
  direction, only for sequencing its delivery.

## Consequences

- `SPEC-JOB-DISPATCH-001`'s target sections (`TREQ-001..013`) are governance-ratified: they are no longer an
  unauthorized frozen draft, they are the confirmed target architecture.
- The marketplace flow's status is clarified as "current implementation, unchanged, pending a migration
  decision" — this record makes no change to live code, endpoints, or data model.
- `GD-20` Sub-decisions 2, 3, and 4 may now proceed against a ratified target rather than a provisional one.
  Sub-decision 5 (Migration Strategy) inherits full responsibility for timing, phasing, and retirement — this
  record deliberately withholds an opinion on build-now vs. build-later.
- `ADR-018` (accept-transaction coupling, superseded-by-pivot classification) is now confirmed rather than
  provisional. `ADR-021` (Calendar/Job-Dispatch ownership boundary) and `ADR-052` (Calendar auto-cancel
  boundary, re-broadcast policy deferred to `GD-20`) both proceed on a now-ratified assumption instead of a
  pending one.
- No code changes are made or authorized by this record.

## Compatibility

No runtime behavior changes — the marketplace flow continues exactly as built; no target-model code exists yet
to be affected. No migration, no rollback concern.

## Scope note

This settles only the target-architecture question (two-tier vs. marketplace, permanently). It does not decide
when or how the target is built, does not retire or schedule retirement of the marketplace flow, and does not
resolve any other `GD-20` sub-decision — Broadcast Lifecycle (#2), Assignment Model (#3), Background Execution
(#4), Migration Strategy (#5), and any downstream Analytics/Attendance follow-up (#6) all remain separately
open.
