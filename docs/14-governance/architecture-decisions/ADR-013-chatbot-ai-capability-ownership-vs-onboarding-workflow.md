# ADR-013: Chatbot / AI-Capability Ownership vs. Onboarding Workflow Ownership

- **Status:** Accepted — ratified by the commissioning human decision recorded in this record (2026-07-12).
- **Date:** 2026-07-12
- **Scope:** Module/ownership boundaries — the Chatbot / AI-execution capability (`backend-chatbot`, target `SPEC-CHATBOT-001`) vs. the Onboarding business workflow (`docs/03-modules/onboarding/MODULE_SPEC.md`).
- **Supersedes:** none (additive; closes the open ownership ambiguity previously tracked as `SIR-GLOB-015` / `SYNC-027`, a Boundary Collision Gate (G1.5) stop that blocked authoring `SPEC-CHATBOT-001`).
- **Change class:** Material architecture/ownership decision requiring a Decision Record per Constitution §6/§7. This record settles the boundary only; the consequential edit to `docs/03-modules/onboarding/MODULE_SPEC.md` and the authoring of `docs/03-modules/chatbot/MODULE_SPEC.md` are separate Documentation Workflow actions performed under its authority, not part of this ADR itself.

## Problem

`docs/03-modules/onboarding/MODULE_SPEC.md` independently claims first-person execution ownership of the Chatbot capability — the same AI-agent document-collection conversation (CRR §8) that the repository separately registers as its own module id `backend-chatbot` (`MODULE_REGISTRY.yaml:202-212`, currently a placeholder-unregistered stub; `PIVOT_DESIGN_DOCUMENT.md` §2.2 line 44 lists "chatbot (placeholder)" as its own current module, parallel to "geo (placeholder)"):

1. §3 Scope (line 45) and §5 Responsibilities item 3 (line 86, "**Chatbot execution:** running an AI-guided conversation with cost controls, caching, token limits, and graceful fallback") claim the agent's execution as an Onboarding responsibility.
2. §6.3 (lines 142-160), "Document Collection Chatbot," is a full agent specification — provider (Claude API), model (Claude Haiku), conversation-loop behavior, and mandatory cost controls (token budget, per-conversation limit, caching, fallback) — content that belongs to the capability executing the agent, not to a business-workflow consumer of it.
3. §18 Dependencies (line 498) lists **"Claude API"** itself — not `backend-chatbot` — as one of Onboarding's own direct module dependencies, modeling Onboarding as integrating directly with the external LLM provider rather than consuming an intermediary module.

`docs/03-modules/documents/MODULE_SPEC.md` independently assumes the opposite reading, calling `backend-chatbot` "a distinct capability... Documents is the storage/retrieval target the chatbot's document-collection flow writes to and reads from, not the chatbot itself" — sharpening, not resolving, the conflict.

This was tracked as `SIR-GLOB-015` (`OPEN — BLOCKED`) and reconfirmed by a Boundary Collision Gate (G1.5) run for a proposed `SPEC-CHATBOT-001` that was blocked from authoring rather than adding a second competing claim (`SYNC-027`), independently re-verified by a fresh architecture-reviewer pass (`COLLISION-CONFIRMED`). This is the same collision shape as the earlier Contracts case (`SYNC-023` → `ADR-012`).

## Decision

