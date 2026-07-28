# ADR-057: Background Execution Standardizes on the Platform Worker and Optimistic Concurrency — No BullMQ, No Redis Mutex

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving the fourth sub-decision
  of `GD-20` (Job-Dispatch two-tier calendar+broadcast pivot). Authored by the Lead Architect from
  `SPEC-JOB-DISPATCH-001`'s `TREQ-004`/`TREQ-006` mechanism references, revised at the commissioning human's
  explicit direction to require evidence-based justification for the Redis slot-lock mechanism (rather than
  retaining it because an earlier draft mentioned it), and to state the resulting standard positively rather
  than only as a removal.
- **Date:** 2026-07-28
- **Scope:** `SPEC-JOB-DISPATCH-001`. Resolves the execution-mechanism half of `TREQ-006` (auto-close
  scheduling) and `TREQ-004` (first-accept slot arbitration) — the only two points where the frozen target
  spec named an infrastructure mechanism (`node-cron`/BullMQ/Redis; Redis slot lock) predating `ADR-029`.
  Presupposes `ADR-054` (two-tier target architecture) and `ADR-056` (assignment model); does not reopen
  either.
- **Supersedes:** none (additive — applies `ADR-029`'s already-accepted platform standard to Job Dispatch
  specifically, and applies `ADR-035`'s workload baseline to evaluate a previously unjustified Redis
  dependency).
- **Change class:** Platform architecture decision per Constitution §6/§7 — pure execution-mechanism
  architecture, continuing the pattern established by `ADR-029` (Platform Worker over BullMQ), `ADR-032`
  (direct calls over an event bus), `ADR-034` (direct read models over unnecessary abstraction), and `ADR-036`
  (optimistic concurrency as the platform standard): reuse a proven platform pattern before introducing new
  infrastructure.

## Problem

`SPEC-JOB-DISPATCH-001` names two infrastructure mechanisms that predate `ADR-029` and were never reconciled
with it:

1. **`TREQ-006`** (unfilled-`JobRequest` 6-hour auto-close) specifies "node-cron / BullMQ on Redis"
   (`MODULE_SPEC.md:392`) — directly superseded by `ADR-029`'s explicit constraint: *"No external queue
   infrastructure. Kafka, RabbitMQ, SQS, BullMQ, Redis-backed queues, and equivalents are not introduced...
   This is the explicit amendment to the prior 'Redis-backed BullMQ' assumption."* `ADR-029` §3 already names
   "broadcast auto-close" among the Platform Worker's own hosted scheduled jobs — the mechanism question was
   already answered by `ADR-029`, only never applied back to the Job Dispatch spec text itself.

2. **`TREQ-004`** (first-accept slot arbitration) specifies a "Redis slot lock, DB `SELECT..FOR UPDATE`
   fallback when Redis is down" (`MODULE_SPEC.md:216`). Unlike `TREQ-006`, this is not directly foreclosed by
   `ADR-029`'s wording — a distributed lock is not a message queue. It required its own evidence-based
   evaluation: does the platform's confirmed workload justify introducing Redis as a concurrency primitive for
   this specific mechanism, or does an existing DB-only pattern already suffice?

`ADR-035` (GD-11, performance/workload baseline) was checked directly for supporting evidence and provides
none: it establishes a general read-latency/workload baseline (~100 hotels, ~5,000 workers platform-wide, ~300
concurrent active users at peak) and names `SIR-JOBD-004` only as one of several findings resolved on that
generic basis. `ADR-035`'s own Scope note explicitly disclaims deciding "the concurrency/optimistic-locking
pattern," reserving it to `GD-10`. No workload number, contention measurement, or throughput requirement
anywhere in the repository supports a distributed-mutex mechanism for this specific scenario.

Separately, the platform already solves the identical problem today: `work-applications/service.ts`'s
`approve()` method implements first-accept-wins via optimistic concurrency (a `version` column plus a
transactional `updateMany`, rejecting the write with `ConflictError` on zero rows affected) for the current
marketplace's own capacity-slot claim — the same "first acceptance wins a bounded slot" shape `TREQ-004`
describes for broadcast.

## Decision

1. **The 6-hour `JobRequest` auto-close (`TREQ-006`) runs on the Platform Worker, draining the
   `state-outbox` table, exactly as `ADR-029` §3 already establishes.** No new scheduling mechanism is
   introduced; this decision applies `ADR-029`'s already-accepted pattern to this specific job.

2. **First-accept slot arbitration (`TREQ-004`) standardizes on the platform's optimistic-concurrency
   mechanism** — a version column plus a transactional conditional update (`updateMany`-style claim),
   matching the pattern already proven in `work-applications/service.ts` for the equivalent marketplace
   scenario. Tie-break on simultaneous accepts is resolved by the same mechanism: the transaction that
   successfully claims the slot (row still available, version unchanged) wins; a losing transaction receives
   zero affected rows and returns the "requirement fulfilled" response (`TREQ-005`).

