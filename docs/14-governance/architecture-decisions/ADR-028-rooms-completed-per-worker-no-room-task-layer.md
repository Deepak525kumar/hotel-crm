# ADR-028: "Rooms Completed Per Worker" — Retained as a Basic-Analytics Metric, Redefined Without a Room-Level Task Layer

- **Status:** Accepted. Ratified directly by the project owner (human decision, recorded 2026-07-22, session `claude/epic-5-verification-next-u5tet9`) — Constitution §20 human/product authority. The human was shown the exact conflict below and asked to choose among three options; they chose "keep the metric, but redefine it without introducing a room-level task layer," with the concrete shape (manager-entered daily integer tied to the worker's full-day assignment, not a per-task record, not squeezed into `ReceptionData`) proposed by the orchestrating session and accepted.
- **Date:** 2026-07-22
- **Scope:** Data model / product-decision resolution — resolves `SPEC-ANALYTICS-001` `OQ-ANALYTICS-03` (headline, blocking) and `REQ-ANALYTICS-013`'s previously-BLOCKED acceptance criteria: whether the confirmed "rooms completed per worker" basic-analytics metric (PIVOT §14 Appendix) can coexist with the confirmed no-room-level-task-layer decision (CONFIRMED §33), and if so, what it is captured as. Closes `SIR-ANLY-003`.
- **Supersedes:** none. First Decision Record for this open question — a prior pass in this same session recorded `SIR-ANLY-003` as **STILL OPEN** with an escalation note (a supplied decision that session addressed a different question and was correctly not applied here; see `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-ANLY-003`, "escalation note" dated 2026-07-22). This record is the first ADR to actually resolve `OQ-ANALYTICS-03`.
- **Change class:** Material data-model / product decision requiring a Decision Record per Constitution §6/§7, same class as `ADR-011`/`ADR-021`/`ADR-023`. `SPEC-ANALYTICS-001`'s FROZEN text is corrected at its next revision (Correction-class forward-note), not by this record, mirroring the `ADR-025`/`ADR-026` precedent.

## Problem

`SPEC-ANALYTICS-001` (FROZEN, v0.2.0) records `OQ-ANALYTICS-03` as a blocking, headline open decision — a genuine contradiction between two authority documents that the specification itself could not resolve:

- `CONFIRMED_REQUIREMENTS_REGISTER.md` §33 (`docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md:387`): "No room-level task layer — 'Task' and 'Work Request' do NOT need separating; full-day employment model."
- `PIVOT_DESIGN_DOCUMENT.md` §4.9 (`docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md:131`): "Manager logs rooms completed per worker (compared against task start)." Also listed at §14 Appendix (line 490) as one of four required "basic analytics" metrics (`REQ-ANALYTICS-013`).

The specification's own Migration Gap analysis (`MIG-GAP-ANALYTICS-02`) additionally flagged that it had **inferred, without citation**, that this data would land on the target `ReceptionData` model — but `ReceptionData`'s own definition (PIVOT §9.3 line 397) is only "Manager-entered checkout / long-stay data," lists no rooms-completed field, and PIVOT §9.5 explicitly defers "room/scheduling expansion" as out-of-scope for this pivot. That inference was never valid and is not carried forward by this record.

A prior human-decision session in this same branch attempted to close `SIR-ANLY-003` but supplied a decision about a materially different question (raw-KPIs-as-source-of-truth vs. a single opaque aggregate performance score) that does not appear anywhere in this repository's corpus; it was correctly **not applied** to this row (see the row's own "escalation note," dated 2026-07-22) and the item was re-escalated. The project owner was then shown this exact conflict directly and asked to choose among: (1) drop the metric, (2) keep it but redefine it without a room-level task layer, (3) accept an authority override reinstating a room-level layer. They chose **(2)**.

## Decision

