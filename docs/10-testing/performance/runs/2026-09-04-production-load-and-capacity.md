# Run log — 2026-09-04 — Production load & capacity

**Target:** real production, `eu-central-1`. Backend hit **directly** on `:3001`, bypassing
Vercel, so the numbers isolate EC2 + RDS.
**Time:** 20:41–20:49 UTC (22:41–22:49 Berlin — off-hours, Thursday).
**Baseline revision:** `cca4fc4f` (`feat(retention): prune Notification and AuditLog`).
**Requested by:** owner — "perform a load test on real production instead of MyMac and include
RDS and S3 … see if the system can actually take real load", with ≥600 users.

## Environment

| | |
|---|---|
| App host | t3.small, 2 vCPU, 1906 MB, 3 pm2 processes |
| Database | RDS `db.t4g.small`, Multi-AZ, gp3 20 GB, `max_connections = 181` |
| Node | v22.23.0, `UV_THREADPOOL_SIZE` unset (default 4) |
| Password hashing | native `bcrypt`, `BCRYPT_ROUNDS = 12` |
| EC2 credit mode at start | **`unlimited`** (changed to `standard` during this session — see Actions) |

**Pre-existing production data:** 43 user rows (10 live, not deleted), 5 active employments,
2 room logs, 33 assignments and 62 logins in the preceding 7 days. Essentially no real traffic
was at risk.

## Results — client side

600 persistent closed-loop clients. Concurrency **verified host-side at 599 established TCP
connections**, so this was genuine 600-way concurrency, not a serialized client.

Single-request reference (no load): `/health/ready` 375 ms, `/health` 318 ms. That is
dominated by South-Asia → Frankfurt RTT, not server time.

| | `/health/ready` (RDS round-trip) | `/health` (no DB) | `/health/ready` rerun |
|---|---|---|---|
| Duration | 60.6 s | 60.3 s | 80.3 s |
| Requests | 62,566 | 100,887 | 76,590 |
| **Throughput** | **1033 req/s** | **1672 req/s** | 953 req/s |
| p50 | 357 ms | 305 ms | 377 ms |
| p95 | 470 ms | 458 ms | 1093 ms |
| p99 | 2223 ms | 672 ms | 3513 ms |
| max | 30,242 ms | 30,166 ms | 30,253 ms |
| Failures | 234 timeout (0.37%) | 32 timeout (0.03%) | 110 timeout + 58 `ECONNRESET` + 4 `ETIMEDOUT` (0.22%) |

**p50 under 600-way concurrency (357 ms) was no worse than a single idle request (375 ms).**
The median did not degrade at all. The damage is entirely in the tail, and only on the
DB-backed path.

## Results — server side

Sampled on the host at 5-second intervals during the burst (`top -bn1`):

| Sample | user | sys | idle | Mem used |
|---|---|---|---|---|
| pre-load | 0.0% | 0.0% | 95.2% | 701.6 MB |
| +6 s | 71.4% | 9.5% | 14.3% | 734.3 MB |
| +11 s | 68.2% | 9.1% | 18.2% | 742.0 MB |
| +16 s | 65.0% | 5.0% | 25.0% | 744.3 MB |
| +21 s | 65.2% | 8.7% | 21.7% | 749.2 MB |
| +26 s | 68.2% | 9.1% | 18.2% | 752.9 MB |

**~75–80% CPU with ~20% idle remaining. Memory essentially flat** — 701 → 753 MB of 1906 MB
across the whole burst. Memory is not a constraint on this workload.

CloudWatch, RDS (1-minute):

| Metric | Baseline | Under load |
|---|---|---|
| CPUUtilization | 4.5% | **8.7% peak** |
| DatabaseConnections | 3 | **5** |
| CPUCreditBalance | 153 | 156 (*rose* — never dipped) |
| FreeableMemory | 1.11 GB | unchanged |
| ReadIOPS | ~0.3 | ~0.3 (`SELECT 1` touches no disk) |

## Results — login ceiling

`bcrypt.compare` at the deployed rounds (12), benchmarked **on the production CPU**, no
database writes and no user impact (method §4.4(2) of the README):

| Concurrency | Throughput | Latency each | Event-loop lag (max) |
|---|---|---|---|
| 1 | 4.00 logins/s | 250 ms | 1 ms |
| 2 | **6.97 logins/s** | 287 ms | 1 ms |
| 4 | 6.83 logins/s | 586 ms | 1 ms |
| 8 | 6.96 logins/s | 1149 ms | 4 ms |
| 16 | 6.93 logins/s | 2308 ms | 1 ms |
| 32 | 6.94 logins/s | 4608 ms | 1 ms |

Single compare: **253 ms**.

**The ceiling is ~7 logins/second.** It saturates at concurrency 2 — the vCPU count — and is
flat thereafter; additional concurrency only queues (32 concurrent → 4.6 s per login).
`UV_THREADPOOL_SIZE` is not the limit here; two cores are.

**Event-loop lag stayed ≤ 4 ms under full saturation**, confirming native `bcrypt` is deployed
and working. The superseded `bcryptjs` blocked the loop for ~182 ms.

### Is 7/s enough?

Refresh tokens are long-lived and the apps refresh on launch, so a worker logs in roughly
**weekly, not per shift**. At ADR-035's 5,000-worker assumption that is ~714 logins/day
(~0.008/s average). Even 500 workers all logging in inside a single 15-minute shift change is
0.56/s — **12× headroom**. It only binds if ~500 people log in within one *minute* (8.3/s).

