# ADR-074: Chatbot Prompt-Injection Posture — Containment, Not Detection

- **Status:** **Accepted** — ratified by the commissioning human on 2026-09-08, closing `OD-CHAT-006`, the last of the three `GD-19` G2-freeze blockers.

  **Ratified on observed evidence, not on the argument alone.** Before ratification the posture was attacked against the live model: ten prompt-injection attempts in English and German — instruction override, `</system>` prompt-structure escape, claimed CTO and administrator identity, system-prompt extraction, a supplied `worker_id`, and explicit tool coercion — plus twenty-two ordinary routing cases. **All ten were contained and all twenty-two routed correctly.** The decisive measurement was not that the model refused: a worker's manifest contained **13 of 20 tools and zero manager-scoped ones**, so the tools an attacker was trying to reach were never offered to the model in the first place. The battery is preserved at `backend/scripts/chatbot-injection-check.ts`.

  **One amendment made at ratification.** The commissioning human's direction was that guardrails must be proper ones, and identified a real gap in this record as written: containment was **silent**. It guarantees an attack cannot succeed; it said nothing when one was attempted, so a sustained campaign against the assistant would have produced no signal anywhere. §5 is therefore amended to require a **monitored tripwire** (`guardrails/injection-tripwire.ts`): it logs and alerts on injection signals and **never blocks, never alters routing, and is never read by any decision**. That constraint is the point — a blocking filter is bypassable, would refuse legitimate messages ("ignore that, I meant Tuesday"), and, worst of all, becomes the control people believe in while the structural guarantees stop being audited. Detection is instrumentation here, never a defence.
  per `OD-CHAT-013` (module owner, closed 2026-09-04).
- **Date:** 2026-09-07
- **Scope:** `SPEC-CHATBOT-001`; `OD-CHAT-006`; the `backend-chatbot` executor, tool registry, L1
  router, orchestrator and templates.
