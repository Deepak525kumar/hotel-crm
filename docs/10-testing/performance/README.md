# Load & Capacity Testing (human/agent-executable)

**Purpose.** The durable record of how capacity is measured on this platform, and of every
measurement actually taken. Companion to `docs/10-testing/e2e/`, which verifies *correctness*;
this directory verifies *how much*.

**If you are an AI agent asked to "load test", "check if the server can handle N users",
"benchmark production", or "see if we need a bigger instance": read this file first, then
follow the method below and append a run log to `runs/`.** Do not invent an ad-hoc plan — the
traps in §5 have each already cost a session's worth of time.

Run logs live in [`runs/`](runs/). Newest first:

| Run | What it measured | Headline |
|---|---|---|
| [2026-09-04 production load & capacity](runs/2026-09-04-production-load-and-capacity.md) | 600 concurrent clients vs real production; bcrypt ceiling on the production CPU | ~1000 req/s DB-backed, ~7 logins/s; connection pool found capped at **5** |

---

## 1. What "capacity" means here

Three separate ceilings, which fail differently and must be measured separately. Conflating
them is the most common mistake:

| Ceiling | Set by | Symptom when hit |
|---|---|---|
| **Transport / event loop** | Node, nginx, host CPU | Everything slows uniformly |
| **Database concurrency** | Prisma pool size, then RDS | p99 explodes while p50 stays flat; connection resets at the tail |
| **Login throughput** | bcrypt cost × vCPU count | Only `/auth/login` is slow; the rest of the app is fine |

A test that only measures the first will report "we're fine" while the third is saturated.

## 2. Non-negotiables

These are constraints of *this* project, not general advice. Violating any of them has a real
cost.

- **Never create load-test users through `POST /users` (`createUser`).** It enqueues a real
  welcome email per account. 600 accounts is 600 real sends against production Resend. Seed
  by direct database write instead.
- **Never test login by sending wrong passwords to real accounts.** Failed attempts notify
  managers at 5 (possible real email) and throttle the account for 15 minutes at 10
  (`AUTH_LOGIN_THROTTLE_THRESHOLD`, ADR-070). You would be locking out real workers to
  produce a number.
- **Check burstable CPU credits before and after.** Both EC2 and RDS are burstable. Draining
  credits throttles the instance *after* your test ends, for real users. Abort if
  `CPUCreditBalance` falls fast.
- **Prefer off-hours.** Operations are Berlin time; the fleet is `eu-central-1`. Note both the
  UTC and Berlin time in the run log.
- **Restore anything you changed.** In particular `AUTH_LOGIN_RATE_LIMIT_MAX` on the host, if
  raised (see §5). `.env` on the host is untracked and hand-maintained — a change there is
  invisible to git and will outlive your session unless you undo it.
- **Clean up seeded rows.** Use a distinctive, greppable identifier (`loadtest-N@lt.invalid`)
  so cleanup is exact rather than best-effort.

## 3. Where to point the test

Hit the backend **directly** on `:3001`, not `https://deepcleaninghub.de`. The public domain
routes through Vercel, so a test through it measures Vercel's edge as much as your own stack
and cannot isolate an EC2 or RDS limit. Get the address with:

```bash
aws ec2 describe-instances --instance-ids <instance-id> \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

Latency measured from a developer laptop includes real network RTT to Frankfurt (~300ms from
South Asia). **Absolute latency numbers from a laptop are not server latency.** What is
meaningful from off-region:

- **throughput** (requests/second)
- **degradation** — p50 under load compared to a single idle request
- **server-side CPU and memory**, sampled on the host

## 4. Method

### 4.1 Baselines first, always

Capture before applying load, or you cannot attribute anything afterwards:

```bash
# RDS: CPU, credits, connections, free memory. EC2: CPU, credits.
aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=<db-id> \
  --start-time <iso> --end-time <iso> --period 60 --statistics Average Maximum
