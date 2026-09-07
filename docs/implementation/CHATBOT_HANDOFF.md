# Chatbot — Handoff and Resumption Point

**Read this before writing any `backend-chatbot` code.** It records what exists, what does not, what is deliberately refused, and the traps that have already cost time. It is the companion to [`GD-19_CHATBOT_CHECKPOINT.md`](GD-19_CHATBOT_CHECKPOINT.md), which holds the governance state; this file holds the implementation state.

| Field | Value |
|---|---|
| Status | Scaffold + L0 command path, behind `FEATURE_CHATBOT` (default **OFF**) |
| Module | `backend/src/modules/chatbot/` — see its [`README.md`](../../backend/src/modules/chatbot/README.md) for design detail |
| Governing decisions | `ADR-013` (AI-execution ownership), `ADR-053` (orchestration layer + tool registry) |
| Specification | `SPEC-CHATBOT-001@0.2.0` — **`REVIEW`, not `FROZEN`** |
| Completion | ~40% of the backend module. **0% of the AI itself.** |
| Tests | 232 chatbot tests across 18 suites; full backend suite 3714 passing (2026-09-04) |

---

## 1. The one-paragraph summary

There is no chatbot yet. There is a **safe harness for one**, plus a working zero-cost command path. A worker can ask "my shifts" (or tap a chip) and get a correct, correctly-scoped answer with **no API key, no provider, and zero tokens spent** — because L0 resolves known phrases deterministically to a tool call through the same authorization gate the model path will use. Everything that makes it a *chatbot* — provider, L1/L3 routing, prompts — is unbuilt and needs an API key plus a provider decision.

## 2. What is built

| Piece | File | Notes |
|---|---|---|
| Actor | `tools/actor.ts` | Branded `ActorContext`, constructible **only** from `req.auth` |
| Registry | `tools/registry.ts` | Declarative registration; forbidden-argument invariant |
| **Executor** | `tools/executor.ts` | **The security boundary** — the five-step gate |
| Tool | `tools/definitions/self-service.tools.ts` | `assignments.list_mine` — self-scoped, READ_ONLY |
| Tool-call log | `tools/tool-call-log.ts` | `ChatbotToolCall` rows + write idempotency |
| Budget guard | `guardrails/budget.ts` | Monthly + per-conversation + per-worker-daily caps |
| Redaction | `guardrails/redaction.ts` | Special-category values → presence booleans |
| L0 router | `orchestrator/router-l0.ts` | Deterministic commands, **zero LLM calls** |
| Orchestrator | `orchestrator/orchestrator.ts` | Turn loop and routing ladder |
| Templates | `orchestrator/templates.ts` | Deterministic rendering (no second model call) |
| Provider seam | `provider/llm-provider.ts` | Interface only; `getProvider()` returns `null` |

Routes, all authenticated, all behind the flag: `GET /chatbot/commands`, `POST /chatbot/conversations`, `POST /chatbot/conversations/:id/messages`, `GET /chatbot/conversations/:id`, `GET /chatbot/tools`, `POST /chatbot/tools/invoke`.

Database: `ChatbotConversation`, `ChatbotToolCall`, `ChatbotBudgetCounter`. Migration `20260824112010_add_chatbot_conversation_toolcall_budget` ships with the paired `down.sql` this repo's migrate harness requires, and was applied to a throwaway PostgreSQL 16 instance and verified at the data layer (tables, indexes, FKs, the unique constraint on `idempotency_key`, no drift).

## 3. What is NOT built — and why

Each of these is a deliberate refusal, not an oversight. Re-deciding them is fine; doing so *unknowingly* is the failure mode this section exists to prevent.

