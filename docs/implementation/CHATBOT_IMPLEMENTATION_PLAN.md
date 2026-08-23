# Chatbot Implementation Plan

| Field | Value |
|---|---|
| Status | **Draft — not authorized to start.** `GD-19` is `DEFERRED — POST-MVP` by explicit human decision (2026-07-28). Step 0 is the gate; nothing below it may begin until Step 0 closes. |
| Version | 1.1 (2026-08-23) — revised against the repository at `8626256`. Supersedes the 1.0 plan authored in conversation. |
| Governing records | [`ADR-013`](../14-governance/architecture-decisions/ADR-013-chatbot-ai-capability-ownership-vs-onboarding-workflow.md) (ownership), [`ADR-053`](../14-governance/architecture-decisions/ADR-053-chatbot-orchestration-layer-tool-registry.md) (orchestration + tool registry), [`SPEC-CHATBOT-001`](../03-modules/chatbot/MODULE_SPEC.md) §Implementation-Time Inputs |
| Resumption context | [`GD-19_CHATBOT_CHECKPOINT.md`](GD-19_CHATBOT_CHECKPOINT.md) |

---

## ⚠️ Read this before anything else

**A design document this plan depends on is not in the repository.**

Version 1.0 of this plan cites an architecture document by section — **§9** (prompt-injection
posture), **§10** (the budget-cap table), **§16** (rollout metrics) — and depends on it for the
`backend/src/modules/chatbot/` file layout and the Prisma models `ChatbotConversation` /
`ChatbotToolCall`. That document exists only in the conversation that produced the plan.

Steps 2, 6, 9 and 11 below cannot be executed as written until it is committed. Where this revision
could not verify a §-reference, it says so rather than inventing the content.

**Action:** commit that design document (suggested path
`docs/02-architecture/system/CHATBOT_ORCHESTRATION_DESIGN.md`), then replace every §-reference here
with a real link. Tracked as `OD-CHAT-020`.

---

## What changed since plan v1.0

The repository moved underneath the original plan. Five changes alter its steps:

| Change | Effect on the plan |
|---|---|
| **123 `IF-*` interfaces now exist and are indexed with `ADR-053` risk tiers** (`.claude/knowledge/INTERFACE_INDEX.yaml`, 50 as-built) | Steps 4 and 8 change from "wire a tool to a service" to "bind a tool to an `IF-` id". This was the `ADR-053` blocker; it is cleared. |
| **`SPEC-I18N-001` exists** | A new prerequisite: *which language does the chatbot answer in* (`OD-I18N-03`) is now a named open decision, not an unknown. Added as Step 1. |
| **`ADR-071` exists** (dual-transport auth) | The web widget and mobile screens authenticate differently, and a **separately-hosted** widget is blocked on `OD-AUTH-T2` (CSRF). Folded into Steps 0 and 11. |
| **`SPEC-CHATBOT-001`'s stale neighbour claims corrected** (v0.2.0 addendum, 2026-08-22) | The original Step 0 item "correct the two stale facts" is **done**. |
| **`backend-chatbot` already present in all four knowledge indexes** | Step 3's "add to the registry" becomes "update lifecycle", not "create". |

**Model facts corrected from v1.0:** the model id is exactly `claude-haiku-4-5`; its context window
is **200K, not 1M**; `output_config.effort` is **unsupported and errors** on it; adaptive thinking is
unavailable. Details and consequences in `SPEC-CHATBOT-001` §Implementation-Time Inputs §2.

---

## Step 0 — Governance gate (no code)

`.claude/CLAUDE.md`: *no implementation may begin from an unfrozen specification.* `SPEC-CHATBOT-001`
is `REVIEW`, and `GD-19` is deferred. This step is a conversation, not a sprint — but it is the gate.

| Item | What is needed | Current |
|---|---|---|
| `GD-19` | Explicit human decision to resume | **DEFERRED — POST-MVP** |
| `OD-CHAT-013` | Assign a human owner for `backend-chatbot` | Unassigned (`SYNC-001`) |
| `OD-CHAT-005` | Ratify RBAC scope. **Minimum to unblock: confirm the MVP is self-scoped only** — a worker acting on their own data — deferring manager and cross-worker scope | Open |
| `OD-CHAT-006` | Accept an interim prompt-injection posture | Open — and the design doc's §9 that would define it **is missing** (`OD-CHAT-020`) |
| `OD-CHAT-020` | Commit the missing design document | **New, blocking** |

