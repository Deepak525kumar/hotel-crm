# ADR-034: Cross-Module State-Read Boundary — Direct Read-Only Prisma Reads Are the Platform Standard for Aggregators, with a Named Exception Trigger

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-13` (Cross-module state-read boundary ADR). Authored by the Lead Architect from `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-13 entry and the commissioning human's explicit approval of Option (c).
- **Date:** 2026-07-28
- **Scope:** Platform-wide cross-module state-read boundary. Resolves `SPEC-ANALYTICS-001` `OQ-ANALYTICS-11`, `SIR-ANLY-013`, `SIR-GLOB-010`. Directly informs (without amending) `docs/03-modules/quality/MODULE_SPEC.md`'s own structurally identical, already-disclosed pattern (quality is itself read from directly by `work-applications` and `analytics`).
- **Supersedes:** none (additive/ratifying). Formalizes the pattern already in use by `backend-analytics` (7 `reads-state` edges across 5 owning modules, `.claude/knowledge/DEPENDENCY_GRAPH.yaml`) and `backend-quality` (read directly by `work-applications`/`analytics`), rather than introducing a new mechanism.
- **Change class:** Platform architecture decision per Constitution §6/§7, mirroring the `ADR-032` (GD-12) precedent of ratifying working code rather than inventing new abstraction.

## Problem

Constitution §7 generally expects modules to expose explicit interfaces rather than let consumers reach into private internals. `backend-analytics` violates that by construction: it owns no state of its own, and its entire contract is direct Prisma reads across seven state domains (`state-work-request`, `state-worker-assignment`, `state-attendance`, `state-quality-verification`, `state-rating`, `state-worker-overall-rating`, `state-rooms-completed-entry`) owned by five other modules (`backend-work-requests`, `backend-assignments`, `backend-attendance`, `backend-quality`). `backend-quality`'s own specification discloses the structurally identical pattern in reverse: it is itself read directly by `work-applications` and `analytics`. Two independent architecture reviews (of `SPEC-ANALYTICS-001` and `SPEC-QUAL-001`) each classified this Medium-severity and non-blocking for that module's own G2 freeze — correctly, since the pattern is repository-wide (10+ `reads-state` edges exist) and re-litigating it per-module would be inconsistent — but neither review is itself a platform-level ratification. `OQ-ANALYTICS-11`/`SIR-GLOB-010` both explicitly name the required outcome as a single, platform-wide Decision Record, not a per-module fix.

## Decision

1. **Direct, read-only Prisma reads across module boundaries are the platform standard for aggregator/reporting modules.** A module whose purpose is to compute cross-cutting counts, averages, or summaries from state it does not own (the shape `backend-analytics` and, in reverse, `backend-quality`'s own readers already exhibit) may read another module's Prisma-modeled state directly, without requiring the owning module to expose a dedicated read-model/interface first.

2. **This is bounded by an explicit allow-list criterion, not an unconditional license:** the read must be (a) read-only — no aggregator writes back to a state domain it doesn't own, (b) a plain query against already-persisted state — it does not re-implement or bypass the owning module's own business-rule/validation logic (a dashboard count has no reason to re-run a write-path rule), and (c) not itself the source of truth for any decision the owning module's own domain logic would need to make — an aggregator's read is for display/reporting, not for driving another module's write-path behavior.

3. **A future dedicated read-model interface remains the correct escalation, not this decision's default, triggered by either of two named conditions:** (i) a source module's schema shape changes frequently enough that aggregator reads silently break or require repeated reactive fixes across releases, or (ii) a specific cross-module read query becomes a measured, confirmed performance bottleneck (naturally linked to `GD-11`'s still-open Performance SLO & workload baseline — a query cannot be "confirmed a bottleneck" without an SLO to measure against). Neither condition is met today for any of `backend-analytics`'s seven read edges or `backend-quality`'s reader edges; this is recorded as a forward-looking trigger, not new scope authorized by this ADR.

4. **This does not ratify write-side coupling of any kind.** Any module found writing into a state domain it does not own is a distinct, more severe defect (ownership violation, not a read-boundary question) and is out of scope for this decision — it would require its own architecture review, not an extension of this ADR.

## Rationale

- **Ratifies working code, invents nothing:** every edge this decision covers already exists and runs in production-shaped code (`DEPENDENCY_GRAPH.yaml`'s `reads-state` edges); two independent architecture reviews already found the pattern acceptable on its own merits. This closes the "requires a platform-wide ADR" gap both reviews flagged without requiring a refactor neither review asked for.
- **A real read-model layer (Option (b)) is speculative architecture for a problem that hasn't materialized** — Constitution §6 disfavors inventing unconfirmed architecture, and no confirmed requirement calls for interface-mediated reads today. Five-plus modules would need new interfaces for no functional payoff pre-MVP.
- **A named exception trigger costs nothing extra to build and prevents the same gap from resurfacing** as more aggregator-shaped modules appear — `backend-compliance`'s subject-rights orchestration (reads across Consent/Retention/Documents) is a plausible future candidate, though not yet confirmed to have an identical pattern; this ADR does not extend to it automatically, but gives a future reviewer a named condition to check against rather than re-litigating the whole question.

## Consequences

- `SPEC-ANALYTICS-001` `OQ-ANALYTICS-11` is resolved: the cross-module read pattern is ratified as the platform standard, subject to the three-point allow-list criterion in Decision point 2. No code change required — the existing seven `reads-state` edges already satisfy all three criteria (read-only, plain aggregation query, display/reporting only).
- `SIR-ANLY-013` and `SIR-GLOB-010` (Specification Issues Register) are resolved on the same basis.
- `docs/03-modules/quality/MODULE_SPEC.md`'s own disclosed reader pattern is confirmed to fall under this same ratification (structurally identical, cited by `OQ-ANALYTICS-11`'s own text) — no amendment to that spec is required since it carries no dedicated open-decision row of its own naming this gap.
- Knowledge-layer updates required (tracked as an exit condition of this ADR's ratification): `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-13 row should be marked Decided with a pointer here; `docs/implementation/GOVERNANCE_REGISTER.md` Part 2 should strike through GD-13; `docs/05-execution/EXECUTION_DASHBOARD.md` should reflect GD-13 as decided.
- No `.claude/knowledge/DEPENDENCY_GRAPH.yaml` edit is required — the existing `reads-state` edges are already accurately recorded; this ADR ratifies their acceptability, it does not change their shape.

## Compatibility

No runtime behavior changes as a result of this record alone — every edge it ratifies already exists and runs in shipped code. No migration, no rollback concern.

## Scope note

This settles the cross-module *read* boundary for aggregator-shaped modules only. It does not ratify any write-side cross-module coupling (a distinct, more severe class of defect, out of scope here), and it does not itself establish the Performance SLO baseline (`GD-11`, still open) that Decision point 3's second trigger condition depends on to ever be checkable — that remains its own separate, still-open decision.
