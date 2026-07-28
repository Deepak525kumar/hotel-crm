# GD-19 Checkpoint — Chatbot Module Scope & LLM Safety

| Field | Value |
|---|---|
| Status | **DEFERRED — POST-MVP.** Explicit product decision by the commissioning human, 2026-07-28, made after `ADR-053` (sub-decision 1 of `GD-19`) was ratified and merged. |
| Purpose | A complete, self-contained resumption point for `GD-19` so it can be picked back up after MVP with zero context loss — every conclusion, every open item's exact current status, every dependency, and every deferred concern is recorded here rather than left to be reconstructed from conversation history. |
| Governing architecture | `ADR-053` (Accepted, 2026-07-28) — retained in force. Nothing in this deferral weakens, reopens, or supersedes it. |
| Isolation from MVP | **Confirmed isolated.** Verified by direct text search: no `GD-20`, `GD-21`, or `GD-22` section references any `OD-CHAT-*` item, `SPEC-CHATBOT-001`, or `backend-chatbot`; no `docs/03-modules/{job-dispatch,attendance,crm}/MODULE_SPEC.md` references chatbot in either direction. See "Dependency verification" below for the full check. |
| Resume trigger | Post-MVP, when Product Owner/Architect decide to resume Chatbot module work — no other governance decision is blocked on this resuming. |

---

## 1. What is already decided (retained, not reopened)

### `ADR-053` — Chatbot as AI Orchestration Layer, Tool-Registry Architecture (Accepted, 2026-07-28)

Resolves `OD-CHAT-002`. Full principles, retained as governing architecture for whenever Chatbot work resumes:

1. **The chatbot is an AI orchestration layer, not a business module.** Owns conversation, intent recognition, clarification, tool selection, and response generation. Owns no business state beyond its own conversation record (message history, the conversation's own tool-call log).
2. **Every executable platform capability exposed through the chatbot is implemented as a tool that invokes an existing `IF-*` interface owned by another module.** No bespoke backend capability is ever created solely for the chatbot's benefit.
3. **Ownership split is absolute and non-negotiable per tool:** the owning module retains business rules, validation, authorization, state changes, persistence, and auditing. The chatbot never accesses a database or another module's internals directly — every read/write is mediated by the owning module's own interface, under that module's own enforcement (including its own RBAC — the calling worker's own permissions, never a chatbot-elevated identity).
4. **Tool invocation is allow-listed, not open-ended.** `ADR-053` approves the architecture for adding tools one at a time — it approves no specific tool. Each tool integration is its own explicit future approval.
5. **Three risk tiers at tool-registration time, each with its own confirmation policy:**
   - **Read-only** (e.g., get schedule, document status, attendance history): executes immediately, no confirmation.
   - **Low-risk write** (e.g., mark a notification read, update preferred language): confirmation *optional*, decided per-tool at registration.
   - **High-risk/irreversible write** (e.g., submit a leave request, generate a compliance export, cancel an assignment, sign a contract, delete data, change employment state): confirmation **mandatory**, enforced by the orchestration layer regardless of tool-registration preference.
6. **Tool-registry/plugin model:** new tools are added by registration (target `IF-*` interface, input/output schema, risk tier, confirmation requirement) — never by modifying the chatbot's core orchestration logic.
7. **Transport is `ADR-032`'s existing direct-call convention** — no new event bus, no chatbot-specific protocol.

