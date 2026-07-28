# ADR-040: HR Contract Continuation/Permanence — Manager-Only Confirmation, No Worker-Side Veto

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-HR-03` and `OD-HR-07`, the second sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-HR-001`'s own `OD-HR-03`/`OD-HR-07` entries and the commissioning human's explicit approval of Option (a).
- **Date:** 2026-07-28
- **Scope:** `SPEC-HR-001`. Resolves `OD-HR-03` (contract lapse/non-renewal workflow) and `OD-HR-07` (continuation/permanence confirmation mechanism), and `RULE-HR-06`'s exception-handling text.
- **Supersedes:** none (additive — resolves an undefined mechanism; no shipped behavior changes, `backend-hr` has zero code).
- **Change class:** Product decision per Constitution §6/§7.

## Problem

`RULE-HR-06` defines the contract lifecycle's positive path (1-year fixed-term → extended one additional year → permanent after 2 years, "if both parties wish to continue") but leaves two things undefined: (1) the mechanism for capturing "both parties wish to continue" at each mark — is it a manager action, a worker confirmation, or both — and (2) what happens on the negative path, when a party does not wish to continue (lapse/non-renewal/offboarding). Without both resolved, the entire contract-lifecycle state machine's transition triggers and exception path are unspecified.

## Decision

1. **Continuation and permanence confirmation is manager-only.** At the 1-year mark (extend) and 2-year mark (make permanent), a single manager action confirms the transition. There is no separate worker-side confirmation, approval, or veto step.

2. **Lapse is triggered by an explicit manager "do not continue" action, or by manager silence past a defined deadline.** Either produces the same outcome: the contract lapses and offboarding is triggered (via `SPEC-EMP-001`'s own offboarding-trigger mechanism, `OD-EMP-04`, itself still open and tracked separately).

3. **No worker-facing approval/veto surface is introduced by this decision.** The worker relationship to this transition is informational only (they may be notified of the outcome), not decisional.

## Rationale

- **Mirrors the platform's existing manager-write-authority pattern (`ADR-030`):** hotel/group and employment-relationship writes are Admin/Manager-only across this platform; a dual-approval flow requiring worker sign-off on their own contract continuation would be new UX surface with no CRR text calling for worker veto power over this decision.
- **Simplicity over an acknowledge-only middle option:** a manager-decides/worker-acknowledges variant was considered and rejected — it adds a notification/acknowledgment step without changing who actually decides, at the cost of extra UI surface and a new interaction pattern not otherwise present in this module.

## Consequences

- `SPEC-HR-001`'s `RULE-HR-06`, `OD-HR-03`, and `OD-HR-07` are updated to state the resolved mechanism: manager-only confirmation, lapse on decline-or-silence, no worker veto.
- The offboarding-trigger workflow itself (`SPEC-EMP-001`'s `OD-EMP-04`) remains a separate, still-open sub-decision of `GD-15` — this ADR settles only what triggers a lapse in HR's own contract state machine, not how offboarding executes once triggered.
- No code changes are made or authorized by this record — `backend-hr` remains zero-code; this settles the target behavior for whenever the module is built.

## Compatibility

No runtime behavior changes — no code exists for this capability today. No migration, no rollback concern.

## Scope note

This settles the contract continuation/lapse confirmation mechanism only. It does not resolve `OD-EMP-04` (the offboarding-trigger workflow lapse feeds into) or any other `GD-15` sub-decision.
