# ADR-073: The Chatbot Acts Only Within the User's Own Authorization Scope

- **Status:** Proposed — awaiting ratification by the commissioning human. Drafted from their
  instruction on 2026-09-04: *"the user should be able to do anything with the chatbot that he can
  do manually, but strictly inside of a scope. If a manager can do anything on his system, he
  should be able to do it with our AI, but inside of his scope only. And same goes for every user
  in our system."*
- **Date:** 2026-09-04
- **Scope:** `SPEC-CHATBOT-001`; `OD-CHAT-005`; the `backend-chatbot` tool registry, executor and
  L1 router; every future tool registration.
- **Resolves:** `OD-CHAT-005` (both open halves — see §2). **Amends:** nothing. **Depends on:**
  `ADR-053` (tool-registry architecture), `ADR-031` D-2/D-4 (request-time revocation).
- **Change class:** Governance decision. It settles an authorization question that has blocked G2
  freeze, and it authorizes a class of work (write tools) that is currently forbidden.

---

## 1. Context

`OD-CHAT-005` has blocked `SPEC-CHATBOT-001` at G2 since the specification was written. Its
MUST-level precondition — that a worker id is derived from the calling module's own authenticated
actor and never from client input — was resolved long ago and is enforced three ways
(`SafeArgs` at compile time, `assertNoForbiddenArgs` at registration, a static test over the whole
registry in CI). Two halves remained open:

1. **Read scope beyond the owning worker.** Who other than the subject may read a conversation or
   its outcome — a manager, an auditor, Compliance?
2. **Write path and initiation scope.** May a conversation legitimately be directed at a worker
   other than the one whose request triggered it — a manager acting on a worker's behalf?

Both were left open because they could not be derived from the repository. They are product
questions about who may act on whom, and only the commissioning human could answer them.

Because they were open, `backend-chatbot` registers exactly one tool
(`assignments.list_mine` — READ_ONLY, self-scoped) and a hygiene test mechanically fails the build
if a write tool or a tool touching another person's record is added. That was the correct posture
while the question was open. It is also why the assistant can currently answer questions and do
nothing else.

## 2. Decision

**The assistant's authority is the user's own authority. Never more, and never less.**

Anything a user can do by hand in the application, they may do by asking the assistant. Anything
they cannot do by hand, the assistant cannot do for them, cannot describe as available, and cannot
be talked into attempting.

This resolves both open halves of `OD-CHAT-005` with a single rule:

- **Read scope (half 1):** whatever that role can already read in the UI. A Manager who can open a
  worker's profile at their own hotel may ask the assistant about that worker. A Worker who can
  only see their own record may only ask about their own record. No new read authority is created,
  and none is removed.
- **Initiation and write scope (half 2):** a Manager may direct the assistant at a worker **inside
  their own scope**, precisely because they can already act on that worker by hand — assigning a
  shift, recording an absence. This is not a new capability; it is the existing capability reached
  through a different surface.

### 2.1 What this deliberately does NOT decide

- **It does not approve any specific tool.** `ADR-053` item 4 stands: the registry architecture is
  approved, each tool is its own approval. This record authorizes the *class* of write tools, not
  any member of it.
- **It does not weaken the executor.** Every one of the five gate steps still runs on every call.
- **It does not settle transcript persistence** (`OD-CHAT-008`), encryption at rest
  (`OD-CHAT-018`) or the retention tier for transcripts (`OD-CHAT-019`). Those remain open and are
  untouched by this record.
- **It does not resolve `OD-CHAT-006`** (prompt-injection). See §4 — this decision *raises* the
  stakes of that item rather than closing it.
- **It does not resolve `OD-CHAT-013`** (module owner). That is an organizational assignment no
  ADR can make.

## 3. How the rule is enforced

The rule is deliberately **not** implemented as new authorization code. Writing a second
authorization system for the chatbot is exactly how the chatbot's rules and the application's
rules drift apart, and the drift would be silent — a tool would keep working after the UI
tightened, or start denying after the UI relaxed.

Instead, every tool reaches its capability through the owning module's own interface, under that
module's own enforcement (`ADR-053` items 2 and 3). The chatbot adds no authority; it borrows the
caller's.

Enforcement therefore lives in three existing layers:

