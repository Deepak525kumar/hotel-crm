# ADR-024: Epic 5 Cutover Mechanism — PR 5.5/PR 5.7 Ordering, Feature-Flag Topology, and Compatibility-Layer Removal

- **Status:** Proposed. Requires human ratification per Constitution §20, mirroring the ADR-022/ADR-023 ratification-by-merge precedent. This record authorizes **no** runtime change, schema migration, code, or specification edit.
- **Date:** 2026-07-20
- **Scope:** Migration *sequencing and topology* only. Settles the one open cutover question that `ADR-022`/`ADR-023` deliberately leave unprescribed and that `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` §2/§3/§9 escalates to a Decision Record: the relative order of PR 5.5 (authorization behavior flip) and PR 5.7 (roster→employment cutover), the mechanism *class* of PR 5.7, the feature-flag topology, the compatibility-layer guarantee, and the conditions under which the `HotelWorker` compatibility logic may be physically removed. This record decides architectural invariants; it does not prescribe operational procedure (parallel-run windows, rollback playbooks, snapshot timing, validation checkpoints), which remain the Execution Plan's concern (§2/§6/§7/§8).
- **Supersedes:** none (additive sequencing decision; consumes `ADR-022` prerequisite ordering and `ADR-023`'s scope model, contradicts neither).
- **Change class:** Material migration-sequencing decision requiring a Decision Record per Constitution §6/§7, same class as `ADR-018`/`ADR-021`/`ADR-022`. Does not freeze or amend any FROZEN specification; frozen-spec forward-notes remain Correction-class work executed at implementation time (`ADR-022` §Required correction-class amendments).

## Problem

`ADR-022` §Dependency order / §Authorization migration plan and `ADR-023` §Decision define the Epic 5 target state and its prerequisite builds, but neither prescribes the **cutover mechanism**. `IMPLEMENTATION_EXECUTION_PLAN.md` §3 marks it `[PR 5.5 vs PR 5.7 relative order = OPEN]` and §9 reserves it to an Architecture Decision Record. Three points are undecided:

1. Whether the authz flip (PR 5.5) lands **before or after** the roster cutover (PR 5.7) — "both touch manager scoping" (plan §2).
2. The **mechanism class** of PR 5.7 — synchronous dual-write, read-through shim, or flag-gated cutover (plan §2).
3. How the two Epic 5 chains remain individually reversible while sharing one `HotelWorker` compatibility layer that `ADR-022` §4 retains "until the replacements exist."

## Grounding facts (verified against repository authority)

- `HotelWorker` serves **two independent consumers** of the same table: (a) `checkHotelAccess()`'s worker ACTIVE-membership read (`backend/src/middleware/permissions.ts:122-131`), and (b) roster/employment-data reads by the consumer modules (`ADR-022` §Problem, §Consequences). `ADR-022` §Dependency order sequences "repoint … `checkHotelAccess()`" (step 4) **before** "Remove `backend-hotel-workers`" (step 6).
- The findings PR 5.5 closes (`OQ-AUTH-06`/`SIR-AUTH-003`; ATT `OQ-02`; QUAL `OQ-03/09`; CRM `OQ-CRM-17`; ANALYTICS `OQ-ANALYTICS-12`) concern the **blanket admin/manager/checker bypass** only (`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-AUTH-003`; plan §0/§2). Workers are already scoped by ACTIVE membership and are **not** in scope of PR 5.5's flip (established by the Epic 4 supersession, plan §2).
- The current `User` model carries **no** manager→hotel/group field (`backend/prisma/schema.prisma:117-156`); `UserRole` is `WORKER/CHECKER/MANAGER/ADMIN` with no Regional-Manager distinction (`schema.prisma:22-27`). A **Regional Manager's** scope is fully determined by `ADR-023` §1/§5 (`HotelGroup.regional_manager_user_id`, CRM-owned, delivered by PR 5.2). A **Hotel Manager's** per-hotel association is **not** resolved by `ADR-023` — it is the still-open `OD-CRM-01` residual (`REQ-CRM-006`/`RULE-CRM-07`, `.claude/knowledge/DECISION_INDEX.md`) and the unbuilt `UserRole` addition (`OD-CRM-05`).
- Migration is **pre-launch, no production employee data, non-destructive**, with the `HotelWorker` table retained throughout (`ADR-022` §Data migration, §Rollback, §4).

## Decision

**D1 — Ordering: PR 5.5 lands before PR 5.7.** The authorization flip is sequenced ahead of the roster cutover. Grounds:
- PR 5.5 depends only on the HotelGroup/scope-claim chain (PR 5.1→5.4), **not** on the employment-record chain (PR 5.6/5.7): the bypass it removes is for admin/manager/checker, whose scope `backend-auth` computes from `HotelGroup`/`Hotel.hotel_group_id`/RM-assignment (`ADR-023` §6), delivered by PR 5.2/5.3. This matches the plan §3 graph drawing 5.4→5.5 and 5.6→5.7 as parallel chains from 5.1.
- The two PRs cut **different** consumers of `HotelWorker`, so neither forces the other by a data dependency; the tie is broken on finding severity — PR 5.5 closes exploitable-now High findings (`SIR-AUTH-003`) and should not wait behind the larger roster cutover.
- The one thing PR 5.5 leaves on the compatibility layer — the **worker ACTIVE-membership branch** — is exactly what PR 5.7 later repoints to the EMP employment record. Ordering 5.5→5.7 is therefore also the natural data dependency, consistent with `ADR-022` §Dependency order steps 4→6 and the plan §5 coherent-checkpoint list ("after PR 5.5 the authz is coherent").

**D2 — PR 5.7 mechanism class: a flag-gated cutover over the retained compatibility layer — not a synchronous dual-write.** A synchronous dual-writer exists to preserve zero-loss consistency across two *live-production* datastores; that condition does not hold here (pre-launch, no production employee data, `HotelWorker` retained non-destructively — `ADR-022` §Data migration, §4). The architecturally sufficient mechanism is therefore to read from the EMP employment record behind a flag, with the retained `HotelWorker` table as the fallback path, rather than to stand up and maintain a durable dual-writer. This is the mechanism-*class* answer to the plan's escalated question; the operational verification procedure is the Execution Plan's concern (§2/§8), not this record's.

**D3 — Feature-flag topology: two independent, additive flags, one per consumer track.** The authz cutover (PR 5.4/5.5) and the roster cutover (PR 5.7) are gated by **separate** flags, reflecting D1's finding that the two tracks are independent. Both flags **OFF reproduces today's behavior exactly** — the compatibility guarantee of D4 — and they are switched independently, in the D1 order. (Flag identifiers are an implementation naming detail, defined in the Execution Plan; this record fixes only the topology: two flags, additive, independent, both-off-is-current.)

**D4 — Compatibility-layer guarantee (invariant).** Until the removal conditions of D5 hold, the `HotelWorker` table, the `backend-hotel-workers` module, and `checkHotelAccess()` remain live and readable; no data is dropped; and no FROZEN specification's text is changed (roster/`checkHotelAccess` references stay valid, their Correction-class forward-notes applied only at implementation time). This is `ADR-022` §4 (line 29) and §Compatibility (line 48) carried into the cutover.

**D5 — Removal conditions for the `HotelWorker` compatibility logic (invariant gating PR 5.8).** Physical removal is permitted only when **both** consumers have been cut over: (i) **no authz reader of `HotelWorker` remains** — PR 5.5 is complete and the residual worker-membership branch has been repointed by PR 5.7 (`checkHotelAccess()` no longer reads the table); and (ii) **no roster reader remains** — every consumer module reads the EMP employment record (PR 5.7 complete). A standing ordering invariant governs (i): **the JWT `scope` claim must be live (PR 5.4) before the membership branch is removed**, to avoid an authorization gap (`ADR-022` §Authorization migration plan line 77; §Dependency order step 6; plan §2 PR 5.8 "gated on PR 5.6/5.7 verified"). The operational gating (soak duration, pre-`DROP` snapshot) is the Execution Plan's (§8).

**D6 — Roll-forward invariant (architectural characterization).** Reverting PR 5.5 re-opens `OQ-AUTH-06` and its siblings; such a revert is therefore a **security-incident path, not a routine rollback** (plan §8). This is why D5 gates removal *forward* on the replacements existing, rather than treating a backward revert as a normal recovery. The rollback procedure itself (disable flag, redeploy, down-migrations) is authored in the Execution Plan §8, not here.

## Compatibility

| Authority | Effect |
|---|---|
| `ADR-022` | D1/D3/D5 refine §Dependency order (4→6) and §Authorization migration ("JWT scope live before the membership branch is removed"); D4 restates §4/§Compatibility. No contradiction; the no-runtime-change and compatibility-layer posture are preserved. |
| `ADR-023` | D1 consumes §5/§6 (scope model + discriminated claim) as PR 5.4/5.5 input; adds no data-model decision. The one gap (Hotel-Manager association) is surfaced in Risks and routed to existing open items, not resolved. |
| `IMPLEMENTATION_EXECUTION_PLAN.md` | Resolves the §3 `[OPEN]` marker and the §9 ledger row. Consistent with §2 (PR breakdown), §5 (integration-branch checkpoints), §8 (rollback). Operational detail stays in §2/§6/§7/§8; this record references it rather than duplicating it. Epic numbering unchanged. |
| FROZEN specs (`SPEC-JOB-DISPATCH-001`, `SPEC-AUTH-001`, `SPEC-USERS-001`, `SPEC-ATT-001`) | No text changed; forward-notes remain Correction-class at implementation time (`ADR-022` §Required correction-class amendments). All touched behavior is target/unbuilt — no contradiction. |
| `SPEC-EMP-001` (REVIEW) | PR 5.6/5.7 ride EMP's own build; this record adds no owned-state change. |

## Risks

- **High — Hotel-Manager scope source is an open decision, partially gating PR 5.4/5.5.** `ADR-023` fixes Regional-Manager (`HotelGroup.regional_manager_user_id`) and Admin (global) scope, but the dedicated-Hotel-Manager-per-hotel association (`OD-CRM-01` residual / `REQ-CRM-006`/`RULE-CRM-07`) and the `UserRole` Regional-Manager distinction (`OD-CRM-05`) remain open/unbuilt (`.claude/knowledge/DECISION_INDEX.md`). *Mitigation:* PR 5.4/5.5 may enforce Regional-Manager + Admin scope from `ADR-023` data immediately; the Hotel-Manager sub-case is blocked on those existing open items and must **not** be invented in the flip (Constitution: never convert an assumption into a requirement). This sits inside the 5.1→5.4 chain and does not alter D1.
- **High — authorization gap if the flags flip out of order.** *Mitigation:* the D5 standing invariant — JWT scope live (PR 5.4) before the membership branch is removed (PR 5.5).
- **Medium — `SPEC-EMP-001` is unfrozen with open decisions.** *Mitigation:* PR 5.6/5.7 gated on EMP's own G2 (`ADR-022` §Risks P1).
- **Medium — four FROZEN specs carry roster/`checkHotelAccess` references.** *Mitigation:* ADR-021-style Correction discipline at implementation (`ADR-022` §Required correction-class amendments).
- **Medium — a partially-applied Epic 5 leaves `main` inconsistent.** *Mitigation:* the plan §5 integration-branch exception; merge only at coherent checkpoints.

## Scope note

This record settles Epic 5 cutover *sequencing and topology* only. It authors no code, freezes/amends no specification, performs no knowledge-layer reclassification, and makes no product decision. Operational execution policy (parallel-run, rollback, snapshot, checkpoints) remains in `IMPLEMENTATION_EXECUTION_PLAN.md`. On ratification, registration in `.claude/knowledge/DECISION_INDEX.md` and any knowledge-artifact annotations are the standard post-ratification steps (the `ADR-022`/`ADR-023` precedent).
