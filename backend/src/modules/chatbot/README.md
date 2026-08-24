# backend-chatbot — scaffold

`SPEC-CHATBOT-001` · `ADR-013` (AI-execution ownership) · `ADR-053` (orchestration layer + tool registry)

**Status: behind `FEATURE_CHATBOT` (default OFF). No LLM provider is wired — and the L0 command path works fully without one.**

## What is built

Steps 2–4, 6 and 7 of the integration plan:

| Piece | File | What it does |
|---|---|---|
| Actor | `tools/actor.ts` | Branded `ActorContext`, constructible **only** from `req.auth` |
| Registry | `tools/registry.ts` | Declarative tool registration; forbidden-argument invariant |
| Executor | `tools/executor.ts` | **The security boundary** — the five-step gate |
| First tool | `tools/definitions/self-service.tools.ts` | `assignments.list_mine`, self-scoped, READ_ONLY |
| Budget guard | `guardrails/budget.ts` | Monthly + per-conversation + per-worker-daily caps |
| Redaction | `guardrails/redaction.ts` | Special-category values → presence booleans |
| L0 router | `orchestrator/router-l0.ts` | Deterministic commands, **zero LLM calls** |
| Orchestrator | `orchestrator/orchestrator.ts` | The turn loop and routing ladder |
| Templates | `orchestrator/templates.ts` | Deterministic rendering (no second model call) |
| Provider seam | `provider/llm-provider.ts` | Interface only; returns null until one is wired |
| Tool-call log | `tools/tool-call-log.ts` | `ChatbotToolCall` rows + write idempotency |

Routes (all authenticated, all behind the flag):

| Route | Purpose |
|---|---|
| `GET  /chatbot/commands` | L0 manifest — the client renders these as quick-reply chips |
| `POST /chatbot/conversations` | `IF-CHATBOT-StartConversation` |
| `POST /chatbot/conversations/:id/messages` | `IF-CHATBOT-ExchangeMessage` |
| `GET  /chatbot/conversations/:id` | Outcome only — never the transcript |
| `GET  /chatbot/tools` | Permission-filtered tool manifest |
| `POST /chatbot/tools/invoke` | Direct tool invocation, no model in the loop |

### The useful part today

**A worker can ask "my shifts" and get a correct, correctly-scoped answer with no API key configured.** L0 resolves the phrase (or a tapped chip) to a tool call deterministically, the executor's five-step gate runs exactly as it will for the model path, and the reply is rendered from a template. Zero tokens, zero provider dependency.

L0 is not a bypass — it is a cheaper route to the same boundary. Free text with no provider degrades to a clear message rather than erroring.

## What is deliberately NOT built

- **No LLM provider.** No Bedrock or Anthropic client, no API key configured. Provider selection (Bedrock `eu-central-1` vs. the Anthropic API direct) is a live decision with a GDPR data-residency dimension. `getProvider()` returns null and the orchestrator handles that as a supported state.
- **No L1 router, no L3 planner, no prompts.** The L1 branch is reached and logged but deliberately **not stubbed with a plausible-looking implementation** — an unrun API-shape guess is exactly how a defect ships unnoticed. (That already happened once in the isolated prototype: an empty `messages: []` array on the opening turn would have failed on the first real call.)
- **No confirmation-token flow.** `CHATBOT_CONFIRM_TOKEN_SECRET` is configured but unused, because no `HIGH_RISK_WRITE` tool exists to need it (blocked on `OD-CHAT-005`). Building the HMAC mint/verify ahead of its first consumer would be untestable against a real flow.
- **No write tool, and no tool that touches another person's record.** Blocked on `OD-CHAT-005`.
- **No analytics tool.** Blocked on `OQ-ANALYTICS-01` (the leaderboard routes are recorded in `API_INDEX.yaml` as missing `requireRole`/`checkHotelAccess`; wrapping a broken route would industrialize the breakage).

The last two are enforced mechanically by `__tests__/chatbot-tool-registry-hygiene.test.ts`, not left to reviewer memory. Those tests are expected to be updated deliberately when the decisions land.

## The governance position

`SPEC-CHATBOT-001@0.2.0` is `REVIEW`, **not FROZEN**, and `.claude/CLAUDE.md` states no implementation may begin from an unfrozen specification. `GD-19_CHATBOT_CHECKPOINT.md` records the module as deferred post-MVP with three standing G2 blockers:

| Blocker | Status |
|---|---|
| `OD-CHAT-005` | Read-scope and initiation-scope beyond the owning worker — **partially** resolved |
| `OD-CHAT-006` | Prompt-injection resistance — open, interim posture only |
| `OD-CHAT-013` | Module owner unassigned — organizational, no ADR can close it |

This scaffold is written to be correct under either resolution of `OD-CHAT-005`: everything registered is self-scoped, so nothing here depends on the unresolved question. **The flag should not be enabled outside development until those blockers are closed.**

Note also `ADR-053` item 4: it approves the tool-registry *architecture*, not any specific tool. `assignments.list_mine` carries `approvalRef: PENDING` for exactly this reason.

