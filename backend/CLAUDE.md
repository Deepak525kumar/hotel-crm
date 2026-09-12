# backend

Express + TypeScript **modular monolith** on Prisma/Postgres. Not
microservices — Phase 1 chose one deployable on purpose, and `_legacy/` holds
the archived split. Every module lives under `src/modules/<domain>/` with its
own `routes.ts`, `controller.ts`, `service.ts`, `types.ts`.

**The service layer owns the rules.** Routes authenticate, authorise and
validate; services decide. Anything that reaches the database through some
other path bypasses gates that exist.

## Gates

```bash
npx tsc --noEmit
npm run lint                                   # fails CI; do not skip
npx jest --runInBand --forceExit --ci
```

`--runInBand` matters: the suite shares a database and a process-global
registry, and parallel workers produce failures that look like flakes.

**Do not edit source while the suite runs.** ts-jest compiles per test file,
so a file saved mid-run is compiled half-written and whichever suite imports
it dies with a `TS2339` — presenting as an unrelated intermittent failure that
passes on re-run. Most of this repo's "flakes" were this.

`scripts/flake-hunt.sh` runs the suite N times and keeps the full output of
failures. Read its header before chasing a flake: it records what has already
been ruled out, with evidence, and the one residual signature that remains.

## Authorization — the part that is easy to get wrong

Four layers, and they are not interchangeable:

- `authMiddleware` — who you are.
- `requireRole([...])` — **exact string match.** `['admin', 'manager']` silently
  excludes `regional_manager`, which holds a manager's full capability set at
  group scope (ADR-030 D-5). This has broken at ~40 sites.
- `requirePermission(token)` — against `ROLE_PERMISSIONS` in
  `src/config/constants.ts`. **Check the real array**, never assume a role holds
  a token; a test that fabricates the permission proves only that the code
  agrees with itself.
- `checkHotelAccess()` / `resolveHotelAccess()` — which hotels this caller may
  touch. Admin and checker bypass; `manager`/`regional_manager` resolve from
  the scope claim; workers resolve from the roster.

Anything calling a service **directly** (a chatbot tool, a job, a script)
skips the route middleware and must re-apply the equivalent gate itself.

## Chatbot — read the handoff first

`docs/implementation/CHATBOT_HANDOFF.md`, then
`GD-19_CHATBOT_CHECKPOINT.md`. Non-negotiables:

- **The model never produces an authorization input.** Identity, role, scope
  and permissions come from `req.auth` at execution time. `FORBIDDEN_ARG_KEYS`
  enforces it at registration; a static test enforces it too.
- **`ADR-053` approves the tool-registry architecture, never a tool.** Each
  tool needs its own `approvalRef` naming a real approval. `PENDING` is fatal
  at boot when `FEATURE_CHATBOT` is on.
- **There is no draft functionality anywhere in this product.** A tool
  executes, or it asks for confirmation and then executes. It never creates a
  draft of anything — that was an explicit correction from the owner.
- **Tools render their own replies.** `compress()` builds the summary in code;
  free-text synthesis is reserved for L3. A second model call to phrase a
  structured read doubles cost and latency and lets the model describe rows
  that are not in the result set.
- **Prompt lines are not free.** Adding one behavioural rule to the system
  prompt dropped routing accuracy from 62/62 to 61/65. Facts cost nothing;
  rules cost accuracy. Re-run `scripts/chatbot-routing-check.ts` after any
  prompt or tool-description change.
- **A tool that partially updates a row must merge, not replace.** Several
  routes require every field in the body because a form always posts all of
  them; a sentence names one. Read the row, overlay what you were told.

## Database

- Prisma. Migrations are checked in; `migration-harness.yml` runs them in CI.
- `Europe/Berlin` for anything a person calls a day (`CALENDAR_TIMEZONE`).
  A UTC date boundary hands a night-shift manager the wrong day.
- A `DATE` column keyed by `new Date('YYYY-MM-DD')` is midnight **UTC**. Write
  the key the same way everywhere or two rows appear for one day.

## Verifying

A `200` is not evidence. Read the row back. The E2E suite under
`docs/10-testing/e2e/` exists because success responses here have repeatedly
meant nothing was written — and its scenarios encode defects that were
expensive to find. Update it in the same pass: move fixed items to the history
table, add new defects with reproductions, append a run log.