1. **"Rooms completed per worker" is retained** as one of the four confirmed basic-analytics metrics (`REQ-ANALYTICS-013`), not dropped. `CONFIRMED_REQUIREMENTS_REGISTER.md` §33's no-room-level-task-layer decision is **not overridden** — this record does not reintroduce "Task"/"Work Request" separation, per-room records, or any room-level entity anywhere in the schema.
2. **The metric is captured as a manager-entered daily integer count, tied 1-to-1 to the worker's full-day `WorkerAssignment`** (the shipped "worker's day" entity — `WorkerAssignment` is keyed to a `WorkRequest.shift_date`, i.e. one row per worker per shift/day; the target `CalendarEntry` model PIVOT §9.3 describes for this same concept is itself unbuilt, owned by Job Dispatch per `ADR-021`, and not yet part of shipped schema). This is a new, purpose-built model, `RoomsCompletedEntry`, added by this record's implementation — **not** a per-task or per-room record, and **not** a new task-layer entity of any kind. It structurally mirrors the existing `Attendance`/`QualityVerification`/`Rating` precedent: `assignment_id` unique (1-to-1 with `WorkerAssignment`), denormalised `hotel_id`/`worker_id`, an `entered_by_id` actor (the manager), a count, and timestamps.
3. **PIVOT §4.9's literal wording is NOT carried forward in full.** The source sentence — "Manager logs rooms completed per worker (compared against task start)" — presupposes a "task start" concept that only exists under a room-level task layer, which CONFIRMED §33 rules out. This record retains only the count itself ("rooms completed per worker"); the parenthetical comparison-against-task-start is explicitly dropped as untenable under the confirmed full-day employment model. There is no "task start" for a full-day assignment to compare against in the shipped or target schema.
4. **The new field/model is explicitly NOT added to `ReceptionData`.** `ReceptionData` (PIVOT §9.3 line 397, itself unbuilt target state) is scoped only to "Manager-entered checkout / long-stay data" per its own definition; rooms-completed data was never validly inferred to belong there (see Problem, above), and this record does not revive that inference.
5. **Ownership:** `RoomsCompletedEntry` is owned by `backend-assignments` (the authoritative writer of the parent `state-worker-assignment` domain) — the write is a same-module extension of closing out an assignment (the manager logs the count at/after completion), not a distinct verification/rating capability. This differs from the `Rating`/`QualityVerification` precedent (owned by a separate `backend-quality` module performing checker/manager verification), a deliberate, evidence-grounded choice given the entry is manager-only (PIVOT §4.9), not checker-eligible, and has no independent verification workflow of its own.
6. **Analytics wiring:** `backend-analytics` reads `RoomsCompletedEntry` (never writes it, consistent with its own FROZEN "read-only, no owned state" scope) to expose a `rooms_completed` aggregate (`total`, `entries`) on both `getDashboardStats` and `getHotelSummary`, alongside the other three basic-analytics metrics already surfaced there, making the metric an actual derivable read, not a write-only field.

## Grounding facts (verified against repository authority)

