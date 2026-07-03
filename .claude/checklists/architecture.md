# Architecture Checklist

- [ ] `AR-01` Affected architecture decisions and quality constraints are identified and non-conflicting.
- [ ] `AR-02` Each module, public contract, state domain, and event has one accountable owner.
- [ ] `AR-03` Responsibilities are cohesive; no module assumes an unrelated responsibility.
- [ ] `AR-04` Dependency direction is explicit, acyclic unless approved, and respects module boundaries.
- [ ] `AR-05` State has one authoritative writer; reads, replicas, caches, and transactions are defined.
- [ ] `AR-06` Interfaces expose behavior without leaking private implementation or storage.
- [ ] `AR-07` Failure isolation, retries/idempotency, consistency, and recovery match system constraints.
- [ ] `AR-08` Security/privacy and performance/operability constraints are addressed at boundaries.
- [ ] `AR-09` Compatibility, migration, rollback, and future removal criteria are feasible.
- [ ] `AR-10` Every new architectural choice has an approved or requested Decision Record.