3. **Redis-based slot locking is not part of the target architecture.** No distributed-mutex mechanism is
   introduced for broadcast slot arbitration. Redis continues to serve the platform elsewhere (cache,
   rate-limiting, per `PIVOT_DESIGN_DOCUMENT.md` §5.7) — Job Dispatch itself depends on none of it.

4. **A future architecture decision may revisit this if production evidence demonstrates the need for a
   distributed locking mechanism** — for example, measured contention at a scale `ADR-035`'s baseline did not
   anticipate, or a `GD-10` resolution that establishes a platform-wide need this decision did not foresee.
   Until such evidence exists, no distributed lock is introduced.

## Rationale

- **The burden of proof falls on introducing new infrastructure, not on retaining an early draft's
  assumption.** `TREQ-004`'s Redis-slot-lock language traces to the same pre-`ADR-029` era that also specified
  BullMQ for `TREQ-006` — inherited scaffolding, not a decision backed by measured need. Checking `ADR-035`
  directly confirms no workload evidence supports it, and no other repository authority does either.
- **An identical problem is already solved in this codebase without Redis.** This is evidence, not opinion:
  `work-applications/service.ts` proves optimistic concurrency handles first-accept-wins correctly today, at
  the platform's actual operating scale. Preferring a mechanism with existing implementation and operational
  experience over introducing a second, unproven solution for the same problem shape is the more conservative
  engineering choice, not a compromise.
- **This continues an established platform principle, not a one-off exception:** `ADR-029` chose the Platform
  Worker over BullMQ, `ADR-032` chose direct in-process calls over an event bus, `ADR-034` chose direct
  read-models over an abstraction layer with no proven need, `ADR-036` established optimistic concurrency as
  the platform's standard concurrency mechanism. Standardizing broadcast slot arbitration on that same
  mechanism is consistent application of a philosophy the platform has already committed to repeatedly, not a
  novel argument invented for this decision.
- **A simpler dependency graph is a direct, measurable benefit.** Job Dispatch's target architecture now
  depends on Postgres and the Platform Worker only — no BullMQ, no Redis mutex — while Redis remains available
  platform-wide wherever it does provide genuine value (cache, rate-limiting). Removing an unjustified
  dependency from one module's target state is a real simplification, not a neutral wording choice.
- **Stating the standard positively, not only as a removal, keeps the decision durable.** Framing this as "no
  Redis" alone would read as a negative constraint with no clear replacement; stating "arbitration is
  optimistic concurrency" gives implementers and future reviewers an affirmative target to build and validate
  against.

## Consequences

- `SPEC-JOB-DISPATCH-001`'s `TREQ-006` mechanism reference is corrected from "node-cron / BullMQ on Redis" to
  the Platform Worker/outbox, matching `ADR-029` exactly.
- `SPEC-JOB-DISPATCH-001`'s `TREQ-004` mechanism reference is corrected from "Redis slot lock, DB `FOR UPDATE`
  fallback" to optimistic concurrency (version column + transactional conditional update) as the sole
  mechanism — no fallback framing is needed because there is no primary Redis mechanism to fall back from.
- Job Dispatch's target architecture depends on Postgres and the Platform Worker only for both mechanisms
  resolved by this record. Redis remains a platform dependency elsewhere, unaffected by this decision.
- `GD-20` Sub-decision 5 (Migration Strategy) inherits no additional infrastructure provisioning burden for
  Job Dispatch's background execution — Redis is not a build dependency for either mechanism this record
  covers.
- A future ADR may introduce a distributed locking mechanism for this specific scenario, but only on
  production-evidence grounds; this record does not pre-authorize that future decision, nor does it prohibit
  it.
- `PIVOT_DESIGN_DOCUMENT.md`'s own "node-cron/BullMQ on Redis" and "Redis slot lock" language (§5.5, §5.6,
  §5.7, §7.3, §9, §11, §14) is addressed via a Decision-Integration forward-note in that document's own
  Document Control table, the same convention `ADR-029` established for `SPEC-NOTIF-001` — the document's
  prose is left as originally authored (historical record); only the forward-note marks the execution
  mechanism as superseded.
- No code changes are made or authorized by this record.

## Compatibility

No runtime behavior changes — no target-model code exists yet to be affected; the current marketplace's own
optimistic-concurrency slot-claim mechanism is unchanged. No migration, no rollback concern.

## Scope note

This settles only the execution-mechanism questions underneath `TREQ-004` and `TREQ-006`. It does not decide
`GD-20` Sub-decision 5 (Migration Strategy — timing, phasing, retirement) or any Analytics/Attendance follow-up
(Sub-decision 6), and it does not reopen `ADR-029`, `ADR-035`, `ADR-054`, or `ADR-056`.
