# ADR-037: Consent Module — Chatbot Consent Gate, Fail-Closed Unavailability, and Five Lifecycle Resolutions

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-17` (Consent module — lifecycle & fail-safety). Authored by the Lead Architect from `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-17 entry and the commissioning human's explicit approval of Option (b) for the chatbot-gate question, plus the accompanying fail-closed and five-item resolution set.
- **Date:** 2026-07-28
- **Scope:** `SPEC-CONSENT-001` (v0.1.1, REVIEW). Resolves `OD-CONSENT-001`, `OD-CONSENT-002`, `OD-CONSENT-004`, `OD-CONSENT-006`, `OD-CONSENT-007`, `OD-CONSENT-009`, `OD-CONSENT-011`. Directly informs `docs/03-modules/onboarding/MODULE_SPEC.md` (which defers `OPQ-3` entirely to this decision, per `ADR-015`) and `docs/03-modules/chatbot/MODULE_SPEC.md` (`OD-CHAT-008`, which is silent on the fail-mode question and also defers).
- **Supersedes:** none (additive). Exercises the decision authority `ADR-015` already assigned to this module for the chatbot-consent question.
- **Change class:** Product/architecture decision per Constitution §6/§7. Unlike `ADR-032`–`ADR-036`, this decision has genuine user-visible flow consequences (whether/how a consent decline affects onboarding) and is not a zero-code ratification of an already-shipped pattern.

## Problem

`SPEC-CONSENT-001` carries two genuinely unresolved, consequential open decisions plus five smaller lifecycle/architecture gaps, all blocking the module's own build:

1. **`OD-CONSENT-002`:** whether chatbot engagement requires explicit data-processing consent, and whether a decline blocks onboarding entirely. This question originated in Onboarding's own spec (as `OPQ-3`) and was explicitly assigned to Consent's own decision authority by `ADR-015` — Onboarding's spec states plainly that it "owns no consent gate, logic, or state of its own" and defers completely.
2. **`OD-CONSENT-006`:** fail-open vs. fail-closed behavior when `backend-consent` is unavailable to a caller's `IF-CONSENT-CheckStatus`/`IF-CONSENT-RequestConsent` call. Flagged High-impact because the two failure modes are opposite in kind: fail-open silently bypasses a GDPR gate platform-wide; fail-closed blocks all logins/work-starts on this module's downtime.
3. Five smaller items (`OD-CONSENT-001`, `004`, `007`, `009`, `011`) — persisted-vs-computed lifecycle state, stale-notice-version handling, language fallback, and audit-access RBAC scope — none of which change user-visible behavior the way (1)/(2) do.

## Decision

1. **`OD-CONSENT-002` — resolved per Option (b):** chatbot engagement requires explicit data-processing consent. A decline does **not** block onboarding outright — it routes the worker to a manual/non-chatbot onboarding path instead. Blocking onboarding entirely over a chatbot-specific consent decline would conflate "won't use the chatbot" with "can't be onboarded," a harsher user-facing consequence than the underlying data-processing question warrants. `IF-CONSENT-RequestConsent`'s contract for this specific instance (chatbot purpose) may now be built against this concrete resolution.

2. **`OD-CONSENT-006` — resolved as fail-closed:** when `backend-consent` is unavailable to a consuming module's status-check or request call, the dependent flow blocks rather than silently proceeding. This is the safer default for a GDPR-integrity surface — a temporary block during Consent's own downtime is a better failure mode than a silent bypass of a consent gate.

3. **`OD-CONSENT-001` (withdrawal/renewal lifecycle):** "Renewed" is a distinct persisted state for the general withdrawal/renewal verb (`IF-CONSENT-WithdrawConsent` and its counterpart). This is separate from the daily gate's own grant/decline cycle, which remains purely date-computed (no persisted "renewed" concept at that layer — see point 5).

4. **`OD-CONSENT-004` (stale-notice-version submissions):** rejected. A decision submitted against a stale/superseded notice version is not accepted — the caller must re-fetch the current notice version and resubmit. This is consistent with the overall fail-closed posture: an ambiguous consent state is treated as not-yet-resolved, not silently accepted.