**Exit:** written authorization to build a **self-scoped, read-only** MVP. Nothing wider.

## Step 1 — Settle the language contract (no code)

**New in v1.1.** A conversational interface cannot be specified without knowing which language it
answers in, and v1.0 did not mention language at all.

Resolve `OD-I18N-03` (`SPEC-I18N-001` §6). Concretely, decide: does the reply follow
`User.preferred_language`, the language the user typed in, or an explicit per-conversation setting?
And what happens when the preference is `NULL` — a real state, since the column deliberately has no
default.

**Why it cannot wait:** the German fallback would answer a Ukrainian speaker in German. Acceptable
for UI chrome; not for generated conversation. Also note two of the six locales are right-to-left and
RTL has never been assessed in a conversational surface (`OD-I18N-04`).

**Exit:** a recorded decision. One paragraph is enough — but it must exist.

## Step 2 — Provider spike (half a day, nothing committed)

Prove the model call works before touching the codebase. **Scratch script, outside the repo.**

1. Get an API key from the Anthropic console.
2. Call `claude-haiku-4-5` with one message; print the response.
3. Add one fake tool (`ping.echo`) and confirm Claude returns a `tool_use` block rather than prose.

Use the official SDK (`@anthropic-ai/sdk`) — this is a TypeScript codebase. Do **not** set
`output_config.effort`; it errors on this model.

**Done when:** you have watched Claude ask to call your tool, in your terminal.

## Step 3 — Scaffold the module (no AI yet)

1. Create `backend/src/modules/chatbot/{routes,controller,service,types}.ts`, mirroring an existing
   module's shape (`modules/assignments/` is a good reference).
2. Add the Prisma models — **from the missing design doc** (`OD-CHAT-020`). Migration must include a
   `down.sql`; all 65 existing migrations have one and that coverage should stay complete.
3. Add config to `config/env.ts` using `strictBooleanFlag(false)` — the `FEATURE_EMPLOYMENT_RECORD`
   pattern, which parses strictly instead of silently treating a typo as `false`.
4. Mount in `routes/v1/index.ts` behind the flag, matching the `/employees` pattern: while disabled,
   requests fall through to the 404 handler (`ADR-024` D3, "both-off = current behavior").
5. **Update** — not create — `backend-chatbot` in `MODULE_REGISTRY.yaml`, `SPECIFICATION_INDEX.yaml`,
   `API_INDEX.yaml` (currently under `unregistered`), `DEPENDENCY_GRAPH.yaml`, `BOUNDARY_INDEX.yaml`.

**Done when:** the app boots, the flag is off, `/api/v1/chatbot/*` 404s, nothing else changed.

## Step 4 — The security boundary, before any model call

**Build the part that matters most first, and test it with no LLM in the loop.**

1. `tools/actor.ts` — build `ActorContext` **only** from `req.auth`. No other constructor.
2. `tools/registry.ts` — tool registration keyed by `IF-` id, with a forbidden-argument-key
   constraint so a tool can never accept a caller identity as an argument.
3. `tools/executor.ts` — the gate: identity → live permissions → scope → domain authorization →
   action. **Reuse `resolveHotelAccess` / `resolveWorkerScope` from `middleware/permissions.ts`.**
   Write no new authorization logic; `ADR-053` principle 3 makes the owning module's own enforcement
   the only enforcement.
4. Register one fake tool with a hardcoded response. No LLM.
5. `chatbot-executor-authz.test.ts` — call the executor directly as different roles and scopes;
   assert allow/deny; **read the database** to confirm effects, per the E2E suite's standing rule
   that a `200` has repeatedly meant nothing was written.
6. `chatbot-tool-registry-hygiene.test.ts` — static check that no schema carries a forbidden key,
   mirroring `__tests__/support/route-registry.ts`.

**Registry ordering matters for cost, not just style.** Render tools in a deterministic order — an
unordered map produces a byte-unstable prefix that destroys prompt-cache hits without failing a single
test.