**Forward-looking note recorded in `ADR-053`, not decided:** the tool-registry model is framed around *action tools* (invoke another module's `IF-*` interface to read/change state). Chatbot's scope will likely also need **knowledge providers** (semantic search, RAG retrieval, memory lookup, knowledge-base search) — conceptually distinct from action tools, since they ground a response with retrieved information rather than invoke a business capability, and may not map to any single owning module's interface. This distinction is explicitly unresolved and reserved for its own future architecture decision.

### Product vision established during ratification (not itself a separate ADR clause, but load-bearing context for resumption)

- The chatbot is a **first-class platform interface** — a dedicated chat interface accessible as a full chat page and a floating assistant widget — through which users both ask questions and perform platform actions. It is explicitly **not** a narrow FAQ assistant with an occasional tool call bolted on.
- Tool invocation and business-logic ownership are different axes; the governing question for every future tool is never "can the chatbot act" but "what constraints bound this specific action," always answered by principles 2–5 above.

---

## 2. The three standing G2-freeze blockers (unresolved, unchanged by this deferral)

These remain exactly as open as before `ADR-053`. None is touched by the orchestration-layer decision.

| ID | Status | Summary |
|---|---|---|
| `OD-CHAT-005` | **PARTIALLY RESOLVED, still blocks G2.** The MUST-level worker-id-provenance precondition (the calling module must derive the worker id from its own authenticated actor, never client-supplied) is resolved and stated directly in the Interfaces table's Auth columns. **Still open:** (1) read-scope beyond the owning worker — who else (manager, auditor, Compliance) may read a conversation/outcome; (2) write-path/initiation-scope — whether a calling module may legitimately direct a conversation at a worker other than the one whose request triggered it (e.g., manager-initiated on a worker's behalf). |
| `OD-CHAT-006` | **OPEN, blocks G2.** Prompt-injection-resistance guardrail. Interim mitigation posture stated (system-prompt/input separation; any tool-calling constrained to an explicit allowlist — now satisfied in principle by `ADR-053`'s allow-list, though the row itself isn't yet updated to say so; treat all model output as untrusted) — this is a required minimum, not a resolution. Full resolution requires human/architecture confirmation. |
| `OD-CHAT-013` | **OPEN, blocks G2 regardless of any other item.** Module owner unassigned, per the repository-wide `SYNC-001` invariant (reserved human authority, Constitution §12). |

---

## 3. Every other `OD-CHAT-*` item — exact current status

### Resolved
- **`OD-CHAT-002`** — RESOLVED, `GD-19`/`ADR-053`. Tool-execution scope/orchestration architecture. See §1.
- **`OD-CHAT-023`** — RESOLVED, `GD-12`/`ADR-032` (prior session). In-process-vs-HTTP transport-convention naming gap.
- **`OD-CHAT-004`** — RESOLVED by author correction (v0.1.2), **no ADR/GD** — worker-facing routing: module-orchestration calls (`StartConversation`, `GetConversationOutcome` mode b) are in-process; the live conversation turn (`ExchangeMessage`, `GetConversationOutcome` mode a) is direct end-user access via existing `auth-middleware`. Explicitly still subject to human/architecture ratification at G2 — **treat as resolved-pending-ratification, not fully closed.**

