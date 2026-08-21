# Outstanding Items Checklist — 2026-08-21 Audit Follow-up

Source: audit of `docs/15-audits/BUG_REPORT.md` and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` against current code. Items already fixed (leaderboard pagination, retention audit-log RBAC, document-templates module removal, CLAUDE.md register pointer) are updated in place in those files and are not repeated here.

## Confirmed still open (re-verified against code, 2026-08-21 second pass)
- [ ] **Documents module — S3 upload hard-fails with bare 500** when credentials/config are missing. `backend/src/modules/documents/storage.ts:160-167` still routes to the real S3 client whenever `S3_BUCKET` is set, no degraded fallback or clearer error surface. Matches `docs/10-testing/e2e/scenarios/08-known-gaps-and-next.md` §1 item #10, also still open.
- [ ] **SIR-AUTH-011** — GDPR retention tier for `User`/`Session`/`AuditLog` still unassigned. Human/product decision, register confirms OPEN.
- [ ] **OQ-02 / SIR-QUAL-002** — `WorkerOverallRating.average_score` redefinition remains a BREAKING cross-consumer contract change, unresolved. Human/architecture decision, register confirms OPEN.
- [ ] **SIR-HR-007 / OD-HR-15** — sequencing-risk disclosure; a formal human Risk Assessment is still required before HR can be considered independently safe. Register's own text confirms this is "narrowed but not resolved."
- [ ] **SIR-HR-017 / OD-HR-11** — no GDPR retention tier assigned to the contract document/PDF/scan. OPEN.
- [ ] **SIR-DOC-001 / OD-DOC-001** — no GDPR retention tier assigned to `WorkerDocument`. OPEN.
- [ ] **SIR-DOC-016 / OD-DOC-016** — malware-scan *hook* is wired (`ADR-066`), but no scanning vendor/library is selected — the default scanner is still a pass-through no-op. Real control flow, not real detection.
- [ ] **OD-RETENTION-10** — internal sweep-to-consuming-module authorization still undecided. (The sibling RBAC gap, `OD-RETENTION-05`, was fixed 2026-08-21 — see Resolved section.)
- [ ] **OQ-NOTIF-05 / SIR-NOTIF-005** — `sendNotification` still performs no authorization check on "may producer X notify user Y." OPEN.
- [ ] **SIR-CHAT-020 / OD-CHAT-022** — moot in practice: confirmed `backend/src/modules/chatbot/` is still just a `.placeholder`, module not built.
- [ ] Register-wide spec-vs-code drift claims in `BUG_REPORT.md` §1/§2 (module registry version pointers, spec-body understatement across ~8 of 18 modules) — last verified 2026-08-02/08-09, now ~3 weeks stale; still needs a fresh pass across all 18 module specs (out of scope for this pass — large).
- [ ] Run-log "fixed same session" defects across `docs/10-testing/e2e/runs/*.md` (2026-08-12 → 2026-08-20) — spot-checked 2 of ~10 cited commits this pass (consent-atomicity `$transaction`, assign-UI null-field fix), both confirmed real in code; the rest not individually re-checked.

## Resolved (confirmed by direct code re-check, 2026-08-21 second pass)
- [x] **BUG-PAG-02** — `hr` `listContracts` (`service.ts:452-460`) and `listPayroll` (`service.ts:1101-1109`) both now use `skip`/`take` from `page`/`limit` params. No unbounded `.findMany()` remains.
- [x] **BUG-PAG-03** — `employee-management` `getBlocklist` (`service.ts:356-371`) uses `skip`/`take` from `page`/`limit` params.
- [x] Scenario-08 §1 items #2 and #8 (assign-modal UI, null-vs-undefined field bug) spot-checked directly against `ReviewQueueTable.tsx`/`types.ts` — confirmed fixed as claimed. Items #1, #3, #7, #9, #11 not independently re-checked this pass (self-reported fixed, plausible given #2/#8 checked out).
- [x] Scenario-08 §2 judgment-call #1 ("retention audit log readable by any authenticated user") — **stale, now fixed**: corrected in place in that file to reflect the 2026-08-21 `requireRole('admin')` gate (`OD-RETENTION-05` half of `SIR-RETENTION-003`); `OD-RETENTION-10` half remains open, noted above.

## Resolved since last update (2026-08-21 cleanup passes)
- [x] **BUG-DT-006** — sensitive files in workspace root. Confirmed gone from disk and from `git log --all` (not just untracked) — closed, not just moot.
- [x] `docs/03-modules/document-templates/MODULE_SPEC.md` and `docs/11-deployment/monitoring/DOCUMENT_TEMPLATES_CHROMIUM_RUNBOOK.md` deleted (module they described no longer exists).
- [x] All BUG-DT-* / BUG-PAG-01 entries removed from `BUG_REPORT.md` §12/§13 (previously marked moot, now fully removed per owner request).
- [x] `.claude/knowledge/MODULE_REGISTRY.yaml` and `SPECIFICATION_INDEX.yaml` `backend-document-templates` entries updated to `implementation_status: removed`.
- [x] Stale in-code comment in `backend/src/modules/documents/service.ts` referencing `document-templates/service.ts` as a live caller — corrected.
- [x] `docs/10-testing/e2e/REMAINING_WORK.md` "Remove the Document Template feature" TODO checked off as already done.
- [x] Login/password-reset rate limiting — was flagged as absent; investigation found it already existed at the Nginx edge (`SIR-AUTH-018`, resolved). Added per-account app-layer throttle as defense-in-depth (`ADR-070`), landed in PR #509 (open, CI green, not yet merged to `main`).

## Documentation hygiene (no code risk, but should be closed out)
- [ ] Sync `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` rows for any other stale "OPEN" markers not covered by this pass.
