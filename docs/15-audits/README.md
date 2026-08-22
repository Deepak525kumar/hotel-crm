# Audits

Point-in-time audit and verification reports. **Every file here is dated and immutable** — each one
records what was true at the revision it names. None of them describes current state, and none
should be edited to "bring it up to date"; a later audit supersedes an earlier one by being written,
not by rewriting it.

This README exists because these reports have no inbound links from anywhere else, which made every
one of them register as an orphan document to `repository-integrity-check.js`. They are not
orphans — they are an archive. This file is the index that says so.

## Reports, newest first

| Date | Report | Scope |
|---|---|---|
| 2026-08-21 | [`AUDIT_CHECKLIST_2026-08-21.md`](AUDIT_CHECKLIST_2026-08-21.md) | Follow-up checklist re-verified against current code (PR #506/#510) |
| 2026-08-10 | [`BUG_REPORT.md`](BUG_REPORT.md) | Repository-wide implementation & MVP readiness audit — 18 module audits + 4 cross-cutting audits, baselined at `00c6c09` |
| 2026-08-03 | [`FRONTEND_MVP_COMPLETION_REPORT_2026-08-03.md`](FRONTEND_MVP_COMPLETION_REPORT_2026-08-03.md) | Frontend MVP completion |
| 2026-07-24 | [`REPOSITORY_AUDIT_2026-07-24.md`](REPOSITORY_AUDIT_2026-07-24.md) | Repository audit |
| 2026-07-23 | [`RELEASE_READINESS_AUDIT_2026-07-23.md`](RELEASE_READINESS_AUDIT_2026-07-23.md) | Release readiness |
| 2026-07-16 | [`ADR_INTEGRITY_RESTORATION_2026-07-16.md`](ADR_INTEGRITY_RESTORATION_2026-07-16.md) | ADR-file-loss incident and restoration (see `ADR-019`, `SIR-GLOB-021`) |
| 2026-07-15 | [`VERIFICATION_AUDIT_2026-07-15.md`](VERIFICATION_AUDIT_2026-07-15.md) | Verification audit |
| 2026-07-15 | [`G2_FREEZE_REPORT_2026-07-15.md`](G2_FREEZE_REPORT_2026-07-15.md) | G2 specification-freeze report |
| 2026-07-15 | [`IMPLEMENTATION_READINESS_REPORT_2026-07-15.md`](IMPLEMENTATION_READINESS_REPORT_2026-07-15.md) | Implementation readiness |
| 2026-07-15 | [`DOCUMENTATION_CORRECTIONS_PACKAGE_B_2026-07-15.md`](DOCUMENTATION_CORRECTIONS_PACKAGE_B_2026-07-15.md) | Documentation corrections, package B |
| 2026-07-14 | [`REPOSITORY_SPECIFICATION_AUDIT_2026-07-14.md`](REPOSITORY_SPECIFICATION_AUDIT_2026-07-14.md) | Repository specification audit |

## Reading these safely

`BUG_REPORT.md` is the largest and the most likely to mislead: it is baselined at `00c6c09`
(2026-08-02) and its findings were partly remediated afterwards — PR #507 removed its
document-templates findings outright when that module was retired. **Check a finding against the
current code before acting on it.** The same caution applies to every file here.

For current state, use `docs/05-execution/EXECUTION_DASHBOARD.md` (where work is) and
`docs/05-execution/RELEASE_STATUS.md` (production readiness), not this directory.