**Done when:** a test proves the executor denies out-of-scope access, with zero AI involved. This is
the step that makes everything after it safe.

## Step 5 — First real tool, real service, still no LLM

Bind **`IF-ANALYTICS-GetMyStats`** (read-only, as-built, self-only, no arguments). v1.0 proposed
`assignments.list_mine`; `GetMyStats` is the better first target because it takes no arguments and
does not ride a role guard (`GD-06`), so it exercises the executor with the least authorization
surface to get wrong.

1. Register it in `tools/definitions/self-service.tools.ts`, `tier: READ_ONLY`.
2. Add a controller endpoint that invokes it directly with fixed arguments — real JWT, no model.
3. Extend the authz matrix test to cover it across roles.

**Done when:** authenticated as a real worker, you hit an endpoint and get your real stats back —
through the executor, through the real service, with no AI in the loop.

## Step 6 — Wire in the model (L1 only)

1. `provider/llm-provider.ts` (interface) + `provider/anthropic-provider.ts` — productionize Step 2's
   spike. Key from env; never hardcoded.
2. `orchestrator/router-l1.ts` — user text + tool digest → one structured tool call. Use **structured
   outputs** (`output_config: {format: {...}}`) or `strict: true` on the tool rather than asking for
   JSON in prose. One tool call per turn.
3. `orchestrator/orchestrator.ts` — receive message → L1 → executor → done. No L0, no synthesis yet.
4. `prompts/system.ts` — static and **byte-stable**. Any per-request value in here silently kills the
   cache.
5. `prompts/templates.ts` — deterministic rendering of the result. No second model call to write prose.

**Done when:** with the flag on for your user only, "what are my stats this month" returns a real,
correctly-scoped answer end to end.

## Step 7 — Guardrails and budget

Do not add more tools before this.

1. `guardrails/budget.ts` — per-turn synchronous check against a counter row. **Caps come from the
   missing design doc §10** (`OD-CHAT-020`).
2. `jobs/budget-guard.job.ts` — register on the **existing** `lib/scheduler.ts`. No new runtime;
   `ADR-057` settled Platform-Worker-not-BullMQ, and `HrContractExpiryReminderJob` is the shape to copy.
3. `guardrails/injection-filter.ts` — wrap any database-sourced text in untrusted-data framing; add
   the canary check. **Posture comes from the missing design doc §9.**
4. `guardrails/redaction.ts` — strip special-category fields before any tool result reaches the model.
5. `chatbot-injection.test.ts` — assert **no unregistered tool executes**. Do not assert "the model
   refused"; that tests the model, not your boundary.

**Enable prompt caching here, once the system prompt has stabilized.** Verify with
`usage.cache_read_input_tokens` — if it is zero across repeated turns, something is invalidating the
prefix. Watch the ~1024-token minimum: a short prefix silently does not cache at all.

**Done when:** hitting the cap produces `fallback-triggered`, not a crash; a redacted field never
appears in a captured prompt.

## Step 8 — Add L0 (where most of the cost saving lives)

1. `orchestrator/router-l0.ts` — exact phrases, slash-commands and button payloads mapped directly to
   tool calls. **Zero LLM.**
2. `GET /chatbot/commands` returning the manifest, for the client to render as quick-reply chips.
3. Orchestrator tries L0 before L1.

**Done when:** tapping a chip produces no network call to Anthropic at all.

## Step 9 — Round out the read-only tools

Repeat Step 5's pattern for the as-built, read-only interfaces:

| Interface | Answers |
|---|---|
| `IF-ASSIGN-ListAssignments` | "What shifts do I have" |
| `IF-ATT-ListAttendance` | "Did I check in" |
| `IF-QUAL-GetLeaderboard` | "How am I doing" — own hotel group, non-contact fields only (`ADR-067`) |

**Two tools from v1.0 are blocked.** `IF-DOC-ListWorkerDocuments` and `IF-HR-GetContractStatus` are
specified `target` though their modules ship, so binding to them would violate `ADR-053` principle 2.
Reconciling those specs is **owning-module work**, not chatbot work (`OD-CHAT-021`).

Each tool: registry entry → controller smoke test → authz matrix test → done.

