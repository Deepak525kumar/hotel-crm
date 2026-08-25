# chatbot-prototype

A standalone, runnable implementation of `backend-chatbot` (`SPEC-CHATBOT-001`,
`ADR-013`, `ADR-053`). **Not integrated into hotel-crm-mvp.** It lives outside
the npm workspaces list (`package.json`'s `workspaces` array does not include
this directory), has its own `package.json`/`node_modules`, does not touch
`backend/src`, `backend/prisma/schema.prisma`, any route file, or
`.claude/knowledge/*.yaml`. Nothing here runs unless you `cd chatbot-prototype`
and start it yourself.

## Why isolated, not built into the real module

`docs/03-modules/chatbot/MODULE_SPEC.md` is `REVIEW`, not `FROZEN` — per this
repo's `CLAUDE.md`, "no implementation may begin from an unfrozen
specification." The module is also explicitly deferred post-MVP
(`docs/implementation/GD-19_CHATBOT_CHECKPOINT.md`) with three standing G2
blockers: unassigned module owner (`OD-CHAT-013`), an unratified
prompt-injection posture (`OD-CHAT-006`), and unresolved RBAC scope beyond
self-ownership (`OD-CHAT-005`). This prototype sidesteps that gate by not
being the governed module — it's a spike to validate the shape of the spec
and exercise the ADR-053 tool-registry architecture, meant to inform, not
pre-empt, the real `backend-chatbot` build once frozen.

## Spec traceability

| Spec item | Where it's implemented |
|---|---|
| `REQ-CHAT-001`/`003`, `RULE-CHAT-01` — Claude API, Haiku default | `src/claudeClient.ts`, `src/config.ts` |
| `REQ-CHAT-002`, `RULE-CHAT-02` — ask / re-ask until complete | `src/conversationService.ts` (`isComplete`, mock responder in `claudeClient.ts`) |
| `REQ-CHAT-004`/`005`/`007`, `RULE-CHAT-03` — budget caps + graceful fallback | `src/budgetGuard.ts` |
| `REQ-CHAT-006`, `RULE-CHAT-04` — cached required-document list | `ChatbotConversation.requiredDocuments`, refreshed only via explicit `submittedDocuments`, not re-derived every turn |
| `REQ-CHAT-008` — one interface, two purposes | **Partial.** `Purpose` union exists and `startConversation` is the single entry point, but `gdpr-subject-rights` is deliberately **refused with 501** — it needs its own system prompt, request-context schema, terminal condition, and guardrail review for a more sensitive data class. Accepting it silently would be purpose confusion. |
| `REQ-CHAT-009` — consumer-supplied context only, no autonomous start | `startConversation` takes `context` as input; nothing calls it on a timer |
| `REQ-CHAT-010` — completion/fallback signal, in-process outcome check | `getConversationOutcomeInProcess` (mode b). In the real module this is an in-process call; here it is additionally exposed as `GET /internal/conversations/:id` (bearer-gated) because this prototype has no in-process caller. Returns a narrowed `{id, status, fallbackReason?}` — never the transcript. |
| `REQ-CHAT-012`/`013`, `RULE-CHAT-08`/`09` — guardrails, self-scoping | `src/guardrails.ts`, `src/authStub.ts`, ownership checks in `conversationService.ts` |
| `REQ-CHAT-014`, `RULE-CHAT-10` — audit log | `src/auditLog.ts` |
| `ADR-053` — tool-registry, risk tiers, mandatory confirmation | `src/toolRegistry.ts` |
| `OD-CHAT-010` (named abuse shape) | `src/rateLimiter.ts`, applied in `conversationService.ts` |

## Guardrails implemented (defense-in-depth, not a G2 ratification)

- **Worker cannot self-attest completeness.** There is deliberately no wire
  field by which a worker asserts which documents they submitted. Completeness
  is Documents' authority and arrives only through the trusted-tier
  `POST /internal/conversations/:id/refresh` path. This is the single most
  important boundary here: `completed` is the signal Onboarding acts on.
- **Tool allow-listing** — the registry is a null-prototype object and lookups
  are `Object.hasOwn`-guarded, so inherited names (`constructor`, `__proto__`,
  `toString`, …) do not resolve. An invented name is refused, never executed.
- **Tool input validation** — every tool call's arguments are checked against
  a Zod `.strict()` schema before the handler runs, and re-validated at
  confirmation time.
- **Mandatory confirmation for irreversible actions**, enforced at
  *registration* time (`ADR-053` principle 5): a `high-risk-write` tool without
  `requiresConfirmation: true` throws at module load. Confirmations are
  **id-bound, argument-disclosing, and single-turn**: the prompt shows the
  concrete arguments, the worker must reply `confirm <id>`, and any other
  intervening turn — including a bare `confirm` — expires the pending call.
- **No identity parameters in tool schemas** — registration rejects any tool
  declaring `workerId`/`userId`/etc., since actor scope must come from the
  trusted `ToolContext`. That is the shape an IDOR takes in a tool-calling agent.
- **Self-scoping** — every worker-facing call binds to the authenticated actor
  (`x-worker-id` stub header) and the conversation's owning worker.
- **Minimized disclosure** — outcome reads return `{id, status, fallbackReason?}`
  only. Transcripts never cross a module boundary, since transcript retention
  is still an open decision (`OD-CHAT-008`).
