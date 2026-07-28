# ADR-053: Chatbot as AI Orchestration Layer — Tool-Registry Architecture with Risk-Tiered Confirmation

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-CHAT-002`, the first sub-decision of `GD-19` (Chatbot module scope & LLM safety). Authored by the Lead Architect from `SPEC-CHATBOT-001`'s own `OD-CHAT-002` entry, substantially reformulated twice during ratification at the commissioning human's explicit direction — first to distinguish tool invocation from business-logic ownership, then to establish the chatbot as a first-class platform interface (a dedicated chat interface accessible as a full chat page and floating assistant widget) rather than a narrow FAQ assistant — before final approval of a risk-tiered confirmation policy.
- **Date:** 2026-07-28
- **Scope:** `SPEC-CHATBOT-001`. Resolves `OD-CHAT-002` (tool-execution scope) and establishes the architectural frame `OD-CHAT-001` (entity shape), `OD-CHAT-003` (file-handling), and every future tool-integration decision must fit. Does not itself approve any specific tool.
- **Supersedes:** none (additive — `backend-chatbot` has zero code; this decision scopes a module not yet built).
- **Change class:** Platform architecture decision per Constitution §6/§7 — comparable in weight to `ADR-032` (inter-module transport convention), since it establishes a durable architectural pattern rather than resolving a single open item.

## Problem

`OD-CHAT-002` originally asked a binary question: does the chatbot execute tools at all, or is it conversational-only? The commissioning human's product vision rejected that framing on two rounds of correction. First: the chatbot is intended to invoke existing platform capabilities, but must never own business logic or bypass module boundaries — the real question is *what constrains* tool invocation, not whether it exists. Second, more fundamentally: the chatbot is intended to be a first-class interface to the platform — a dedicated chat interface accessible as a full chat page and floating assistant widget — through which users both ask questions and perform platform actions, not a narrow FAQ bot with an occasional tool call bolted on.

Without a settled architecture, every future tool integration (a chatbot-accessible schedule lookup, a leave-request submission, a compliance export trigger) would each independently re-litigate the same boundary questions: does the chatbot own the resulting state change? Does it bypass the owning module's authorization? Does adding a new tool require touching the chatbot's own core logic? This ADR settles those questions once, as an architecture, rather than per-tool.

## Decision

1. **The chatbot is an AI orchestration layer, not a business module.** It owns conversation, intent recognition, clarification, tool selection, and response generation. It owns no business state beyond what is needed to run a conversation itself (message history, the conversation's own tool-call log) — no domain state belonging to any other module.

2. **Every executable platform capability exposed through the chatbot is implemented as a tool that invokes an existing `IF-*` interface owned by another module.** The chatbot never gains a bespoke backend capability created solely for its own benefit — a tool is a conversational wrapper around a capability the owning module already exposes (or builds for its own reasons, then exposes as a tool).

3. **Ownership split is absolute and non-negotiable per tool:** the owning module retains business rules, validation, authorization, state changes, persistence, and auditing. The chatbot never accesses a database or another module's internals directly — every read and write is mediated by the owning module's own interface, under that module's own enforcement, including its own RBAC (the calling worker's own permissions, never a chatbot-elevated identity).

4. **Tool invocation is allow-listed, not open-ended.** This ADR approves the *architecture* for adding tools one at a time — it does not itself approve any specific tool. Each tool integration is its own explicit future approval, mapping to one specific existing `IF-*` interface.

5. **Tools are classified into three risk tiers at registration time, each with its own confirmation policy:**
   - **Read-only** (e.g., get schedule, document status, attendance history): executes immediately, no confirmation required.
   - **Low-risk write** (e.g., mark a notification read, update preferred language): confirmation is *optional*, decided per-tool at registration based on that tool's own risk profile — not centrally mandated either way.
   - **High-risk or irreversible write** (e.g., submit a leave request, generate a compliance export, cancel an assignment, sign a contract, delete data, change employment state): confirmation is **mandatory** — the chatbot orchestration layer must obtain explicit user confirmation before invoking the tool, regardless of what the tool registration might otherwise prefer.
   
   The confirmation gate is enforced by the chatbot orchestration layer itself, as a UX/safety layer distinct from — and in addition to — the owning module's own authorization and business-rule validation, which always runs regardless of whether confirmation was obtained.

6. **New tools are added via a tool-registry/plugin model, never by modifying the chatbot's core orchestration logic.** A tool registration declares: the target `IF-*` interface, input/output schema, risk tier (read-only / low-risk write / high-risk write), and confirmation requirement (fixed for high-risk; declared at registration for low-risk write). Adding a tool is authoring a new registration, not editing conversation/intent/orchestration code.

7. **Transport for every tool call is `ADR-032`'s existing direct-call convention.** No new event bus, no chatbot-specific protocol; a tool call is an in-process synchronous call to the owning module's interface, exactly as any other cross-module synchronous call in this platform is made.

## Rationale

- **Separating "does the chatbot act" from "how is acting bounded" resolves the real product tension.** The commissioning human's product vision (a first-class, action-capable chat interface) and the architectural concern (no shadow business-logic owner) are not in conflict once tool invocation is treated as calling, not owning — this is the same pattern the platform already uses for every other cross-module interaction (`ADR-032`, `ADR-034`).
- **Risk-tiered confirmation, rather than a blanket policy, matches consequence to friction.** A blanket "always confirm" (rejected as the more conservative option) would add unnecessary friction to safe, common actions (checking a schedule); a blanket "never confirm unless centrally listed" would risk a genuinely irreversible action (contract signing, data deletion) executing without an explicit user checkpoint. Per-tool risk classification, decided at registration, lets each tool's own real consequence drive its own policy, with high-risk/irreversible actions given a non-negotiable floor.
- **The tool-registry/plugin model is what makes "approve each tool individually" (point 4) actually scale.** Without it, every new tool would risk touching shared orchestration code, re-introducing exactly the kind of coupling this decision exists to prevent. A registration-based model keeps the orchestration layer's own code stable as the tool catalog grows.
- **No new authorization model is introduced.** Every tool call rides the calling worker's own existing RBAC and the owning module's own enforcement — this avoids inventing a second, chatbot-specific permission system that would need its own governance and could drift from the platform's actual authorization model over time.

## Consequences

- `SPEC-CHATBOT-001`'s `OD-CHAT-002` is resolved: the orchestration-layer/tool-registry architecture above is ratified. No specific tool is approved by this record — each future tool integration is its own scoped decision (product or governance, as appropriate) that must conform to this architecture.
- `OD-CHAT-001` (entity shape) and `OD-CHAT-003` (file-byte handling) are directly informed by this decision but not resolved by it: `OD-CHAT-001`'s `ChatbotConversation` entity must now account for a tool-call log alongside message history; `OD-CHAT-003`'s file-handling question resolves the same way as any other tool — if file upload becomes a chatbot tool, it is a wrapper around Documents' own `IF-DOC-UploadDocument`, never a direct Chatbot-to-S3 write, consistent with `documents/MODULE_SPEC.md`'s existing ownership boundary. Both remain open as their own rows, now scoped by this architecture rather than by an undecided tool-execution question.
- `OD-CHAT-010` (rate-limiting), `OD-CHAT-011` (budget-tracking mechanism), and `OD-CHAT-016` (concurrency) all gain a clearer shape under this architecture (tool calls are additional cost/risk events layered on conversational turns) but remain separately open — this ADR does not resolve them.
- No code changes are made or authorized by this record — `backend-chatbot` remains zero-code; this settles the target architecture for whenever the module and its first tools are built.

## Compatibility

No runtime behavior changes — no code exists for this capability today. No migration, no rollback concern.

## Scope note

This settles the chatbot's tool-invocation architecture and confirmation-policy framework only. It does not approve any specific tool, does not resolve `OD-CHAT-001`/`OD-CHAT-003`/`OD-CHAT-010`/`OD-CHAT-011`/`OD-CHAT-016` (each remains its own open item, now scoped by this architecture), and does not resolve any other `GD-19` sub-decision, including the three standing G2-freeze blockers (`OD-CHAT-005`, `OD-CHAT-006`, `OD-CHAT-013`).

**Forward-looking note, not decided here:** this ADR's tool-registry model is framed around action tools — capabilities that invoke another module's `IF-*` interface to read or change state. As the chatbot's scope grows, it will likely also need **knowledge providers** (semantic search, RAG retrieval, memory lookup, knowledge-base search) that are conceptually distinct from action tools: they retrieve information to ground a response rather than invoke a business capability, and may not map to any single owning module's interface at all. This distinction is not resolved by this decision and would warrant its own architecture treatment if and when the chatbot's scope reaches that point — noted here only so a future decision has this ADR's own framing to react to, not to pre-empt it.
