# ADR-039: HR Contract/Payroll Request Types Redesigned — Zero Payroll Computation, Request-Only Payslip Tracking

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-HR-02` (payroll model conflict), the first sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-HR-001`'s own `OD-HR-02` entry and the commissioning human's explicit approval of Option (a).
- **Date:** 2026-07-28
- **Scope:** `SPEC-HR-001`. Resolves `OD-HR-02`, and the corresponding rows for `IF-HR-CreateContract`, `IF-HR-ListPayroll`, `IF-HR-CreatePayroll`.
- **Supersedes:** none (additive — redesigns unimplemented stub types; no shipped behavior changes).
- **Change class:** Product/architecture decision per Constitution §6/§7 — a genuine type-shape redesign, not a zero-code ratification.

## Problem

`backend-hr`'s current-state stub types (`CreateContractRequest`, `CreatePayrollRequest`, both in `backend/src/modules/hr/types.ts`, all routes returning 501 Not Implemented) predate the confirmed target model and directly conflict with it: `CreateContractRequest` carries a `salary_amount` field implying compensation-setting, and `CreatePayrollRequest` carries `gross_salary`/`pay_period_start`/`pay_period_end` implying payroll computation. CRR §23 confirms the target model is generate-contract → scan-upload → manager-confirm (a document workflow, not compensation-setting) and payslip handling is **request-only, zero payroll math** — actual wage calculation is explicitly out of scope. Implementing from the current stub types as-is would build payroll computation logic the confirmed requirements rule out.

## Decision

1. **`CreateContractRequest`'s target shape drops `salary_amount`.** Retained fields: `worker_id`, `template_id`, `position`, `start_date`, `end_date?`. Contract generation is document production from Personalfragebogen data — it has no reason to carry a compensation field.

2. **`CreatePayrollRequest`/`IF-HR-CreatePayroll` becomes a pure payslip-request record.** Target shape: `worker_id`, `period_start`, `period_end`, `status`. **No gross-salary, pay-period-computation, or any wage-calculation field of any kind.** This interface exists to track that a worker requested a payslip and whether that request was fulfilled — nothing more.

3. **`IF-HR-ListPayroll` lists these request records, not computed payroll data.** There is no confirmed "payroll listing" capability in CRR/PDD — only payslip *requests*. This interface's target shape reflects that.

4. **Actual wage calculation happens outside this system** — an external payroll provider or a manual process not modeled by this platform. `backend-hr` never computes, stores, or exposes a calculated payroll amount.

## Rationale

- **CRR §23's zero-payroll-math non-goal is unambiguous** — there is no genuine ambiguity to defer or split off into a separate future capability; the type-shape conflict was a straightforward drift between stub code written before the confirmed model existed and the model itself, not a live product question.
- **This is the cheapest possible time to fix a type-shape mismatch:** every affected route currently returns 501 (no production data, no external consumer contract — `mobile-worker` receives only 501 responses today), so redesigning the types now is a documentation/planning correction, not a breaking change against any live behavior.
- **Rejected alternatives:** marking the conflict `[NOT IMPLEMENTED]` and deferring the redesign (a weaker version of doing nothing) would just repeat the same fix later with no new information gained by waiting; splitting payroll into a separate bounded context invents a module boundary for a capability CRR explicitly says should not compute anything — there is no genuine "payroll module" to split off.

## Consequences

- `SPEC-HR-001`'s `OD-HR-02` row, and the `IF-HR-CreateContract`/`IF-HR-ListPayroll`/`IF-HR-CreatePayroll` interface rows, are updated to state the resolved target shape. The Evidence and Traceability row documenting the current-state vs. target-state type shapes is updated accordingly.
- No code changes are made or authorized by this record alone — `backend/src/modules/hr/types.ts` remains unimplemented (501); this ADR settles the target shape for whenever `backend-hr` is actually built.
- This resolves one of `GD-15`'s ten sub-decisions. `SPEC-HR-001`'s remaining open items (`OD-HR-03`/`07`/`09`/`10`/`13`/`14`, and Employee-Management's `OD-EMP-04`/`06`/`08`/`13`/`14`) are unaffected and tracked under their own rows.

## Compatibility

No runtime behavior changes — the affected routes return 501 today and carry no production data. No migration, no rollback concern.

## Scope note

This settles only the contract/payroll type-shape question (`OD-HR-02`). It does not resolve any other `GD-15` sub-decision, does not itself unblock `SPEC-HR-001`'s G2 freeze (which remains gated on its other open items and reserved human ownership assignment), and does not decide how or whether the platform ever integrates with an external payroll provider — that remains explicitly out of this system's scope per CRR §23.