- **Resolves:** `OD-CHAT-006`, the last of the three standing G2-freeze blockers.
  **Depends on:** `ADR-053` (tool-registry allow-list), `ADR-073` (the assistant acts only within
  the user's own scope), `ADR-031` D-2/D-4 (request-time revocation).
  **Constrains:** `OD-CHAT-008` (transcript persistence) — see §5.
- **Change class:** Security decision. It states what the platform does and does not defend
  against, and authorizes G2 freeze on that basis.

---

## 1. Context

`OD-CHAT-006` has stood open since `SPEC-CHATBOT-001` was written, carrying an interim posture
rather than a resolution: system-prompt/input separation, tool-calling constrained to an
allow-list, and "treat all model output as untrusted". That was the right holding position while
the chatbot could only read the caller's own records — a successful injection could then reveal
nothing the user could not already see.

`ADR-073` changed the stakes. The assistant may now write, including to another person's schedule.
A successful injection moves from *reads data the user could already read* to *performs an action
the user could already perform*. That is a materially different risk and it is why this decision
can no longer be deferred behind "interim posture stated".

It is also now answerable in a way it was not before, because the controls exist in code rather
than in intent.

## 2. Decision

**Prompt injection is treated as unpreventable and is contained rather than detected.**

No classifier, heuristic, or instruction is relied upon to decide whether a message is hostile.
The platform instead guarantees that a **fully compromised model cannot exceed the authority of
the person it is acting for**, and that any irreversible action taken on their behalf is one they
explicitly approved after seeing exactly what it would do.

Concretely, the following are ratified as required controls. Each exists today; none may be
removed without superseding this record.

| # | Control | Where |
|---|---|---|
| 1 | **The model never produces an authorization input.** Identity, role, scope and permission are re-derived from `req.auth` at execution time. `userId`, `role`, `scope`, `hotelId`, `workerId`, `internalBypass` and their variants are forbidden argument keys, enforced at compile time, at registration, and by a static test over the registry. | `tools/registry.ts`, `tools/executor.ts` |
| 2 | **Tools are allow-listed.** An unregistered name is refused before anything else happens. | `ADR-053` item 4; `executor.ts` step 0 |
| 3 | **The model is shown only tools its actor could already use.** An injection can only name a tool that was in the prompt. | `orchestrator/router-l1.ts` |
| 4 | **Arguments are validated against the tool's own strict schema.** Unexpected keys are rejected, not ignored. No layer "repairs" model output before validation. | `executor.ts` step 1 |
| 5 | **The five-step gate runs on every execution**, including the owning service's own authorization. Steps are redundant on purpose. | `executor.ts` |
| 6 | **High-risk writes require confirmation bound to exact arguments.** The summary shown is rendered deterministically from the same parsed arguments the confirmation token hashes; changing one argument voids the token. | `ADR-053` item 5; `guardrails/confirm-token.ts` |
| 7 | **Tool results are rendered deterministically and never returned to a model.** There is no second model call to phrase a reply. | `orchestrator/templates.ts` |
| 8 | **No conversation history is replayed.** `buildMessages()` sends the current user turn only. | `router-l1.ts` |
| 9 | **Special-category values are redacted to presence booleans** before rendering. | `guardrails/redaction.ts` |
| 10 | **Denials are generic.** The reason is logged, never shown, so refusals cannot be used to map the authorization model. | `orchestrator.ts` |
| 11 | **Spend and turns are bounded**, so a manipulated loop terminates. | `guardrails/budget.ts` |

## 3. Why containment rather than detection

- **Detection cannot be verified.** A prompt-injection classifier has no ground truth to test
  against, degrades silently as phrasing shifts, and produces a false sense of safety precisely
  where confidence is least warranted. Containment can be tested: every control in §2 has tests
  asserting the negative case.
- **The worst case is already bounded and describable.** If the model is wholly controlled by an
  attacker, it can attempt any action the *signed-in user* could attempt. It cannot escalate,
  cannot cross into another hotel, cannot become an admin, and cannot complete an irreversible
  write without that user pressing Confirm on a summary of the exact call.
- **The most valuable property emerged from an unrelated decision.** Because transcripts are not
  persisted (`OD-CHAT-008` open) and results are rendered without a model, **tool output never
  reaches a model at all**. Second-order injection — hostile text stored in a notification, an
  absence reason or a room note, later read back and obeyed — is therefore *structurally
  impossible today*, not merely unlikely. §5 records what that costs to keep.

## 4. What this does NOT claim

- **It does not claim injection is prevented.** It will happen; the design assumes it.
- **It does not protect a user from themselves.** A user who injects their own session can make
  the assistant attempt what they could already do by hand. No boundary is crossed, so this is not
  treated as a vulnerability.
- **It does not make a wrong-but-plausible write impossible.** A manipulated model can propose a
  well-formed action the user did not intend. The confirmation summary is the control, and it is
  deterministic precisely so a person can catch this — but a person who confirms without reading
  has approved it. That is a real residual risk and it is accepted, mitigated by listing arguments
  rather than paraphrasing them.
- **It does not address availability.** Abuse-driven spend is bounded by the budget caps, but
  rate-limiting remains `OD-CHAT-010`, still open.

## 5. Consequence: this constrains OD-CHAT-008

Control 7 and control 8 together are what make second-order injection structurally impossible.
**Persisting transcripts and replaying them, or introducing a second model call to phrase results,
would remove that property** and turn stored user-authored text into a live injection channel.

`OD-CHAT-008` must therefore not be decided in isolation. If conversation history is ever
replayed, this record requires that a compensating control be decided in the same change — at
minimum, that tool output re-entering a prompt is fenced as untrusted data with its own boundary,
and that the decision names what replaces control 8.

### 5.1 That decision was made on 2026-09-08. The compensating control is role separation.

`OD-CHAT-008` and `OD-CHAT-018` are **resolved**: transcripts are stored, encrypted at rest
(AES-256-GCM), and retained 30 days. History **is** replayed, so this section's requirement is
now live, and the control that replaces control 8 is:

> **Only the user's own messages are replayed. Assistant messages are stored and never fed back.**

The reasoning, stated so a future reader can check it rather than trust it:

- Replaying the **user's own** words grants no new authority. They could retype any of it in the
  next message. Nothing becomes reachable through history that was not already reachable directly,
  so the authority boundary is unchanged.
- Replaying **assistant** messages would. Those contain tool OUTPUT, and tool output carries text
  authored by other people — a colleague's name from a roster, a notification somebody else wrote.
  That is third-party content entering a prompt, which is exactly what control 8 prevents.

So the property control 8 actually guarantees — *no text authored elsewhere reaches the model* —
survives intact. What is given up is only the weaker "the user's own earlier text cannot reach the
model", which was never the security-relevant half.

**Enforced structurally, not by convention.** `replayableHistory` filters on `role: 'USER'` in the
WHERE clause rather than after the query, because a post-filter is one refactor from being dropped
and the failure would be silent. `buildMessages` takes `string[]`, not `LlmMessage[]`, so a caller
cannot pass an assistant turn even by mistake — the role is applied inside. Both have negative-case
tests in `chatbot-memory.test.ts`, per §6.1.

Alternatives rejected: fencing replayed assistant text as "data, not instructions" with a
delimiter — that is a prompt-level defence, and this record's entire position is that prompt-level
defences are not the boundary.

## 6. Verification

This record is satisfied when, and only while:

1. Every control in §2 has a test asserting its **negative** case — that the thing it prevents is
   actually prevented, not merely that the happy path works.
2. The registry hygiene test continues to fail the build on a write tool with no real permission
   token, and on any forbidden argument key.
3. No code path returns tool output to a model. Still true by construction, and asserted.

4. **Amended 2026-09-08.** Conversation history IS replayed, under §5.1's control. This condition
   is therefore restated: no code path replays an ASSISTANT message into a prompt, and the
   restriction is enforced by the query's own WHERE clause and by `buildMessages`' signature rather
   than by reviewer memory. `chatbot-memory.test.ts` asserts the negative case.

5. Transcripts are never written unencrypted. A missing key disables memory entirely rather than
   degrading to plaintext — there is no configuration in which storing them in the clear is the
   intended behaviour.

## 7. Alternatives considered

- **Ship a prompt-injection classifier.** Rejected: unverifiable, degrades silently, and would
  invite treating the containment controls as belt-and-braces rather than the actual boundary.
- **Keep the assistant read-only indefinitely.** Rejected by `ADR-073`, which the owner ratified
  after the risks were put to them. Also weaker than it appears: read-only still exposes whatever
  the user can read.
- **Require confirmation for every action, including reads.** Rejected: confirming trivia trains
  people to click through confirmations without reading, which destroys the value of the
  confirmation on a write that matters.

## 8. What remains open after this

`OD-CHAT-006` closes with this record. `OD-CHAT-010` (rate-limiting), `OD-CHAT-008` (transcript
persistence, now constrained by §5), `OD-CHAT-016` (concurrency) and the remaining `OD-CHAT-*`
items are unaffected. With `OD-CHAT-005` (ADR-073) and `OD-CHAT-013` already closed, ratifying
this clears the last G2-freeze blocker for `SPEC-CHATBOT-001`.

**Ratifying this does not enable the feature.** `FEATURE_CHATBOT` stays off until each registered
tool has its own approval under `ADR-053` item 4 — eleven tools currently carry
`approvalRef: PENDING`.
