# ADR-046: Worker Self-Edit Boundary — Personal Contact/Preference Fields Only, Platform-Wide

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-EMP-06`, the eighth sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-EMP-001`'s own `OD-EMP-06` entry and the commissioning human's explicit approval of Option (b), with an explicit field allow-list and a platform-wide scope rather than an Employee-Management-only rule.
- **Date:** 2026-07-28
- **Scope:** **Platform-wide** — this is not an Employee-Management-specific decision. It establishes the general worker self-edit boundary that applies wherever a worker's own profile/employment data is editable, across `employee-management`, `hr`, and any future module touching worker-owned fields.
- **Supersedes:** none (additive — no shipped worker-edit capability exists today to change).
- **Change class:** Product/architecture decision per Constitution §6/§7. Recorded platform-wide per the commissioning human's explicit instruction, since a module-scoped version of this rule would need re-deciding for every future module that touches worker data.

## Problem

`SPEC-EMP-001`'s `OD-EMP-06` asked a narrow question — can a worker edit their own profile after onboarding — but the underlying boundary (which fields a worker may change about themselves vs. which require Manager/Admin action) is not really an Employee-Management-specific question. Any module that lets a worker view or touch their own record (HR's contract/payslip data, future modules) will eventually face the identical question. Deciding it once, platform-wide, avoids re-litigating the same boundary per module.

## Decision

1. **Workers may self-edit only personal contact and preference fields:** phone number, email (if supported), preferred language, profile photo, emergency contact details, and notification preferences.

2. **Every other field category remains Manager/Admin-controlled, platform-wide:** employment fields, HR fields (contracts, payslips, any Tier-3-adjacent data), scheduling fields, skill tags, job title, contract terms, payroll data, role/permission assignments, and any organizational/reporting-structure field. A worker has no self-edit path for any of these, in any module.

3. **This boundary applies to every module that exposes worker-owned data for editing**, not solely `employee-management`. A future module (e.g., a hypothetical worker-profile or preferences module) must consult this ADR rather than re-deciding the same question.

4. **New field categories introduced by future modules default to Manager/Admin-controlled** unless explicitly added to the self-edit allow-list by a future amendment to this ADR — the allow-list is opt-in, not opt-out.

## Rationale

- **A blanket "no self-edit" rule (rejected Option (a))** is an unnecessarily harsh UX outcome for low-stakes, self-contained corrections (a phone-number typo) that have no downstream consequence for job matching, dispatch, payroll, or compliance — forcing every trivial correction through Admin adds friction with no corresponding risk reduction.
- **Full self-edit of all non-employment-term fields (rejected Option (c))** risks a worker silently changing something like job title or skill tags that has real downstream effects (job-matching eligibility, dispatch routing) — those fields need Manager/Admin oversight precisely because they're not self-contained.
- **The chosen allow-list (Option (b)) is the safe intersection:** every field on it is self-contained (changing your own phone number affects nothing else) and low-risk (no compliance, payroll, or job-matching consequence). Everything else defaults to controlled, consistent with the platform's existing manager-write-authority pattern (`ADR-030`).
- **Recording this platform-wide, not module-scoped,** prevents the same boundary question from being re-decided (and potentially decided inconsistently) by each future module that touches worker data.

## Consequences

- `SPEC-EMP-001`'s `OD-EMP-06` is resolved: the permission matrix may now state the concrete self-edit allow-list for `employee-management`'s own worker-profile fields.
- Any future module spec that exposes worker-editable data must cite this ADR for its own self-edit boundary rather than re-deciding it, unless proposing an explicit amendment (e.g., adding a new field to the allow-list) via its own governance process.
- No code changes are made or authorized by this record — this settles the target permission boundary for whenever worker-facing edit capability is built in any module.

## Compatibility

No runtime behavior changes — no worker self-edit capability exists in shipped code today. No migration, no rollback concern.

## Scope note

This settles the worker self-edit field boundary platform-wide. It does not resolve any other `GD-15` sub-decision, and it does not itself implement any self-edit endpoint — that remains an ordinary implementation task per module, informed by this decision's allow-list.
