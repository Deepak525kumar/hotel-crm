# ADR-036: Optimistic Concurrency Is the Platform Standard; Attendance Check-In/Update Race Must Be Fixed, Mechanism Deferred to Implementation

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-10` (Platform concurrency / optimistic-locking pattern). Authored by the Lead Architect from `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-10 entry and the commissioning human's explicit approval of a refined Option (a).
- **Date:** 2026-07-28
- **Scope:** Platform-wide concurrency-control standard for mutable-entity read-then-write races. Resolves `SIR-ATT-013`/`OQ-12` (`docs/03-modules/attendance/MODULE_SPEC.md`). Confirms, without reopening, that `SIR-CRM-013`/`OD-CRM-13` (already resolved 2026-07-25 via `ADR-030`) and `SIR-QUAL-005`/`OQ-04` (already resolved 2026-07-27 via `GD-04` + PR #237/#238) required no further action from this decision — both were found stale in `GD-10`'s own "Merges findings" line during this decision's audit.
- **Supersedes:** none (additive). Formalizes the pattern `WorkRequest.version` already establishes in shipped code as the platform standard, rather than introducing a new mechanism.
- **Change class:** Platform architecture decision per Constitution §6/§7, mirroring `ADR-032`'s (GD-12) precedent of ratifying a working pattern and `ADR-033`'s precedent of separating a governance-level commitment from an implementation-level mechanism choice.

## Problem

Multiple modules have unguarded read-then-write races with no agreed platform pattern. `WorkRequest` already carries a `version` column and a guarded update (the codebase's own working optimistic-lock precedent); `Hotel.updateHotel`, attendance's `checkIn`/`update`, and the quality rating aggregate did not, at the time GD-10 was raised. Verification during this decision found two of those three already resolved on their own merits by other decisions (`ADR-030` for Hotel; `GD-04`/PR #237/#238 — dropping the DB trigger, single app-level writer — for quality's aggregate), leaving attendance's `checkIn`/`update` double-submit window as the one genuinely open instance: a same-actor, same-record race reachable via ordinary mobile-network retry (e.g. a worker double-tapping "check in" on a flaky connection), producing a duplicate `CHECK_IN` audit row or an indeterminate `check_in_at`/`minutes_late`.

## Decision

1. **Optimistic concurrency is adopted as the platform standard for mutable-entity read-then-write races.** This ratifies the pattern `WorkRequest.version` already establishes in shipped code — a version/state check that rejects a write against stale data rather than silently overwriting it — as the platform's general answer to this class of problem, not a per-module ad hoc choice.

2. **The attendance check-in/update race (`SIR-ATT-013`/`OQ-12`) MUST be fixed, not accepted as residual risk.** This is a routine occurrence for a field-worker mobile app (flaky connections, double-taps), not a rare edge case, and the platform already has a proven pattern to apply.

3. **The concrete mechanism for attendance is explicitly deferred to implementation, not mandated here.** This governance decision commits to *fixing the race* and to *optimistic concurrency as the general platform philosophy* — it does not itself require a `version` column specifically. During implementation, the engineer must verify whether a version column (mirroring `WorkRequest` exactly), a transactional row-level lock (`SELECT ... FOR UPDATE`), or another mechanism consistent with optimistic concurrency is the better fit for attendance's own write shape, and record that choice at implementation time.

4. **This does not reopen `SIR-CRM-013`/`OD-CRM-13` or `SIR-QUAL-005`/`OQ-04`.** Both are confirmed already resolved by their own prior decisions (`ADR-030`, `GD-04`) and require no action from this ADR.

## Rationale

- **A named platform standard prevents the same "no agreed pattern" gap from recurring** the next time a new mutable entity needs write-race protection — future modules have a default to reach for (optimistic concurrency) rather than re-litigating the question per module, consistent with how `ADR-032`/`ADR-034` each closed a repeated per-module finding with one platform-level ratification.
- **Committing to "must fix" at the governance level, while deferring the mechanism to implementation, keeps this decision from over-specifying an implementation detail it isn't positioned to verify.** Whether a version column or a transactional lock is the better fit for attendance's specific write pattern (single-row, single-actor, high-frequency mobile calls) is a question best answered by the engineer building the fix against the actual code, not speculated on here (Constitution §6: don't invent unconfirmed architecture at the wrong layer).
- **Verifying the other two "merges findings" items before acting on them prevented redundant work** — treating `SIR-CRM-013`/`SIR-QUAL-005` as still-open (per GD-10's own stale text) would have re-decided questions already settled by `ADR-030` and `GD-04`.

## Consequences

- `SIR-ATT-013`/`OQ-12` is resolved at the governance level: optimistic concurrency is the mandated general approach, the race must be fixed (not accepted as residual risk), and the specific mechanism is an implementation-time decision, tracked as a required fix rather than an open architecture question.
- `docs/03-modules/attendance/MODULE_SPEC.md`'s own `OQ-12` row should be updated to reflect this resolution and to explicitly note the mechanism-selection step remains for implementation.
- No migration or code change is authorized or performed by this record alone — it commits to a fix and a general standard; the actual schema/code change happens at implementation time, informed by whichever mechanism the implementing engineer verifies is the better fit.
- Knowledge-layer updates required (tracked as an exit condition of this ADR's ratification): `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-10 row should be marked Decided with a pointer here, and corrected to disclose that two of its three "merges findings" items were already resolved by other decisions before this ADR; `docs/implementation/GOVERNANCE_REGISTER.md` Part 2 should strike through GD-10; `docs/05-execution/EXECUTION_DASHBOARD.md` should reflect GD-10 as decided.

## Compatibility

No runtime behavior changes as a result of this record alone — no schema or code is touched. The eventual attendance fix (implementation-time, mechanism TBD per point 3) will require its own migration and mobile-client conflict-handling change, scoped and executed separately.

## Scope note

This settles the platform-wide concurrency-control *philosophy* (optimistic concurrency) and the *commitment to fix* the attendance race. It does not select the attendance fix's concrete mechanism (deferred to implementation, per point 3), and it does not reopen either already-resolved item it audited (`SIR-CRM-013`, `SIR-QUAL-005`).
