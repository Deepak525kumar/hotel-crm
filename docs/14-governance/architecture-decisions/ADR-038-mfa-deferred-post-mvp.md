# ADR-038: MFA Explicitly Deferred to a Post-MVP Hardening Milestone

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-08` (MFA design & data model). Authored by the Lead Architect from `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-08 entry and the commissioning human's explicit approval of Option (c).
- **Date:** 2026-07-28
- **Scope:** `SPEC-AUTH-001`. Resolves `OQ-AUTH-01` (MFA portion, `SIR-AUTH-005`) and `OQ-AUTH-02` (MFA data model, `SIR-AUTH-006`).
- **Supersedes:** none (additive — records a deliberate deferral, not a design).
- **Change class:** Product/scheduling decision per Constitution §6/§7. Unlike a design-and-build ADR, this record's substance is the deferral itself — it deliberately does not select a data model, since none is needed until MFA re-enters scope.

## Problem

`TREQ-AUTH-006` confirms MFA is a required capability, but no MFA-related model, field, or endpoint exists anywhere in the repository, and the underlying data-model question (where does MFA state — secret, enrollment status, recovery codes — persist) has never been decided. Leaving this open indefinitely, without a recorded decision either way, risks the requirement quietly falling out of scope with no disclosed reason — the exact failure mode Constitution §6 (mark unknowns explicitly, never convert an assumption into a requirement) exists to prevent.

## Decision

1. **MFA is explicitly deferred to a post-MVP hardening milestone.** It is not in near-term scope. This is a deliberate scheduling decision, not a silent gap — `TREQ-AUTH-006` remains a confirmed requirement, just not one this ADR schedules for the current build horizon.

2. **No MFA data model, mechanism (TOTP vs. OTP-via-delivery-channel), or schema is selected by this record.** That design choice is intentionally left open until MFA is actually re-prioritized — deciding a concrete mechanism now, with no near-term implementation planned, would be speculative architecture ahead of need (Constitution §6).

3. **When MFA is re-prioritized, the mechanism choice (TOTP vs. OTP, per this decision's own prior options analysis) should be revisited fresh** — not automatically defaulted to whichever option this ADR's authoring session happened to lean toward, since the platform's own delivery infrastructure (`ADR-029`'s Outbox) or security posture may have changed by then.

## Rationale

- **An explicit deferral is strictly better than a silent gap.** The requirement stays visible and traceable (`OQ-AUTH-01`/`OQ-AUTH-02` marked resolved-as-deferred, not left ambiguously "open" with no signal of intent) rather than quietly aging out of every planning conversation.
- **Deciding a data model now, with no near-term build planned, would be premature.** TOTP and OTP-via-delivery-channel have materially different schemas and dependencies; picking one today commits to an implementation shape before it's needed, and the right choice may look different whenever MFA actually gets scheduled.

## Consequences

- `SPEC-AUTH-001`'s `OQ-AUTH-01` (MFA portion) and `OQ-AUTH-02` (MFA data model) are marked resolved-as-deferred: MFA is out of near-term scope by deliberate decision, not an unaddressed gap. Neither row is deleted or silently closed — both retain their content, annotated with this ADR's deferral.
- No code, schema, or migration is authorized or performed by this record. `TREQ-AUTH-006` remains a confirmed, unimplemented requirement, explicitly scheduled for a future post-MVP milestone rather than the current build horizon.
- Knowledge-layer updates required (tracked as an exit condition of this ADR's ratification): `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-08 row should be marked Decided with a pointer here; `docs/implementation/GOVERNANCE_REGISTER.md` Part 2 should strike through GD-08; `docs/05-execution/EXECUTION_DASHBOARD.md` should reflect GD-08 as decided-as-deferred.

## Compatibility

No runtime behavior changes as a result of this record alone — no code exists for MFA today, none is authorized by this decision.

## Scope note

This settles only the *timeline* question (defer, not build now) and explicitly does not settle the *mechanism* question (TOTP vs. OTP vs. any other approach), which remains open for whenever MFA is re-prioritized.