- **No LLM provider.** No Bedrock or Anthropic client. Provider selection (Bedrock `eu-central-1` vs. the Anthropic API direct) is live and has a GDPR data-residency dimension — the platform holds German workforce data (`SOCIAL_SECURITY_NUMBER`, `TAX_NUMBER`) already in `eu-central-1`.
- **No L1 router, no L3 planner, no prompts.** The L1 branch is reached and logged but **deliberately not stubbed**. An unrun API-shape guess is exactly how a defect ships unnoticed — this already happened once in the throwaway prototype, where an empty `messages: []` array on the opening turn would have failed on the very first real call.
- **No conversation transcript is stored.** `session_state` is structured; `ChatbotToolCall` stores an args **hash**, never argument values or results. This sidesteps `OD-CHAT-008` (transcript retention), `OD-CHAT-018` (encryption at rest) and `OD-CHAT-019` (transcript tier) rather than foreclosing them.
- **No write tool, and no tool touching another person's record.** Was blocked on `OD-CHAT-005`; `ADR-073` (Accepted 2026-09-04) answers it: a user may do through the assistant exactly what they can do by hand, within their own scope. The hygiene test still fails the build on a write tool, and MUST stay that way until the confirmation flow exists — `ADR-053` item 5 makes confirmation mandatory for high-risk writes, and `CHATBOT_CONFIRM_TOKEN_SECRET` is still configured-but-unused.
- **No analytics tool.** Blocked on `OQ-ANALYTICS-01` — `API_INDEX.yaml` records the leaderboard routes as missing `requireRole`/`checkHotelAccess`. Wrapping a broken route in a tool would industrialize the breakage.
- **No confirmation-token flow.** `CHATBOT_CONFIRM_TOKEN_SECRET` is configured but unused, because no `HIGH_RISK_WRITE` tool exists to need it.

The last two constraints are enforced **mechanically** by `chatbot-tool-registry-hygiene.test.ts`, not left to reviewer memory. Those tests are expected to be updated deliberately when the decisions land.

## 4. Before you enable the flag

`SPEC-CHATBOT-001` is `REVIEW`, not `FROZEN`, and `.claude/CLAUDE.md` states no implementation may begin from an unfrozen specification. Three G2 blockers stand (`GD-19_CHATBOT_CHECKPOINT.md` §2):

| Blocker | Status |
|---|---|
| `OD-CHAT-005` | **CLOSED 2026-09-04** by `ADR-073` (Accepted). The assistant's authority is the user's own authority, never more — a Manager may act on a worker inside their own scope precisely because they can already do so by hand. |
| `OD-CHAT-006` | **Answered by `ADR-074`, awaiting ratification.** Containment, not detection: a compromised model cannot exceed its user's authority, and irreversible actions need confirmation of the exact call. |
| `OD-CHAT-013` | **CLOSED 2026-09-04** — owner is the commissioning human / account owner, assigned directly |

Everything registered today is self-scoped, so the scaffold is correct under **either** resolution of `OD-CHAT-005`. Also note `ADR-053` item 4: it approves the tool-registry *architecture*, not any specific tool — `assignments.list_mine` carries `approvalRef: PENDING` for exactly this reason.

**Do not enable `FEATURE_CHATBOT` outside development until those blockers close.**

## 5. The invariant that must not be broken

**The model never produces an authorization input.**

A tool call is a *request*, not a command. It carries semantic arguments only; every identity, role, scope and permission value is re-derived server-side from `req.auth` at execution time. Tool schemas may not declare `userId`, `actorId`, `role`, `permissions`, `scope`, `hotelId`, `workerId`, or `internalBypass` — enforced by the `SafeArgs` type (compile time), `assertNoForbiddenArgs` (registration time, so a violation is a boot failure), and a static test over the whole registry (CI).

`internalBypass` is on that list deliberately and is not hypothetical: `assignments/service.ts` accepts it as a 6th parameter and skips a worker-role authorization branch when true.

### The five-step gate — every execution, no exceptions

