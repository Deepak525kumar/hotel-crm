# ADR-051: Calendar `/operations` Stub Removed; Weekly-Plan View Is a Composite Read Model, Not an Ownership Expansion

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-CAL-10`, the third sub-decision of `GD-18` (Calendar module scope, M2). Authored by the Lead Architect from `SPEC-CALENDAR-001`'s own `OD-CAL-10` entry, an evidence-based re-evaluation prompted by a real-world weekly staff planner ("Dienstplan") the commissioning human supplied mid-decision, and the commissioning human's explicit approval of a three-part resolution.
- **Date:** 2026-07-28
- **Scope:** `SPEC-CALENDAR-001`. Resolves `OD-CAL-10`. Establishes that Calendar's weekly-plan view is a composite read model under `ADR-034`'s existing read-only aggregation pattern, not a module-boundary expansion.
- **Supersedes:** none (additive — removes a stub with zero consumers; does not touch any shipped behavior).
- **Change class:** Architecture decision per Constitution §6/§7. Notable for its process: an initial recommendation (outright removal, no future path) was revised twice in response to evidence and correction before ratification — recorded in full below because the reasoning path is as load-bearing as the conclusion.

## Problem

`OD-CAL-10` disclosed that Calendar's current `/operations` stub (`GET`/`POST /hotels/:hotel_id/operations`, backed by a `DailyOperation { room_count, checkout_count, stay_over_count, notes? }` type) models manager-entered reception/occupancy data (CRR §19: checked-out rooms, long-stay guests), not calendar scheduling — a module-boundary drift with zero current consumers (`DEPENDENCY_GRAPH.yaml:512,515`).

The resolution path for this item was not linear, and the reasoning at each stage is preserved here rather than only the final answer:

1. **Initial evidence review** (this session, prior to any real-world artifact) found no module spec anywhere claims ownership of `ReceptionData`/occupancy data — Analytics explicitly disclaims it twice; Job Dispatch, Attendance, Quality, and CRM never mention it. This supported a recommendation to remove the stub and record the underlying capability as unassigned.
2. **The commissioning human supplied a real weekly staff planner ("Dienstplan")** used by the actual client, showing arrivals, departures, stayovers, and a staffing-demand range ("Bedarf Mitarbeiter") as real, currently-used operational data alongside the schedule. This was a legitimate challenge to the first recommendation: absence from CRR/PDD does not by itself prove a concept is out of scope — CRR/PDD can simply be an incomplete enumeration of the client's real workflow.
3. **Re-reading CRR §11/§33's "No rooms system" language precisely** (rather than the looser first-pass reading) showed it rejects room-level *work-decomposition* entities (individual rooms as assignable task units) — not aggregate daily counts. CRR §19 already confirms manager-entered "checked-out rooms" and "long-stay guests" as real requirements; the planner's "abreisen"/"im Hause" map closely onto those two already-confirmed items. Arrivals and a persisted staffing-demand target do not appear in CRR §19 but are the same *kind* of concept and plausible under-enumeration, not confirmed exclusions.
4. **A further correction** (from the commissioning human) noted that classifying based on the planner's *UI composition* (which fields appear together on one printed page) conflates presentation with state ownership. Re-evaluating on ownership grounds: no module in this repository's confirmed scope owns occupancy or staffing-demand state; Calendar itself should not become that owner merely because its own weekly-plan view is where a manager would want to see it alongside the schedule.
5. **The final correction** (from the commissioning human) identified the missing distinction this ADR settles: *removing ownership* and *removing the capability from Calendar's rendered view* are not the same action. `ADR-034` already established, for Analytics, that a module may read and display state it does not own, under a bounded allow-list (read-only; no bypass of the owning module's business rules; display/reporting only). The same pattern applies here.

## Decision

1. **The current `/operations` stub is removed from `SPEC-CALENDAR-001`** — `IF-CAL-GetOperations`, `IF-CAL-CreateOperation`, and the `DailyOperation` type are struck through per the append-only convention, not silently deleted from the record. This stub was the wrong shape regardless of the ownership question: a write-capable command interface is not an appropriate shape for state Calendar does not own, and it has zero consumers today (non-breaking to remove).

2. **The underlying state — occupancy (departures/stayovers, CRR §19-confirmed; arrivals, likely-missing) and staffing-demand (likely-missing, not confirmed anywhere) — remains unassigned**, pending a future Requirements Intake pass. This ADR does not assign it to any module; doing so without a documented claimant or confirmed requirement would be inventing architecture Constitution §6 disallows. CRM was noted during evidence-gathering as the strongest *thematic* candidate for a future intake to consider, but that is an observation for a future decision, not a ruling made here.

3. **Calendar's weekly-plan view (`REQ-CAL-T01`) is explicitly a composite read model, not a single-bounded-context view.** It may, once the state above has a confirmed owner and requirement, aggregate that externally-owned data for display alongside Calendar's own owned state (`state-calendar-absence`) and assignment facts read from Job Dispatch. This composition is governed by the identical read-only, no-bypass, display-only allow-list `ADR-034` already ratifies for Analytics' cross-module reads. Reading and rendering a value under that allow-list never confers ownership.

4. **Calendar's own owned state is unchanged and unexpanded: exactly `state-calendar-absence`.** Nothing in this decision's composite-read-model framing adds a write path, a new owned entity, or a module-boundary claim to Calendar. The "Workforce Planning module" reframing considered during this decision's evidence-gathering is explicitly **not** adopted — Calendar's charter remains scheduling-surface-plus-absence-ownership, not demand-driven workforce planning.

## Rationale

- **Ownership and presentation are different axes, and conflating them was the error in the first two drafts of this decision.** State ownership answers "who may write this and enforce its business rules"; a read-model answers "who may display this for a legitimate consumer need." `ADR-034` already resolved the general form of this question for Analytics; applying the same resolution here is consistency, not a new architecture decision.
- **CRR/PDD absence is not proof of out-of-scope, but it is also not proof of in-scope.** The corrected position (step 3 above) — checking whether an absence is a deliberate exclusion (CRR §11/§33's explicit "no rooms system" language, read precisely) versus an incomplete enumeration (CRR §19's partial list of manager-entered facts) — is the right test, and it is why arrivals/staffing-demand are classified as *likely missing requirements* rather than either confirmed-in-scope or confirmed-out-of-scope.
- **Removing the stub is justified independent of the ownership question.** Even if the state does turn out to belong to a future Requirements-Intake-confirmed module, a write-capable command interface inside Calendar was never the right shape for it — that stub's removal is not contingent on where the state eventually lands.
- **Reserving the composite-read-model right, rather than deleting the concept outright, avoids re-litigating this exact question again once the state does get a confirmed owner.** The pattern is pre-approved; only the source data's ownership needs a future decision.

## Consequences

- `SPEC-CALENDAR-001`'s Purpose/Scope, Ownership and Boundaries, Interfaces and Contracts, and Backward-compatibility sections are updated to reflect: the stub's removal, the unassigned status of the underlying state, and the composite-read-model framing for the weekly-plan view.
- No code changes are made or authorized by this record — the stub's routes already return 501 and have no consumers; removing them from the spec has no runtime effect.
- A future Requirements Intake pass is needed to confirm (or reject) arrivals-count and staffing-demand-target as new requirements, and to assign an owning module to occupancy/reception state generally (departures/stayovers already have CRR §19 confirmation; arrivals and staffing-demand do not yet). That intake is out of scope for this ADR and for the Governance Resolution workflow generally, since it involves confirming new requirements, not resolving ambiguity in existing ones.
- This is the third of `GD-18`'s four sub-decisions; `OD-CAL-11` (auto-cancel re-broadcast) remains open.

## Compatibility

No runtime behavior changes — the `/operations` stub already returns 501 to every caller and has zero discovered consumers. No migration, no rollback concern.

## Scope note

This settles the `/operations` stub's disposition and establishes the composite-read-model pattern for Calendar's weekly-plan view. It does not assign an owner to occupancy/staffing-demand state (deferred to future Requirements Intake), does not confirm arrivals or staffing-demand as new requirements (same deferral), and does not resolve `OD-CAL-11` or any other `GD-18` sub-decision.