- `CONFIRMED_REQUIREMENTS_REGISTER.md:387` (§33): "No room-level task layer... full-day employment model" — the constraint this record must not violate.
- `PIVOT_DESIGN_DOCUMENT.md:131` (§4.9): "Manager logs rooms completed per worker (compared against task start)" — the metric's source, with the task-start comparison identified and dropped (Decision item 3).
- `PIVOT_DESIGN_DOCUMENT.md:490` (§14 Appendix): "rooms-completed per worker" listed as one of four confirmed basic-analytics metrics, "derived from existing data, no new pipeline" — this record treats the new `RoomsCompletedEntry` table as an addition alongside, not a violation of, that framing (the metric derives from a single new manager-entry table, not a new pipeline/process).
- `PIVOT_DESIGN_DOCUMENT.md:397` (§9.3): `ReceptionData` = "Manager-entered checkout / long-stay data" only — grounds Decision item 4.
- `docs/03-modules/analytics/MODULE_SPEC.md` `OQ-ANALYTICS-03` (~line 500), `REQ-ANALYTICS-013` (~line 99/161), `MIG-GAP-ANALYTICS-02` (~line 439): the specification's own record of this exact contradiction and its un-cited `ReceptionData` inference.
- `backend/prisma/schema.prisma`: `WorkerAssignment` (the shipped "worker's day" entity, keyed to `WorkRequest.shift_date`), `Attendance`/`QualityVerification`/`Rating` (the existing 1-to-1-with-assignment, manager/checker-entered precedent this record's `RoomsCompletedEntry` mirrors).
- `.claude/knowledge/DEPENDENCY_GRAPH.yaml` `state-worker-assignment` (`authoritative_writer: backend-assignments`) and `docs/14-governance/architecture-decisions/ADR-021-calendar-jobdispatch-scheduling-ownership-boundary.md` (confirms `CalendarEntry` is target/unbuilt, owned by Job Dispatch, not the current shipped "worker's day" entity).
- `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-ANLY-003`: the escalation history this record closes.

## Compatibility

| Authority | Effect |
|---|---|
| `CONFIRMED_REQUIREMENTS_REGISTER.md` §33 | Unmodified, not overridden. No room-level task layer is introduced; `RoomsCompletedEntry` is a full-day-assignment-grain record, not a per-room or per-task record. |
| `PIVOT_DESIGN_DOCUMENT.md` §4.9 | The rooms-completed-count portion is implemented; the "(compared against task start)" portion is explicitly not carried forward (Decision item 3) — recorded here as a deliberate, cited departure from the source document's literal wording, not a silent drop. |
| `PIVOT_DESIGN_DOCUMENT.md` §9.3 (`ReceptionData`) | Unaffected — no field added to this model by this record. |
| `SPEC-ANALYTICS-001` (FROZEN) | `OQ-ANALYTICS-03`, `REQ-ANALYTICS-013`'s acceptance criteria, and `MIG-GAP-ANALYTICS-02` resolve to "retained, redefined as a manager-entered `RoomsCompletedEntry` count, no `ReceptionData` inference" at the spec's next revision — a Correction-class forward-note, not made by this record (`ADR-025`/`ADR-026` precedent). |
| `IMPLEMENTATION_EXECUTION_PLAN.md` | `ANALYTICS OQ-ANALYTICS-03` ledger row updated in this same governance pass from "OPEN — blocking, headline" to "RESOLVED — `ADR-028`." |

No blocking contradiction found against any other checked authority.

## Consequences

- `SIR-ANLY-003` is marked RESOLVED (citing this record) in the same governance pass that adds this ADR.
- `SPEC-ANALYTICS-001` gains, at its next revision, the resolved `OQ-ANALYTICS-03` disposition in its Open Decisions / Migration Gap / target-state-interfaces sections.
- **This record authorizes a schema/runtime change**: a new `RoomsCompletedEntry` Prisma model (1-to-1 with `WorkerAssignment`, owned by `backend-assignments`), a real SQL migration, a manager-entry write path (`POST /assignments/:id/rooms-completed`, `requireRole(['admin','manager'])` + an inline hotel-scope check mirroring the `quality/service.ts` `createRating`/`createVerification` scope-authz shape from Epic 5 PR 5.5), and a read-side `rooms_completed` aggregate on `backend-analytics`'s `getDashboardStats`/`getHotelSummary`.
- `.claude/knowledge/DECISION_INDEX.md` gains this row (`ADR-028`, Accepted) in the same governance pass.
- `.claude/knowledge/DEPENDENCY_GRAPH.yaml`/`STATE_OWNERSHIP_INDEX.yaml` gain the new `state-rooms-completed-entry` domain (writer: `backend-assignments`, reader: `backend-analytics`) in the same pass.
- No calendar/scheduling capability, room/task entity, or comparison-against-task-start mechanism is authorized or implied by this record — only the manager-entered count and its read-side aggregation.
