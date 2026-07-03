# Performance Checklist

- [ ] `PE-01` Relevant SLOs/budgets, workload, data cardinality, concurrency, and environment are approved/known.
- [ ] `PE-02` Baseline and candidate are measured with comparable methods and sufficient samples.
- [ ] `PE-03` Algorithmic complexity and loops/batches are bounded for expected and maximum input.
- [ ] `PE-04` Database queries, indexes, transactions, pagination, and N+1 behavior are assessed.
- [ ] `PE-05` Network calls, payloads, retries, timeouts, caching, and invalidation are bounded.
- [ ] `PE-06` CPU, memory, connections, queues, files, and other resources have limits/backpressure.
- [ ] `PE-07` Client startup/render/bundle/image behavior is assessed where applicable.
- [ ] `PE-08` Failure/degraded behavior avoids retry storms, stampedes, and uncontrolled load.
- [ ] `PE-09` Benchmarks/profiles are reproducible and distinguish measurements from projections.
- [ ] `PE-10` Regressions, capacity/cost implications, monitoring, and release thresholds are resolved.