```

Also record a single-request latency for each endpoint under test — that is the "no load"
reference the load figures are compared against.

### 4.2 Client-side load

The harness pattern that produced the 2026-09-04 run: **N persistent workers in a closed
loop**, each issuing a request and immediately issuing the next. This models N
simultaneously-active clients, unlike a fixed request count which finishes early and
under-reports concurrency. Use a keep-alive agent with `maxSockets >= N`, or Node caps
sockets and you measure your own client instead of the server.

Report: throughput, p50/p95/p99/max, and a **breakdown of failures by code** — timeouts and
`ECONNRESET` mean something different from a 500, and lumping them together hides the
distinction between "server refused" and "server never answered".

### 4.3 Host-side sampling — do not skip this

CloudWatch alone is insufficient (see §5.2). Sample the host *during* the run over SSM:

```
top -bn1 | head -4        # CPU split user/sys/idle, and memory
ss -tn state established | wc -l   # PROVES the concurrency actually arrived
```

The established-connection count is the evidence that the test did what it claims. A run that
reports "600 concurrent" without it may have been serialized by the client.

### 4.4 Measuring the login ceiling

Login throughput is bcrypt cost ÷ vCPUs, and it dominates everything else in the request
(bcrypt ≈ 253ms; the surrounding queries are single-digit ms).

**It cannot be measured by unauthenticated probing.** `login()` returns early on
`user_not_found` *without* a bcrypt compare, so logins with fake emails are cheap and measure
nothing. Two legitimate options:

1. **End-to-end**, with seeded accounts — see the constraints in §2. Note that *successful*
   logins are not throttled per-account (the ADR-070 counter tracks failures), so a small
   number of accounts suffices; the IP rate limiter is the binding constraint instead (§5.3).
2. **Direct CPU benchmark on the production host** — run `bcrypt.compare` at increasing
   concurrency using the deployed `node_modules` and the deployed `BCRYPT_ROUNDS`. This
   isolates the true ceiling with zero data written and zero user impact, and is what the
   2026-09-04 run used.

For (2), the script must live **inside** `backend/` so `require('bcrypt')` resolves; a script
in `/tmp` fails with `MODULE_NOT_FOUND`. Delete it afterwards.

Measure event-loop lag alongside throughput. Native `bcrypt` uses the libuv threadpool and
should keep lag in single-digit ms; the old pure-JS `bcryptjs` blocked the loop for ~182ms,
which is the regression this check exists to catch.

## 5. Traps that have already cost time

### 5.1 `--statistics Average,Maximum` silently returns nothing

The AWS CLI parses the comma form as **one** statistic name and errors. With `2>/dev/null`
the error vanishes and you get an empty result set that looks like "no data during the load
window". Use space separation: `--statistics Average Maximum`.

### 5.2 EC2 basic monitoring is 5-minute granularity

Detailed monitoring is **disabled** on the production instance, so `--period 60` against
`AWS/EC2` returns nothing at all, and a 2-minute load burst gets averaged against 3 minutes of
idle inside one bucket. RDS publishes at 1-minute. **This is why §4.3 host-side sampling is
mandatory** — it is the only high-resolution CPU evidence available.

### 5.3 The IP rate limiter will throttle a single-source test

`AUTH_LOGIN_RATE_LIMIT_MAX` defaults to 20 per 15 minutes **per IP**. A load test from one
machine measures 429s, not capacity. Raising it means hand-editing the host's untracked
`.env` and restarting — and restoring it afterwards. Prefer the §4.4(2) CPU benchmark, which
does not touch it.

### 5.4 Writing to the production database may be blocked

Bulk seeding into production can be refused by the permission classifier. Do not repackage the
same action to get around it (encoding it, splitting it up) — that is working around the
intent, not the mechanism. Report it and let the human decide. The 2026-09-04 run was blocked
this way and used the §4.4(2) benchmark instead, disclosing the gap rather than claiming an
end-to-end result it did not have.

### 5.5 A single clean rerun is not proof a flaky failure was a fluke

Capture full suite/test output to a file **before** filtering it. The 2026-09-04 session lost
the identity of two failing tests to a pipe and could only disclose the flake, not diagnose it.

## 6. Pass criteria

Reconcile against **ADR-035** (Platform Performance SLO & Workload Baseline), whose confirmed
workload assumption is ~100 hotels, ~5,000 workers, **~300 concurrent active users at peak**,
with shift-change windows as the expected peak pattern. Its p95 targets:

| Query class | p95 target |
|---|---|
| Simple single-entity read | ≤ 150 ms |
| Scoped list/filter | ≤ 400 ms |
| Cross-module aggregation | ≤ 800 ms |

ADR-035 §5 states the baseline is **explicitly provisional**, "to be revised once real usage
data exists". Load-test runs recorded here are that data. A run that contradicts the baseline
is grounds for a follow-on ADR, not a reason to quietly restate the target.

**A run is only reportable if it states what it did NOT measure.** The 2026-09-04 run
measured transport and DB-connection behaviour but never exercised an authenticated request,
an S3 upload, or a real HTTP login — and says so in its own summary. A capacity claim that
omits its blind spots is worse than no claim, because it will be trusted.
