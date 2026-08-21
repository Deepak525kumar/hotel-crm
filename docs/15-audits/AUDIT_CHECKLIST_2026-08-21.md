# Outstanding Items Checklist — 2026-08-21 Audit Follow-up

Source: audit of `docs/15-audits/BUG_REPORT.md` and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` against current code. Items already fixed (leaderboard pagination, retention audit-log RBAC, document-templates module removal, CLAUDE.md register pointer) are updated in place in those files and are not repeated here.

## Confirmed still open (verified against code this pass)
- [ ] **Documents module — S3 upload hard-fails with bare 500** when credentials/config are missing. `backend/src/modules/documents/storage.ts:157-171` routes to the real S3 client whenever `S3_BUCKET` is set, with no degraded/stub fallback or clearer error surface.

## Needs re-verification (not independently re-checked this pass; treat as open until confirmed)
- [ ] **BUG-DT-006 follow-up** — sensitive files in workspace root. Spot-checked this pass: no `*.pdf`/`*.pem` currently sitting untracked at repo root. Still confirm nothing sensitive is committed in git history, and close the row formally in `BUG_REPORT.md` §12 once confirmed.
- [ ] **BUG-PAG-02** — `hr` module `listContracts` (`service.ts:223`) and `listPayroll` (`service.ts:678`) use unbounded `.findMany()`.
- [ ] **BUG-PAG-03** — `employee-management` `getBlocklist` (`service.ts:203`) uses unbounded `.findMany()`.
- [ ] Release-blocker list in `BUG_REPORT.md` §8 (re-verify each against current code):
  - [ ] SIR-AUTH-011 — GDPR retention tier assignment (auth)
  - [ ] OQ-02 / SIR-QUAL-002 — `WorkerOverallRating.average_score` breaking contract change (quality)
  - [ ] SIR-HR-007 / OD-HR-15 — formal human Risk Assessment required (hr)
  - [ ] SIR-HR-017 / OD-HR-11 — no GDPR retention tier for contract document (hr)
  - [ ] SIR-DOC-001 / OD-DOC-001 — no GDPR retention tier for `WorkerDocument` (documents)
  - [ ] SIR-DOC-016 / OD-DOC-016 — malware-scanning vendor/library not yet selected (scan hook itself is wired per `ADR-066`, but real detection is still a no-op)
  - [ ] OD-RETENTION-10 — internal sweep-to-consuming-module authorization still undecided (retention) — confirmed still open this pass, RBAC half (OD-RETENTION-05) is now resolved
  - [ ] OQ-NOTIF-05 / SIR-NOTIF-005 — no cross-module authorization check on notification targeting
  - [ ] SIR-CHAT-020 / OD-CHAT-022 — blocking Claude API call with no timeout/backpressure (moot unless/until chatbot module is built)
- [ ] Scenario-08 self-reported "FIXED" items (`docs/10-testing/e2e/scenarios/08-known-gaps-and-next.md` §1, items 1–9, 11) — fixed within the same living document but not independently re-verified against code.
- [ ] Run-log "fixed same session" defects across `docs/10-testing/e2e/runs/*.md` (2026-08-12 → 2026-08-20) — each cites a commit/PR (e.g. `#495`, `981229b`, `3f7bae4`, `6a06563`, `25219f1`, `19f009d`, `fdf2096`, `6bd4b17`, `dadf129`) but presence/correctness of the fix was not individually re-confirmed.
- [ ] Register-wide spec-vs-code drift claims in `BUG_REPORT.md` §1/§2 (module registry version pointers, spec-body understatement across ~8 of 18 modules) — last verified 2026-08-02/08-09, now ~3 weeks stale; needs a fresh pass across all 18 module specs.

## Documentation hygiene (no code risk, but should be closed out)
- [ ] Sync `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` rows for any other stale "OPEN" markers not covered by this pass (only `SIR-RETENTION-003` was corrected this session; `SIR-QUAL-007` was already accurate).