## Step 10 — Confirmation flow (only when adding a write)

1. `guardrails/confirmation-token.ts` — HMAC mint/verify, single-use, bound to the exact arguments.
2. `POST /chatbot/conversations/:id/confirm`.
3. First write tool: **`IF-NOTIF-MarkAsRead`** — low-risk tier, reversible, self-scoped.
4. `chatbot-confirmation.test.ts`, `chatbot-idempotency.test.ts`.

**Done when:** a double-submitted confirmation executes once — verified by a database read.

**`ADR-053` principle 5 is not negotiable:** high-risk and irreversible writes take **mandatory**
confirmation enforced by the orchestration layer, regardless of what the tool registered. 21 of the
50 as-built interfaces are tiered high-risk.

## Step 11 — Onboarding document collection (the actual confirmed requirement)

`REQ-CHAT-001/002` — the one part of this project with unambiguous business authority (CRR §8).

1. `IF-CHATBOT-StartConversation` as an **in-process** entry point, callable only from Onboarding's
   own authenticated route handler (`ADR-013` item 3, `ADR-032` direct-call transport).
2. Multi-turn loop: track outstanding required documents in `session_state`, re-prompt for what is
   missing.
3. Static-checklist fallback on the Onboarding side, triggered by `fallback-triggered`.
4. **Add an E2E scenario** under `docs/10-testing/e2e/scenarios/` and register it in that README's
   index — mandatory per `.claude/CLAUDE.md`.

**Done when:** a test worker completes document collection conversationally, and hitting the budget
cap mid-conversation falls back to the static checklist without erroring.

## Step 12 — Staged rollout

1. Flag on in **staging only**. Run the full E2E suite and **verify at the data layer**.
2. Internal dogfood — real accounts, test data.
3. Watch L0 hit rate, tokens/turn, denial rate (**metrics from the missing design doc §16**). A low
   L0 hit rate is a prompt to add more chips, not more model calls.
4. Small worker cohort. Keep `CHATBOT_ENABLED=false` rehearsed as a kill switch.

**Client surfaces:** the web widget authenticates by httpOnly cookie, mobile by bearer token
(`ADR-071`). **A separately-hosted widget is blocked** — `SameSite=Lax` is safe only because the
browser reaches the API through the same-origin Next.js rewrite proxy (`OD-AUTH-T2`).

## Step 13 — Migrate to Bedrock (before real PII, not after)

Swap `provider/anthropic-provider.ts` for a Bedrock provider behind the same `LlmProvider` interface —
no orchestrator changes. Use the **`AnthropicBedrockMantle`** client (`@anthropic-ai/bedrock-sdk`);
Bedrock model ids take an `anthropic.` prefix.

**Do this before any real (non-test) worker personal data flows through the model**, per the EU
residency posture this platform operates under. Verify prompt-caching availability on the target
platform as part of the migration — provider feature parity is not guaranteed.

---

## The rule that governs the whole order

**Every step builds and tests the executor and its authorization before it builds the thing that
talks to it.** Step 4 exists before Step 6 on purpose.

If you find yourself wiring a new tool straight from the model to a service without a passing authz
test for it first, stop — the order has inverted, and that is exactly the mistake this design exists
to prevent.

## Open decisions this plan depends on

| ID | Decision | Owner | Blocks |
|---|---|---|---|
| `GD-19` | Resume chatbot work | Human | Everything |
| `OD-CHAT-005` | RBAC scope (minimum: self-scoped MVP) | Human | Step 0 exit |
| `OD-CHAT-006` | Prompt-injection posture | Human | Step 7 |
| `OD-CHAT-013` | Module owner | Human (`SYNC-001`) | Step 0 exit |
| `OD-CHAT-020` | **Commit the missing design document** | Author | Steps 3, 7, 12 |
| `OD-CHAT-021` | Reconcile `IF-DOC-*` / `IF-HR-*` target-vs-built | Owning modules | Step 9 |
| `OD-I18N-03` | Which language the chatbot answers in | Human | Step 1 |
| `OD-AUTH-T2` | CSRF for a cross-origin widget | Human | Step 12 (widget only) |
| `ADR-053` fwd. | Knowledge providers vs. action tools | Human | Any retrieval/RAG work |
