# ADR-061: Regional Manager Document Access — Supersedes GD-16/OD-DOC-007

- **Status:** Accepted — ratified by the project owner on 2026-08-04 (Regional Manager V1 scoping
  session), reversing the document-access half of `GD-16`'s decision. The owner was shown the direct
  conflict between `OD-DOC-007`'s "explicitly not adopted" disposition and `ADR-030` D-5 / PDD §5.4
  ("Regional Manager: all Hotel-Manager actions across the group") and chose the latter. Authored
  retroactively by the Lead Architect during PR6's documentation-synchronization pass — the reversal
  had already shipped in code (`backend/src/modules/documents/routes.ts`, commit `c6a4d61`, PR #339)
  with an inline governance note naming this record as required and not yet existing; this ADR is
  that record.
- **Date:** 2026-08-04 (owner decision) / 2026-08-05 (this record authored)
- **Scope:** `SPEC-DOCUMENTS-001`'s `OD-DOC-007` (document-level RBAC — who beyond the uploading
  worker and their manager may access a `WorkerDocument`). Narrowly reverses only the
  Regional-Manager clause of `GD-16`'s option (a) disposition; does not reopen `OD-DOC-005`'s
  category-taxonomy half, does not touch Admin or Checker access (both remain as `GD-16` decided —
  Admin implicitly via `admin:*`, Checker still excluded), and does not touch any other module.
- **Supersedes:** `GD-16` (Documents module — RBAC & storage design), document-access clause only.
  `GD-16`'s other dispositions in that same decision (self-upload + manager-upload as the only two
  *upload* actors; hotel-scoped read via `checkHotelAccess()`; presigned-URL retrieval; SSE-at-rest;
  malware-scan hook) are unaffected and remain in force.
- **Change class:** Material authorization-model decision requiring a Decision Record per
  Constitution §6/§7 — the same class as `ADR-030`, which this record is consistent with rather than
  independent of (see §2).

---

## 1. What GD-16 decided, and why this reverses part of it

`GD-16` (2026-07-27, recorded in `docs/03-modules/documents/MODULE_SPEC.md`'s `OD-DOC-007` row)
resolved the module's document-level RBAC question with option (a): self-upload by the worker and
manager-upload for the contract-scan mechanism case are the only two confirmed *actors*, hotel-scoped
read via the existing `checkHotelAccess()`, and — the clause this record reverses — "broader
Regional-Manager/Admin/Checker access explicitly not adopted (Constitution §6)."

At the time `GD-16` was decided, `REGIONAL_MANAGER` was an enum value with no route, service, or
scope-resolution code behind it (`FEATURE_RM_ROLE` was off, ADR-030 PR-2/M-1 had landed the enum
alone). `GD-16`'s "not adopted" clause was a reasonable reading of CRR/PDD's silence on document
access specifically, made before the Regional Manager feature's authorization model existed to
reason about.

By 2026-08-04, `ADR-030` D-5 and PDD §5.4 had both settled — as a platform-wide, not
documents-specific, principle — that **Regional Manager holds every operational capability a Hotel
Manager holds, at hotel-group scope**: *"Regional Manager | All Hotel-Manager actions across the
group | All hotels in group"* (PDD §5.4:179). Document access for a Hotel Manager (reading/uploading
for workers at their hotel) is exactly such an operational capability. `GD-16`'s document-specific
carve-out and this platform-wide principle now directly conflicted for the one role both named.

## 2. Decision

**Regional Manager is granted the same document access a Hotel Manager holds, narrowed to their
hotel group instead of their hotel** — not a new, documents-specific RBAC tier, but the direct
application of `ADR-030` D-5's existing rule to this module, the same way `ADR-050` (calendar) and
`ADR-060` (org chart) each applied it to their own modules rather than re-deciding it. Admin and
Checker's access is unchanged; Checker remains excluded, matching `GD-16`'s unreversed clause and
this repository's `DocumentsGate`/`GeoCheckinsGate` precedent of gating strictly to what the backend
actually enforces.

Mechanically: `regional_manager` is added to `documents/routes.ts`'s five role gates
(upload/list/completeness/export/get), and `middleware/permissions.ts#resolveWorkerScope()` — the
seam that resolves whether a manager-role caller's `worker_id` falls within their scope — gains a
`regional_manager` branch via `isScopedManagerRole()`, mirroring the identical fix already applied to
`resolveHotelAccess()` for hotel-grain scoping (`SIR-AUTH-021`). Group-grain scoping is enforced by
`isWorkerInGroupScope()` (`lib/scope.ts`), which was already role-agnostic and needed no change of
its own — the gap was only in which roles were routed to it.

## 3. Alternatives considered

**A. Leave `GD-16` as decided; RM stays excluded from documents.** Rejected: this is what shipped
before 2026-08-04 and is what the owner was shown in direct conflict with `ADR-030` D-5. Keeping it
would mean an RM administering a worker's HR contract (which RM can do, per `ADR-030` C-29/C-30)
cannot see that worker's contract-scan document — an incoherent split within one operational
workflow.

**B. Grant RM document access, but only read, not upload.** Considered and rejected: `GD-16`'s
existing actor model already ties upload authority to the same "manager acting on a worker's behalf"
capability class as the contract-scan mechanism; splitting read from write for RM alone would
introduce an asymmetry the module doesn't have for Hotel Manager, with no requirement basis for the
asymmetry.

**C. Route this through a fresh `OD-DOC-007b` open-decision cycle instead of an ADR.** Rejected on
process grounds: `OD-DOC-007` is already `Resolved` and the spec is `FROZEN` (`documents/MODULE_SPEC.md`
Document Control). Reopening a frozen spec's resolved decision requires a superseding Decision
Record per Constitution §6/§7, not an in-place edit to the frozen row — the same discipline
`ADR-013`/`ADR-015` establish for boundary changes to other frozen specs.

## 4. Consequences

- `documents/MODULE_SPEC.md`'s `OD-DOC-007` row (frozen, `Resolved`) is **not edited in place** —
  its append-only Review and Change Log convention (Constitution §12, exercised throughout that
  file's own history) requires a new dated Change Log entry recording this reversal by later
  correction, the same pattern that file already uses for its own internal corrections (see its
  v0.1.1→v0.1.4 rows). That entry is a separate Documentation Workflow action this ADR authorizes,
  not part of this record itself — mirroring `ADR-013`/`ADR-015`'s own stated scope.
- No schema change. No new permission token: RM's existing token set (`MANAGER_PERMISSIONS` plus
  `org_chart:read`, `config/constants.ts`) already covers documents access via the same tokens Hotel
  Manager uses (`resolveWorkerScope()` is permission-token-agnostic; the DTO/route split is a role
  gate, not a token grant).
- `frontend/components/auth/RoleGate.tsx`'s `DocumentsGate` widened to admit `regional_manager`,
  consistent with the backend (already applied, PR #339).
- `SIR-DOC-007` in `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` (if a row exists citing
  `OD-DOC-007`'s original resolution) should be appended with a pointer to this ADR at the next
  register-synchronization pass — append/resolve, never delete history, per that register's own
  protocol.

## 5. Validation

Not independently re-reviewed under the G4 gate (Architecture/Dependency/Consistency/Security/
Performance) as a standalone specification change, because the code change this record documents was
already shipped and reviewed as part of PR #339's own review cycle (mutation-tested authorization
tests, `capability-policy.test.ts` policy suite, `documents-authz.test.ts` RM coverage — see that
PR's history). This ADR is the missing governance artifact for an already-validated code change, not
a proposal awaiting implementation.