1. **`backend-chatbot` is the canonical owner of all AI-execution capabilities**, specified by `SPEC-CHATBOT-001`. This includes, without limitation: conversation lifecycle; LLM provider abstraction (model selection, API integration); prompt construction and management; orchestration of multi-step/tool-using agent behavior; context assembly (what is fed to the model); tool execution (function/tool calls the agent makes); conversation memory and state; AI session management; token/cost management (budgets, caps, per-conversation limits, caching); guardrails (input/output validation, injection defense, abuse prevention); and AI audit (conversation-level logging for compliance/dispute resolution).
2. **`backend-onboarding` (specified by `docs/03-modules/onboarding/MODULE_SPEC.md`) owns the onboarding business workflow**: the onboarding workflow itself, onboarding state and its transitions, onboarding steps (Personalfragebogen, document collection orchestration, contract signing coordination, pool/claim, hire approval), onboarding-specific validation, onboarding completion signaling, and onboarding's own business rules. Onboarding does **not** own AI execution.
3. **Onboarding consumes Chatbot through contracts and interfaces, not first-person execution.** Onboarding's claimed execution ownership of the chatbot agent (§3 line 45, §5 item 3 line 86, §6.3, §18 line 498) is superseded by this decision: Onboarding triggers a chatbot conversation (supplying the required-document context) and reacts to its outcome (documents complete / fallback triggered), through `backend-chatbot`'s interface contracts (`IF-CHATBOT-*`, defined in `SPEC-CHATBOT-001`); it does not implement, configure, or own the agent's provider, model, prompts, cost controls, or conversation state. The same applies to the chatbot's secondary use for GDPR subject-rights requests (owned by Compliance, executed by `backend-chatbot`).
4. `docs/03-modules/onboarding/MODULE_SPEC.md` is corrected (a separate, minimal Documentation Workflow edit under this ADR's authority) to remove the superseded execution-ownership claims and reframe them as consumption of `backend-chatbot` via interface contracts, preserving every onboarding-workflow-owned responsibility unchanged.
5. This is an ownership/boundary decision only. It does not itself resolve any other open decision in either module's specification, `SPEC-CHATBOT-001`'s own G2 freeze (not yet authored), owner *assignment* for either module (`SYNC-001`/`SIR-GLOB-001`), or the pre-existing registry gap that no `backend-onboarding` module id yet exists in `MODULE_REGISTRY.yaml` (`SIR-GLOB-005`).

## Alternatives Considered

- **Fold Chatbot execution into Onboarding** (ratify Onboarding's existing first-person claim; retire `backend-chatbot` as a module id) — this was the reading `docs/03-modules/onboarding/MODULE_SPEC.md`'s own text already assumed, and `PIVOT_DESIGN_DOCUMENT.md` §7.1's combined "Onboarding + Chatbot" component heading loosely supports it. **Rejected by the commissioning human decision recorded in this record.** The chatbot's secondary use for GDPR subject-rights requests (owned by Compliance, per CRR §8/§26) already needs the agent's execution surface independent of Onboarding; a single `backend-chatbot` owner generalizes cleanly to that second consumer (and any future one) without duplicating agent-execution logic inside Onboarding. The repository also already carries `backend-chatbot` as a distinct, separately-registered module id with its own placeholder directory, parallel to `backend-geo` — collapsing it into Onboarding would be a larger structural change than settling the existing boundary.
- **Leave the ambiguity open** — rejected: `SIR-GLOB-015` was already blocking `SPEC-CHATBOT-001`'s authoring, and leaving it open indefinitely blocks the confirmed CRR §8 chatbot capability from ever being specified; the product owner has now made the call.

## Compatibility

Strictly additive to the knowledge/governance layer plus one corrective edit to `docs/03-modules/onboarding/MODULE_SPEC.md` (performed separately under this ADR's authority). No `state-*` domain changes owner. No API mount moves (`backend-chatbot`'s placeholder mount point, if/when implemented, is unaffected). `backend-chatbot`'s `MODULE_REGISTRY.yaml`/`DEPENDENCY_GRAPH.yaml`/`API_INDEX.yaml`/`BOUNDARY_INDEX.yaml` entries are synchronized separately as an exit condition of `SPEC-CHATBOT-001`'s own Documentation Workflow, not by this record.

## Reversibility

Reversing this decision would require a new ADR that supersedes it, plus a specification rewrite folding `SPEC-CHATBOT-001`'s AI-execution surface back into `docs/03-modules/onboarding/MODULE_SPEC.md` and retiring `backend-chatbot` as a module id. No data is uniquely stored by this record.

## Consequences

- **Positive:** Future preflight, boundary-collision (G1.5), and consistency passes reach the Chatbot→`backend-chatbot` conclusion immediately from the governance layer instead of rediscovering the ambiguity. `SIR-GLOB-015` closes. `SPEC-CHATBOT-001` may now be authored. The chatbot's GDPR subject-rights reuse (Compliance-owned workflow, `backend-chatbot`-executed) has a clean, single execution owner instead of an implicit second consumer of Onboarding-owned logic.
- **Negative / cost:** `docs/03-modules/onboarding/MODULE_SPEC.md` requires a corrective edit (performed separately) to its Scope, Responsibilities, §6.3, Dependencies, and Cross-Module References sections; downstream readers of the pre-correction text must rely on this ADR to interpret the historical execution-ownership phrasing as superseded.

## Human Decision Required

None outstanding for the ownership question itself — this record *is* that decision. Owner *assignment* (a named accountable person/team for `backend-chatbot`/`backend-onboarding`) remains blocked on `SYNC-001`/`SIR-GLOB-001`, unchanged by this ADR. `SPEC-CHATBOT-001`'s G2 freeze (once authored) and `docs/03-modules/onboarding/MODULE_SPEC.md`'s own outstanding open questions are unaffected by this record.