5. **`OD-CONSENT-007` (Requested/Lapsed persisted vs. computed):** "Lapsed" is a computed concept, not a persisted state — no `Lapsed` row is ever written. It is derived as the absence of a today-dated `Granted` record for the daily gate. "Requested" (a pending ask not yet answered) may remain a distinct transient/in-flight concept but is not itself a durable row either, consistent with keeping the daily-gate schema minimal.

6. **`OD-CONSENT-009` (language fallback):** when notice content is unavailable in a worker's configured/preferred language, fall back to a configured platform-default language (not a silent failure, not a block). The specific default language is an implementation/configuration detail, not itself decided here.

7. **`OD-CONSENT-011` (audit-history RBAC scope):** no dedicated `consent:*`-style RBAC permission is introduced. Manager/Admin-facing access to a worker's consent audit history rides the existing Compliance governance-read path (the same pattern `ADR-016` already established for `AuditLog` — `backend-compliance` as the read-only consumer, not a new permission surface on Consent itself). `IF-CONSENT-GetAuditHistory`'s "Admin" caller class, previously blocked pending this decision (`FIND-SEC-CONSENT-01`), may now be built against this resolution.

## Rationale

- **Separating the two consequential items from the five mechanical ones avoided bundling a genuine product trade-off with routine architecture gaps** — `OD-CONSENT-002`/`006` change user-visible flow behavior; `001`/`004`/`007`/`009`/`011` do not, and treating all seven identically would have obscured which choices actually needed the commissioning human's judgment.
- **Option (b) for the chatbot gate avoids an outsized consequence for a narrow decision.** A worker declining one specific data-processing consent (chatbot) is a different, smaller fact than a worker being unable to be onboarded at all — conflating the two would make the consent gate punitive rather than purpose-limited, which CRR's own consent framing does not call for.
- **Fail-closed for `OD-CONSENT-006` mirrors the platform's existing security-conscious defaults** (e.g. `ADR-031`'s request-time permission derivation defaulting to deny-unless-confirmed) — a GDPR consent gate silently bypassed on infrastructure failure is a worse outcome than a temporary, visible block.
- **Routing audit-history access through Compliance's existing pattern (`OD-CONSENT-011`) avoids introducing a redundant permission surface** for a capability (viewing audit history) the platform already has a settled ownership/access model for.

## Consequences

- `SPEC-CONSENT-001`'s `OD-CONSENT-001/002/004/006/007/009/011` rows are each resolved with the concrete decisions above. The module's own build remains gated on this ADR's downstream implementation (no code exists yet — `backend-consent` has zero code, per the register), but the product/architecture ambiguity that previously blocked scoping the build is closed.
- `docs/03-modules/onboarding/MODULE_SPEC.md`'s `OPQ-3` may now be updated to reflect the concrete resolution (chatbot consent required; decline routes to manual onboarding path, does not block) rather than remaining a forward reference to an undecided Consent-module question.
- `docs/03-modules/chatbot/MODULE_SPEC.md`'s `OD-CHAT-008` may now cite this ADR for the consent-requirement and fail-mode questions it was previously silent on.
- Knowledge-layer updates required (tracked as an exit condition of this ADR's ratification): `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-17 row should be marked Decided with a pointer here; `docs/implementation/GOVERNANCE_REGISTER.md` Part 2 should strike through GD-17; `docs/05-execution/EXECUTION_DASHBOARD.md` should reflect GD-17 as decided.

## Compatibility

No runtime behavior changes as a result of this record alone — `backend-consent` has zero code today. This decision scopes the eventual build; it does not itself implement anything.

## Scope note

This settles the Consent module's own lifecycle and fail-safety questions. It does not decide the specific default fallback language for `OD-CONSENT-009` (an implementation/configuration detail) and does not itself schedule or scope `backend-consent`'s build timeline, which remains a separate prioritization question.