| Layer | What it does | Why it is not redundant |
|---|---|---|
| **Visibility** (`router-l1.ts`) | The model is shown only tools whose permission tokens the actor holds. | Bounds what an injected or confused model can even name. Not a control — see below. |
| **Executor gate** (`executor.ts`) | Re-derives identity, role, scope and permission at execution time from `req.auth`. | The actual control. Refuses anything visibility wrongly admitted. |
| **Owning service** | Runs its own authorization again inside `invoke()`. | `assignments/service.ts` `list()` once shipped with no scope check while its siblings had one. Layer 3 exists because layer 2 trusted a service that was wrong. |

**Visibility is not authorization.** It is stated here so a future reader does not mistake it for
the control and then "optimize" the executor away.

## 4. Consequences

**The prompt-injection question gets sharper, not softer.** With read-only tools, a successful
injection leaks nothing the user could not already see — the executor confines it to their own
scope. With write tools, the same confinement holds, but the blast radius inside that scope
changes: a manipulated turn could create or cancel assignments the user *could* have made
themselves. `OD-CHAT-006` remains open and its interim posture is now load-bearing rather than
precautionary. Two mitigations are already in place and must not be weakened: tool data is
rendered deterministically and never re-enters a prompt, and the system prompt instructs that tool
output is information, never instruction.

**Confirmation becomes mandatory in practice, not just on paper.** `ADR-053` item 5 already
requires confirmation for high-risk writes; no such tool existed, so
`CHATBOT_CONFIRM_TOKEN_SECRET` has been configured but unused. Implementing the class this record
authorizes means implementing that flow. The owner chose (2026-09-04) a **summary plus explicit
Confirm/Cancel**: the assistant states exactly what it is about to do — "create 47 assignments
across 3 hotels, 2 absences" — and nothing is written until the user confirms.

**A denial must not become an oracle.** Because the assistant now spans capabilities the user may
or may not hold, refusals are more frequent and more informative. The L1 router returns a generic
denial and logs the real reason server-side; a refusal that named the missing permission would let
a user map the authorization model by asking.

**Scope is re-derived per request, never cached into the conversation.** A conversation may
outlive a scope change — a manager reassigned, a worker archived, a role changed. `ADR-031` D-3
already re-reads identity on every request and D-2/D-4 revoke via `token_generation`. A tool must
never read scope from `session_state`, which would let a conversation opened before a demotion
keep acting on the old scope.

**Least-privilege stays a per-tool obligation.** "Everything the user can do" describes the
*ceiling*, not a target to build toward. Each tool still declares the narrowest permission and
scope that lets it work, and `ADR-053` item 4 still requires its own approval.

## 5. Alternatives considered

- **Keep the assistant read-only.** Safest, and it is the current posture. Rejected: it makes the
  product a lookup tool, and the owner's requirement is explicitly that the assistant perform the
  work. The risk it avoids is largely handled by the executor, which already confines every call
  to the caller's own authority.
- **Give the chatbot its own elevated service identity, with its own rules.** Rejected outright.
  It contradicts `ADR-053` item 3, it creates a second authorization system guaranteed to drift
  from the first, and it means a prompt injection escapes the user's scope instead of being
  confined to it. The single most valuable property of the current design is that the worst
  outcome of a compromised model is bounded by what the user could already do.
- **Allow writes but only for the user's own record (self-scope only).** Rejected: it forbids the
  owner's motivating example — a manager planning a week for their team — while adding no safety,
  since a manager acting on their own team is exactly what they do by hand all day.

## 6. Verification

This record is satisfied when, for every registered tool:

1. Its permission and scope declarations match the gate the wrapped route actually enforces —
   checked against the real `ROLE_PERMISSIONS`, not fixtures. A permission assertion written
   against invented permissions proves nothing: `assignments.list_mine` once required a token the
   `WORKER` role does not hold, and 100+ tests passed because each fabricated it.
2. No tool declares a forbidden argument key. Enforced at compile time, at registration, and by a
   static test.
3. Every `HIGH_RISK_WRITE` tool has `confirm: true`, forced at registration.
4. An authorization matrix test exists per tool, asserting each role reaches exactly what it could
   reach by hand — including the negative cases.

## 7. Open items this record does not close

`OD-CHAT-006` (prompt injection), `OD-CHAT-008` (transcript persistence), `OD-CHAT-013` (module
owner), `OD-CHAT-018` (encryption at rest), `OD-CHAT-019` (transcript retention tier). G2 freeze
still requires `OD-CHAT-006` and `OD-CHAT-013`; this record removes `OD-CHAT-005` from that list
and nothing else.