## The one structural idea

**The model never produces an authorization input.**

A tool call is a *request*, not a command. It carries semantic arguments only. Every identity, role, scope and permission value is re-derived server-side from `req.auth` at execution time.

Tool schemas are forbidden from declaring `userId`, `actorId`, `role`, `permissions`, `scope`, `hotelId`, `workerId`, or `internalBypass`. Enforced three ways: the `SafeArgs` type (compile time), `assertNoForbiddenArgs` (registration time, so a violation is a boot failure), and a static test over the whole registry (CI).

`internalBypass` is on that list deliberately and is not hypothetical — `assignments/service.ts` accepts it as a 6th parameter and skips a worker-role authorization branch when true. Tools call the 5-argument form only.

### The five-step gate

Every execution, no exceptions:

1. **Authenticated identity** — `ActorContext`, from `req.auth`, which `authMiddleware` populates from a live DB read of the user row on *every* request (`ADR-031` D-3).
2. **Live permissions** — the tool's token re-checked in-process against `req.auth.permissions`.
3. **Tenant/scope** — `resolveHotelAccess` / `resolveWorkerScope`: the same seams the HTTP routes use, not a copy.
4. **Domain authorization** — the owning service's own checks run again inside `invoke()`.
5. **Action** — executed with the step-1 actor.

Steps 2–4 are redundant on purpose. Layer 4 exists in this codebase precisely because `assignments/service.ts` `list()` once shipped with no scope check while its siblings had one (the IDOR fix at `service.ts:262`).

A consequence worth naming: because permissions are derived request-time and never cached, **a worker deactivated or demoted mid-conversation is denied on their next tool call**, with no cache to invalidate.

## Tests

| Suite | Covers |
|---|---|
| `chatbot-executor-authz.test.ts` | Allow-list, argument validation, the forbidden-argument matrix, permission checks, self-scoping **verified at the query layer**, audit rows |
| `chatbot-tool-registry-hygiene.test.ts` | Static invariants over every registration, present and future |
| `chatbot-feature-flag-gate.test.ts` | "Both-off = current behavior" — the rollback guarantee |
| `chatbot-guardrails.test.ts` | Budget caps (all three), atomic spend increment, redaction |
| `chatbot-l0-orchestrator.test.ts` | L0 end to end with **no provider configured**; conversation self-scoping |
| `chatbot-tool-call-log.test.ts` | `ChatbotToolCall` rows, args-hash-not-values, idempotency |
| `chatbot-real-permissions.test.ts` | Every tool usable by the role it exists for, against the **real** `ROLE_PERMISSIONS` |

Self-scoping is asserted on the `where` clause the service actually issued, not just on the response body — a 200 with unfiltered rows is the defect being guarded against.

### A defect this suite did NOT catch, and now does

`assignments.list_mine` originally required `staffing:read` — a token the `WORKER` role does not hold. The one tool built for workers would have denied every worker in production. Every test passed, because each one constructed its own actor with `permissions: ['staffing:read']`: the suite proved only that the code agreed with itself.

Two changes came out of it. `chatbot-real-permissions.test.ts` asserts every tool against the **real** `ROLE_PERMISSIONS` sets, so a token no intended caller holds now fails CI. And the registry gained a `null` permission option, for the honest case where the wrapped route enforces no token at all (`GET /assignments` is `authMiddleware`-only) — constrained by `assertValidRegistration` to READ_ONLY + self-scoped + a written rationale, so it cannot become a loophole.

The general lesson, worth keeping: **a permission assertion written against invented permissions proves nothing.**

## Migration status — validated

Both migrations were applied to a throwaway PostgreSQL 16 instance and verified at the data layer (tables, indexes, FKs, the unique constraint on `idempotency_key`, `prisma migrate status` reporting no drift), including a from-scratch run of every migration against an empty database.

That exercise surfaced a **pre-existing repository defect unrelated to the chatbot**: `Contract.contract_pdf_s3_key`, `Contract.last_worker_expiry_reminder_at`, `Contract.worker_expiry_reminder_count`, `WorkerOverallRating.warning_50_sent_at`, `WorkerOverallRating.warning_70_sent_at`, and three `NotificationType` enum values exist in a **committed** `schema.prisma` but no migration ever created them. Any database provisioned from migrations alone is missing columns the generated Prisma client expects.

`prisma migrate dev` wanted to fold those into the chatbot migration, which would have misattributed them. They are split into `20260824112000_backfill_missing_quality_hr_schema`, authored from the committed schema with no new design decisions, so the chatbot migration owns only chatbot changes. **That migration is worth reviewing independently of this module** — it affects anyone provisioning a fresh environment.

## Next steps
1. **Step 5** — wire the provider (one Bedrock implementation behind `LlmProvider`) and the L1 router. Needs the API key and the provider decision. Nothing else changes: the budget gate, redaction, executor and templates the L1 path needs are all in place and tested.
2. Expand the L0 command set — it is the cheapest capability in the system, and every phrase added there is a query that never costs a token.