### Partially resolved
- **`OD-CHAT-003`** (file-byte handling) — mechanism settled by `ADR-053`: if file upload ever becomes a chatbot tool, it wraps Documents' `IF-DOC-UploadDocument`, never a direct S3 write. **Open:** whether this specific tool is ever registered, and its risk-tier/confirmation classification (likely high-risk write).
- **`OD-CHAT-005`** — see §2.
- **`OD-CHAT-008`** (persistence & consent) — consent-requirement portion RESOLVED via `GD-17`/`ADR-037` (chatbot engagement requires consent; decline routes to manual onboarding, doesn't block). **Open:** transcript-persistence question.
- **`OD-CHAT-019`** (retention tier) — metadata/spend counters RESOLVED (provisional) as Tier 2, via `GD-09`/`ADR-033`. **Open:** transcript tier (contingent on `OD-CHAT-008`); tax-advisor sign-off (`OD-RETENTION-01`) tracked separately, non-blocking.

### Fully open (untouched by any decision to date)
`OD-CHAT-001` (entity shape — informed by `ADR-053`'s tool-call-log requirement, shape itself unresolved), `OD-CHAT-006` (see §2), `OD-CHAT-007` (accepted-upload-type double-attribution, narrowed but not closed), `OD-CHAT-009` (malware-scan, contingent on `OD-CHAT-003`), `OD-CHAT-010` (rate-limiting/abuse-prevention), `OD-CHAT-011` (budget-spend tracking mechanism + `JOB-CHATBOT-BudgetGuard` execution model — sync-per-turn vs. interval-poller), `OD-CHAT-012` (provider-outage vs. budget-exhaustion fallback distinction), `OD-CHAT-013` (see §2), `OD-CHAT-014` (state-domain id, proposal only), `OD-CHAT-015` (retry/backoff for provider unavailability), `OD-CHAT-016` (concurrency — simultaneous turns/conversations), `OD-CHAT-017` (inherited `FEATURE_*` flag-convention factual mismatch — likely a quick correction, not a real decision, when revisited), `OD-CHAT-018` (encryption-at-rest, contingent on `OD-CHAT-008`), `OD-CHAT-020` (indexing/capacity, partly justified now, partly contingent on `OD-CHAT-016`), `OD-CHAT-021` (cache-staleness/invalidation for the cached required-document list), `OD-CHAT-022` (timeout/backpressure policy for the synchronous Claude API call).

---

## 4. Cross-module dependencies disclosed (for whenever the module is built)

- **Onboarding → Chatbot:** in-process service call (`IF-CHATBOT-StartConversation` purpose=`onboarding-document-collection` + `IF-CHATBOT-GetConversationOutcome` mode b). Resolves against a *proposed*, not-yet-ratified `chatbot-service` contract node.
- **Compliance → Chatbot:** forward-looking (no Compliance spec exists yet) — subject-rights requests would trigger a conversation via the same `IF-CHATBOT-StartConversation` interface, parameterized `purpose=gdpr-subject-rights`.
- **Chatbot → Documents:** candidate only, contingent on `OD-CHAT-003` — if realized, wraps `IF-DOC-UploadDocument` per `ADR-053`. Mutually exclusive with Documents' own `edge-onboarding-consumes-documents` candidate for the same underlying interface — to be reconciled once `OD-CHAT-003` resolves.
- **Chatbot ← Documents (read):** `OD-CHAT-021`'s cached required-document list depends on Documents' own completeness state, with no event-bus signal available for invalidation (consistent with `ADR-032` — no generic event bus exists).
- **Chatbot ← Consent:** the consent-requirement gate is owned by Consent's `OD-CONSENT-002`, per `ADR-013`/`ADR-015`'s decision-authority assignment — resolved via `ADR-037`.
- **Infrastructure, unbuilt:** scheduled-job runtime (candidate `node-cron`/`BullMQ`, does not exist anywhere in the codebase today) required only if `OD-CHAT-011` resolves toward the interval-poller execution model; Claude API client and Redis are both candidate/unbuilt.

---

## 5. Recommendations to preserve for post-MVP resumption

- **Resume sequencing:** the three G2 blockers (`OD-CHAT-005` remainder, `OD-CHAT-006`, `OD-CHAT-013`) are the highest-leverage next decisions — nothing else in `GD-19` can reach G2 freeze without them, regardless of order among the ~16 other open items.
- **`OD-CHAT-013` is not resolvable by this workflow at all** — it requires an actual human/team owner assignment (`SYNC-001`), not a governance ADR. Flag this to whoever picks Chatbot back up: it's an organizational decision, not an architecture one.
- **`OD-CHAT-006` (prompt-injection)** should be revisited with `ADR-053`'s tool-registry model in hand — the interim mitigation posture's tool-call-allowlisting clause is now concretely satisfied by `ADR-053`'s architecture; the row itself should be updated to reflect that when this workflow resumes, before re-deciding the rest of the item.
- **`OD-CHAT-011`'s two execution models** (sync-per-turn vs. interval-poller) should be decided before or alongside implementation — this is a real architecture choice with different latency/load tradeoffs, not a formality.
- **The knowledge-providers-vs-action-tools distinction** (`ADR-053`'s forward-looking note) has no `OD-CHAT-*` row of its own yet — if Chatbot's scope has grown to include RAG/semantic-search/memory-lookup capabilities by the time this resumes, that distinction should likely become its own governance decision before those capabilities are built under the action-tool registry model, which wasn't designed for them.
- **`OD-CHAT-004`'s author-resolved routing model** is still only "resolved pending G2 ratification" — this should be explicitly ratified (or revisited) as part of reaching G2, not silently treated as settled.
- **`OD-CHAT-017`** (the `FEATURE_*` flag-convention mismatch) is very likely a quick correction, not a real decision — worth batching with any other documentation-hygiene pass rather than treating as a governance sub-decision.

---

## 6. Dependency verification (MVP isolation)

Performed 2026-07-28, before deferring:

```
grep -n "chatbot\|OD-CHAT" docs/03-modules/job-dispatch/MODULE_SPEC.md   → no matches
grep -n "chatbot\|OD-CHAT" docs/03-modules/attendance/MODULE_SPEC.md      → no matches
grep -n "chatbot\|OD-CHAT" docs/03-modules/crm/MODULE_SPEC.md             → no matches
```

`GD-20` (Job-Dispatch pivot), `GD-21` (Attendance automation), `GD-22` (Hotel-Group billing) — none of their own `GOVERNANCE_DECISIONS_REQUIRED.md` sections name any `OD-CHAT-*` item, `SPEC-CHATBOT-001`, or `backend-chatbot` in their "Merges findings," dependencies, or recommendations.

**Conclusion: `GD-19` is completely isolated from all remaining MVP governance work.** Deferring it blocks nothing in `GD-20`/`GD-21`/`GD-22`.