1. **Authenticated identity** — `ActorContext` from `req.auth`, which `authMiddleware` populates from a live DB read on *every* request (`ADR-031` D-3).
2. **Live permissions** — the tool's token re-checked in-process.
3. **Tenant/scope** — `resolveHotelAccess` / `resolveWorkerScope`, the same seams the HTTP routes use, not a copy.
4. **Domain authorization** — the owning service's own checks run again inside `invoke()`.
5. **Action** — executed with the step-1 actor.

Steps 2–4 are redundant on purpose. Layer 4 exists because `assignments/service.ts` `list()` once shipped with no scope check while its siblings had one (the IDOR fix at `service.ts:262`).

## 6. Traps already hit — do not re-learn these

**A permission assertion written against invented permissions proves nothing.** `assignments.list_mine` originally required `staffing:read`, a token the `WORKER` role does not hold. The one tool built for workers would have denied every worker in production, and 100+ tests passed because each one fabricated `permissions: ['staffing:read']` in its own fixture. `chatbot-real-permissions.test.ts` now asserts every tool against the real `ROLE_PERMISSIONS` sets. **Check new tools against the real role sets before trusting a green suite.**

**A token the wrapped route does not enforce is a lie or a lockout.** `GET /assignments` is `authMiddleware`-only. The registry therefore allows `permission: null`, constrained by `assertValidRegistration` to READ_ONLY + self-scoped + a written rationale. Model the real gate; do not invent one.

**Do not pin gate coverage to whichever real tool happens to require a token.** When `assignments.list_mine` moved to `permission: null`, four permission-gate assertions silently went dead. `chatbot-executor-authz.test.ts` now owns that coverage via a test fixture tool.

**Mock-only tests prove nothing about the database.** Every chatbot test mocks Prisma. The migration was verified separately against a real PostgreSQL instance; any future DB-shaped claim needs the same treatment.

**Every migration needs a paired `down.sql`.** The CI job *Forward · Rollback · Recovery* fails the build without one. Check an existing migration for the convention before writing a new one — enum changes in particular are delicate, since PostgreSQL has no `ALTER TYPE ... DROP VALUE` and a mis-ordered rebuild silently relabels existing rows.

**Unicode normalization can split a word in half, and an ASCII-only test will not notice.**
`normalize()` ran `NFKD` and then replaced every non-letter/non-digit with a **space**. `NFKD`
decomposes `ä` into `a` + U+0308 COMBINING DIAERESIS, which is Unicode category `Mn` (Mark),
**not** `L` — so the mark became a separator and `"nächste schicht"` normalized to
`"na chste schicht"`, matching no phrase at all. Every German worker typing the natural
spelling of an umlaut word fell straight through to L1, which is not built. It survived review
and a green suite because the single German phrase under test, `'Meine Schichten'`, happens to
contain no umlaut. Fixed 2026-09-04: umlauts fold to `ae`/`oe`/`ue`/`ss` before decomposition,
and residual combining marks are **removed** rather than replaced with a separator.
**This platform's workforce is German-speaking — treat German input as the common case and
test it with real umlauts, not ASCII stand-ins.**

**A write tool needs a real permission token — and two self-service routes had none, so the
platform gained two.** `assertValidRegistration` admits `permission: null` only for READ_ONLY
self-scoped tools, which is right: letting it widen to writes would make `null` the way writes get
registered. But `POST /notifications/:id/read` and `POST /calendar/my-absences` enforced no token
at all, so the two SAFEST writes on the platform were the ones that could not be exposed, while a
write touching someone else's record could. Owner decision, 2026-09-04: **name the capability
rather than loosen the guard.** `notifications:mark-read-own` and `calendar:absence:write-own`
were added, granted to EVERY role (nobody who could call those routes lost access), and the routes
now enforce them — "satisfied by construction", as `ADR-042`/`OD-HR-10` describes
`hr:contract:read-own`. **If you gate a previously-open route, grant the token to every role first
and assert it**: `calendar-my-absences-scope.test.ts` hardcoded `permissions: []`, so it had never
exercised a permission gate and went 403 the moment one existed — while real users, whose
permissions come from `ROLE_PERMISSIONS[user.role]`, were unaffected. Fixtures that fabricate
permissions hide exactly this.

