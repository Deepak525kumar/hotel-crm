# ADR-035: Platform Performance SLO & Workload Baseline

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-11` (Performance SLO & workload baseline). Authored by the Lead Architect from `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-11 entry and the commissioning human's explicit approval of Option (a) with a confirmed Medium-scale workload assumption.
- **Date:** 2026-07-28
- **Scope:** Platform-wide performance SLO and workload baseline. Resolves `SIR-JOBD-004` (Job Dispatch), `SIR-ATT-009` (Attendance), `SIR-QUAL-007` (Quality), `SIR-ANLY-012` (Analytics), `SIR-EMP-014` (Employee-Management), `SIR-GEO-006` (Geo), `SIR-DOC-019(a)` (Documents), `SIR-CRM-013` (CRM, performance facet). Provides the SLO baseline `ADR-034` (GD-13) names as one of two conditions for escalating a cross-module read to a dedicated read-model interface.
- **Supersedes:** none (additive). Establishes a baseline no prior ADR set.
- **Change class:** Platform architecture decision per Constitution §6/§7, mirroring `ADR-033`'s (GD-09) precedent of setting a concrete, disclosed-as-provisional baseline now rather than deferring indefinitely for lack of real production data.

## Problem

No module in this platform defines a latency, throughput, or cardinality SLO. Multiple independent G4 performance reviews (Job Dispatch, Attendance, Quality, Analytics, Employee-Management, Geo, Documents, CRM) each recorded "needs an SLO/workload baseline" as a required-before-implementation or required-before-G8-Release-Readiness finding, but none could set one — doing so requires confirmed workload assumptions (expected roster size, concurrent user volume) that only the human product owner can supply, not something derivable from CRR/PDD or the repository alone. Concretely disclosed hot paths already exist without a target to measure against: the leaderboard is an unpaginated `take 50` query, and dashboard stats fan out to 8–11 parallel queries per request with no stated ceiling.

## Decision

1. **Workload baseline (confirmed by the commissioning human, Medium/regional-rollout scale):** ~100 hotels (upper bound of the confirmed ~10–100 range, sized for headroom), ~5,000 workers platform-wide roster, ~300 concurrent active users at peak (shift-change windows are the expected peak-load pattern).

2. **p95 latency targets, by query class:**
   - **Simple single-entity reads** (a worker's own profile, a single job lookup by id): **≤ 150ms**.
   - **Scoped list/filter queries** (a hotel's open jobs, a worker's own attendance history): **≤ 400ms**.
   - **Cross-module aggregation** (dashboard stats, leaderboard, hotel-summary — the `backend-analytics` read pattern `ADR-034` ratifies): **≤ 800ms**.

3. **Pagination is now a MUST for any list endpoint with no natural cap.** The leaderboard (`take 50`, currently unbounded beyond that literal) and any comparable unpaginated list (audit log, notification history) MUST implement pagination: default page size 25, maximum page size 100. This closes a previously-disclosed-but-unfixed gap as a named, required correction, not merely an accepted risk.

4. **Cross-module aggregation fan-out is capped at 15 parallel queries per request.** `backend-analytics`'s dashboard-stats endpoint (currently 8–11 parallel queries) stays within this cap today. An endpoint that would need to exceed 15 to answer its own request has outgrown direct cross-module reads and requires a dedicated read-model interface instead (`ADR-034`'s named escalation trigger — this ADR is what makes that trigger checkable).

5. **This baseline is explicitly provisional, not a measured production guarantee.** No real production traffic exists pre-launch; these numbers are a disclosed, reasoned starting point sized to the confirmed workload assumption, to be revised once real usage data exists. Engineering (pagination fixes, index work, any read-model migration triggered by point 4) may proceed against this baseline now.

## Rationale

- **A single baseline avoids re-litigating workload assumptions per module.** Eight independent modules each carried the identical "no SLO exists" finding; setting one document once unblocks all of them simultaneously, consistent with how `ADR-032`/`ADR-033`/`ADR-034` each closed a repeated per-module finding with one platform-level ratification.
- **Sizing to the upper end of the confirmed range (100 hotels, not 10) avoids re-deciding this again at the first sign of growth within the already-stated range.** The commissioning human confirmed "Medium" scale (~10–100 hotels); using the upper bound gives headroom without inventing a larger, unconfirmed scale (Constitution §6).
- **Numbers are disclosed as provisional, mirroring `ADR-033`'s identical treatment of the tax-advisor-pending retention-tier mapping** — a bounded, mechanical revision path (adjust the target number, re-measure) if real traffic proves them wrong, not a blocking uncertainty that should prevent setting a baseline at all.
- **The pagination and fan-out requirements are the concrete, actionable half of this decision** — a bare SLO number without a stated consequence for the two already-disclosed violations (unpaginated leaderboard, unbounded fan-out growth) would leave exactly the gaps this decision exists to close.

## Consequences

- Every affected module's own performance-finding row (`SIR-JOBD-004`, `SIR-ATT-009`, `SIR-QUAL-007`, `SIR-ANLY-012`, `SIR-EMP-014`, `SIR-GEO-006`, `SIR-DOC-019(a)`, `SIR-CRM-013`) is resolved at the baseline level: each may now cite this ADR's p95 targets and workload assumption instead of disclosing "no SLO exists." Per-endpoint conformance (whether a specific query actually meets its target) remains an implementation/G8 verification activity, not settled by this record alone.
- The leaderboard's unpaginated `take 50` query requires a follow-on implementation fix (pagination, default 25/max 100) — tracked as a concrete engineering item this decision authorizes, not yet completed by this record.
- `backend-analytics`'s dashboard-stats fan-out (8–11 parallel queries) is confirmed compliant with the 15-query cap as of this ADR's ratification; if it grows further, the fan-out cap combined with `ADR-034`'s escalation trigger requires evaluating a dedicated read-model instead of adding more parallel queries.
- Knowledge-layer updates required (tracked as an exit condition of this ADR's ratification): `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-11 row should be marked Decided with a pointer here; `docs/implementation/GOVERNANCE_REGISTER.md` Part 2 should strike through GD-11; `docs/05-execution/EXECUTION_DASHBOARD.md` should reflect GD-11 as decided.

## Compatibility

No runtime behavior changes as a result of this record alone — it sets a target and a workload assumption; it does not itself implement pagination or modify any query. No migration, no rollback concern.

## Scope note

This settles the workload baseline and p95 targets only. It does not itself implement the leaderboard pagination fix or any index/query optimization needed to meet these targets — those are follow-on engineering items this decision authorizes and scopes, tracked per-module under each affected `SIR-*` row. It does not decide MFA (`GD-08`), the concurrency/optimistic-locking pattern (`GD-10`), or any other still-open `GD-*` decision.