## Findings

### F1 — Prisma connection pool capped at 5 (fixed, PR #627)

`DatabaseConnections` peaked at **exactly 5** under 600 concurrent DB-backed requests, while
RDS sat at 8.7% CPU with 181 connections available. `src/lib/db.ts` constructed a bare
`new PrismaClient()`, and no `connection_limit` existed anywhere in the repo or the deployed
`.env`, so Prisma applied its default of `physical_cpus * 2 + 1` = **5** on a 2-vCPU host.

**The pool, not the hardware, was the ceiling.** This is the direct cause of the p99 blowout
(2223 → 3513 ms) and the tail `ECONNRESET`s: requests past five concurrent queries queued for
a slot.

It was mild here only because the probe was `SELECT 1` (~1 ms). At a realistic 30–50 ms for a
joined query (review queue, assignments), five slots is a **~100–165 query/s ceiling** — well
under ADR-035's ~300-concurrent-user assumption.

### F2 — EC2 was in `unlimited` credit mode and had been billed for surplus (fixed)

Burstable instances in `unlimited` mode do not throttle when credits run out; they overdraft
and bill. Verified from CloudWatch:

- `CPUCreditBalance` hit **0.0** on Aug 26, 27 and 28
- `CPUSurplusCreditsCharged` = **553.34 credits** over the trailing 30 days (≈ 9.2 vCPU-hours)
- EC2 CPU daily *average* was **29.99% (Aug 25)** and **58.93% (Aug 26)**, peaking at 98%

The sustained CPU is consistent with **building the application on the box**, which
`fc06cd0b` (build in CI) has since moved off the host — CPU has been ~0.6% since.

Dollar cost was **not verified**: the account's credentials are scoped to `eu-central-1`, and
both the Pricing API and Cost Explorer are `us-east-1`. Both refused with
`CreateOAuth2Token … invalid`. The *quantity* above is verified; no rate is asserted here.

### F3 — Load-test method constraints (not defects)

- Production database writes were **blocked by the permission classifier**, twice. Not worked
  around; the login ceiling was obtained by CPU benchmark instead and the gap disclosed.
- Unauthenticated probing cannot reach bcrypt: `login()` returns early on `user_not_found`
  before any compare (`auth/service.ts` ~line 407).

## What was NOT measured

Stated plainly, because a capacity claim without its blind spots will be over-trusted:

- **No authenticated request of any kind.** No `/assignments`, `/notifications`, `/auth/me`.
- **No real HTTP login.** The 7/s figure is the bcrypt CPU cost on the production host. The
  rest of the login request (two `findUnique`s, a session insert, a JWT sign) is single-digit
  ms against a path measured at 1000 req/s, so it does not move the ceiling — but this is
  reasoning, not measurement.
- **No S3.** The streamed quality-photo upload path was requested and not exercised; it needs
  an authenticated checker plus a real assignment, i.e. the same seeded data that was blocked.
- **No write path at all**, so no lock contention, no transaction throughput, no outbox behaviour.
- **No sustained soak.** Longest burst was 80 s. Nothing here speaks to memory growth, handle
  leaks, or credit drain over hours.

## Reconciliation with ADR-035

ADR-035 §5 declares its baseline **provisional**, "to be revised once real usage data exists".
This is the first such data.

- **Workload assumption (~300 concurrent at peak):** the transport layer handled **600** —
  double the assumed peak — at 75% CPU with the median undegraded. The assumption looks safe
  on transport.
- **p95 targets:** *not assessable from this run.* The endpoints exercised (`/health`,
  `/health/ready`) belong to none of ADR-035's three query classes, and off-region RTT
  (~300 ms) exceeds the 150 ms simple-read target on its own. **Measuring p95 against ADR-035
  requires an in-region client and authenticated endpoints.** Recorded as a gap, not a pass.
- **F1 is a direct conformance risk to the ~300-concurrent assumption** and is the one finding
  that should be considered before claiming ADR-035 conformance.

No ADR revision is proposed on this run alone, because the classes ADR-035 actually targets
were never measured.

## Actions taken

| Action | Status |
|---|---|
| PR #627 — size the Prisma connection pool explicitly (5 → 15) | opened |
| EC2 credit mode `unlimited` → `standard` (owner-approved) | applied, verified |
| RDS Performance Insights enabled, 7-day free tier | applied (Enhanced Monitoring deliberately **not** enabled — it bills CloudWatch Logs ingestion) |
| Production data seeded | **none** — 43 users before and after, zero `loadtest-%` rows |
| Host `.env` modified | **none** |

> **Note on a misleading status string:** enabling Performance Insights briefly reports RDS
> status `configuring-enhanced-monitoring`. That is AWS's generic label for monitoring config
> changes. `MonitoringInterval` remained `0` with no monitoring role attached — Enhanced
> Monitoring is **off**.

## Follow-ups

1. **In-region load generation** (an `eu-central-1` host) to measure p95 against ADR-035
   without RTT dominating.
2. **Authenticated + S3 run**, once test accounts in production are permitted — the two
   largest blind spots above.
3. **Re-measure after PR #627 merges** to confirm the pool change moves the DB-path ceiling and
   removes the tail `ECONNRESET`s.
4. **Soak test** (hours, not seconds) for memory growth and credit drain, now that `standard`
   mode makes drain a throttling risk rather than a billing one.