- **Rate limiting** — per-worker *sliding* windows (timestamp-based, not fixed
  windows, which permit 2× bursts at the boundary) on conversation starts
  (5/hr) and message turns (20/min), addressing `OD-CHAT-010`.
- **Per-conversation serialization** — turns are chained per conversation, so
  concurrent requests cannot all pass the same pre-turn budget check and blow
  through the caps together (measured at 7× the per-conversation cap before
  this was added). In-process only; a multi-process deployment needs a DB lock.
- **Config fails closed** — a non-numeric cap (`2_000_000`) throws at boot
  rather than producing `NaN`, which would make every `>=` guard false and
  silently disable all cost control.
- **Turn-count ceiling**, 16kb body cap, per-field length caps, constant-time
  internal-token comparison, and validation errors that don't echo input back.

### What is deliberately NOT claimed as a control

- **Prompt injection is not solved.** The one real control is structural:
  worker text is passed as a `user`-role message and never concatenated into
  the system block. The regex detector (`detectNaiveInjectionAttempt`) is
  **telemetry only** — it catches unsophisticated attempts and is trivially
  evaded by whitespace, other languages, or synonyms; `tests/guardrails.test.ts`
  ships a corpus of known-undetected bypasses so this stays legible. When it
  does fire, the tool call is **refused outright** rather than routed to
  confirmation — asking a possibly-hostile worker to confirm their own injected
  action is not a control. `OD-CHAT-006` remains substantively unresolved and
  nothing here should be cited as partially resolving it.
- **`RULE-CHAT-08`'s SQL/script/XSS classes** are handled by JSON encoding and
  parameterized access, not by mangling worker prose. If a consumer ever
  renders a transcript as HTML, that consumer must escape it.
- **The stub auth is not auth.** `x-worker-id` is settable by anyone; it exists
  so the self-scoping invariant is testable. `/internal/*` bearer-gating
  simulates the spec's in-process trust boundary, which has no HTTP surface in
  the real design.

**Also not addressed** (open in the real spec, not silently assumed resolved):
broader RBAC beyond self-ownership (`OD-CHAT-005`), transcript
persistence/retention (`OD-CHAT-008`), encryption at rest (`OD-CHAT-018`),
malware scanning for any future file-handling tool (`OD-CHAT-009`), and
provider retry/backoff (`OD-CHAT-015`).

## Running it

```bash
cd chatbot-prototype
npm install
cp .env.example .env   # paste your ANTHROPIC_API_KEY when you have one
npm run dev
```

Without a key, it runs in **mock mode** (deterministic canned responses) —
the conversation loop, budget guard, rate limiter, and the full tool path are
all exercisable with zero external calls or spend. The mock emits tool calls on
trigger phrases (`check status of X`, `speak to a human`, `trigger unknown
tool`, `trigger bad tool input`) so the allow-list, schema gate, and
confirmation flow are genuinely reachable — an earlier version always returned
`toolUse: null`, which left the entire tool path dead code and let a broken
confirmation gate sit under a green suite.

Dropping a real key into `.env` switches to live Claude Haiku, no code change.
**Untested against the live API**: mock mode cannot validate real request/response
shapes. The known API-shape hazards (empty `messages` array on the opening turn;
an assistant-role first message on later turns) are handled in
`buildApiMessages`, but the first real key should be spent on a smoke test.

```bash
npm test        # vitest — lifecycle, guardrails, rate limits, budget fallback, HTTP layer
npm run typecheck
```

### Manual smoke test

```bash
# server prints the internal caller token at boot — copy it
curl -s localhost:4310/healthz

curl -s -X POST localhost:4310/internal/conversations \
  -H "Authorization: Bearer <token from boot log>" \
  -H "Content-Type: application/json" \
  -d '{"workerId":"w1","purpose":"onboarding-document-collection","context":{"requiredDocuments":[{"name":"Passport","present":false}]}}'

curl -s -X POST localhost:4310/conversations/<id>/messages \
  -H "x-worker-id: w1" -H "Content-Type: application/json" \
  -d '{"message":"here you go"}'

# Completeness comes from the trusted tier, never from the worker's message:
curl -s -X POST localhost:4310/internal/conversations/<id>/refresh \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"presentDocumentNames":["Passport"]}'
```

## Deliberate simplifications (prototype only)

- **Storage**: in-memory `Map`, not the proposed `ChatbotConversation` Prisma
  model (`OD-CHAT-001`, `MIG-GAP-CHAT-003`) — state is lost on restart.
- **Budget guard execution model**: inline synchronous check per turn
  (`OD-CHAT-011` candidate i), not a scheduled poller — no job runtime exists
  in this repo to build candidate (ii) against.
- **"Cached required-document list" refresh**: `refreshRequiredDocuments` takes
  the present-document names as a parameter, standing in for a real call to
  Documents' completeness interface, which this isolated prototype cannot
  reach. It is trusted-tier only — see the guardrails section.
- **Tools are stubs**: `confirm_document_format` and `flag_for_manual_review`
  don't call any real module — there is no Documents/Onboarding module to
  call from here. Swapping the stub body for a real `IF-*` call is the
  integration step, deliberately not taken yet.