**The registry cannot express a role-conditional permission, and several routes have one.**
`requireContractReadAccess()` and `requirePayslipReadAccess()` (hr/routes.ts) gate
worker/checker on `hr:contract:read-own` / `hr:payslip:read-own` and admin/manager/RM on
`hr:read`. `ToolRegistration.permission`'s array form is an AND (`every()` in permissions.ts),
so naming both tokens denies **everyone** (no role holds both) and naming either alone locks out
half the platform. `hr.my_contract` models this as `permission: null` with a written rationale,
which is safe there only because the tool is self-scoped, the worker id is the actor's own and is
not expressible as an argument, and the service re-checks. **Do not copy the `null` without
copying all three of those conditions** — and prefer fixing the registry to express an OR, rather
than restating this per tool.

**A manager naming a WORKER is legitimate; a model naming an ID is not.** `worker_id` and
`hotel_id` are FORBIDDEN_ARG_KEYS, so a manager-scoped tool cannot accept either — but a manager
genuinely needs to ask about one person. The honest resolution is a free-text `q` that searches
worker/hotel names *inside the scope the owning service has already narrowed to*
(`assignments.list_for_my_team`). Do NOT add an id argument "just for managers": an id supplied by
a model is an authorization input wearing a semantic costume, and the forbidden-key list exists
precisely to stop that. **The same problem is unsolved for manager WRITES** — `placeOnCalendar`
requires `worker_id` and `hotel_id`, so a "put Anna on Tuesday" tool needs name→id resolution
performed server-side within the caller's scope, with explicit ambiguity handling. That is a
design task, not a wiring one.

**Verify your base branch is current before concluding anything about the repo.** A stale working branch made `prisma migrate dev` report drift for columns that a migration on `origin/main` already created, which was briefly mistaken for a missing-migration defect. Confirm against `origin/main`, not whatever branch happens to be checked out.

## 7. Next steps, in order

1. **Close the remaining G2 blockers** (§4). `OD-CHAT-013` is CLOSED (owner assigned 2026-09-04) and
   `OD-CHAT-005` is answered by `ADR-073`. **`OD-CHAT-006` (prompt-injection) is the last one**, and it
   is now the harder of the two it used to sit beside: `ADR-073` admits writes, so a successful injection
   moves from "reads data the user could already see" to "performs an action the user could already
   perform". Still bounded by the user's own scope -- that containment is the design's most valuable
   property -- but no longer harmless.
2. **Step 5 — wire the provider.** One Bedrock implementation behind `LlmProvider`, plus the L1 router. Needs the API key and the provider decision. Nothing else changes: the budget gate, redaction, executor, tool-call log and templates are all in place and tested. **Spend the first real key on a smoke test** — mock mode cannot validate real request/response shapes.
3. **Expand the L0 command set.** It is the cheapest capability in the system: every phrase added there is a question that never costs a token. Expect this to dominate the cost model; instrument the L0 hit rate.
   *Progress 2026-09-04:* phrase coverage for the two existing commands widened from 15 to 39 (English + German, both umlaut and `ae` spellings), and the lookup now **throws at module load** if two commands claim the same normalized phrase — a collision would otherwise be won silently by whichever command is declared last and route a worker to the wrong tool. **Further L0 expansion is now gated on tools, not phrases:** `assignments.list_mine` is still the only registered tool, so any new command (documents status, attendance, contract status) needs its tool first, and each tool is its own approval under `ADR-053` item 4.
4. **Add read-only self-scoped tools** one at a time (documents status, attendance, contract status), each with its own registry entry, its own authz matrix test, and its own approval per `ADR-053` item 4.
