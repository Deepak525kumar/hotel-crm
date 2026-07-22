# ADR-026: Quality `Rating` Scale — Rescaled to 0–100 to Match Confirmed Authority

- **Status:** Accepted (corrected 2026-07-22, same session, pre-merge). This record was originally authored and briefly committed as "1–5 remains canonical, overriding `CONFIRMED_REQUIREMENTS_REGISTER.md` §15/`TRULE-001`." That framing misattributed an authority-override decision to the project owner without first surfacing the conflict to them. On being flagged, the human was asked directly and **explicitly chose to defer to the pre-existing confirmed requirement**: the score is rescaled to 0–100 to match `TRULE-001`, not retained at 1–5. Because this ADR was authored and committed only within this same unmerged branch/session (`claude/epic-5-verification-next-u5tet9`, commit `01ffa3e`, not yet merged to `main`), the correction is made in place — amending this record's content and status history — rather than left standing as a wrong "Accepted" record with a separate superseding ADR layered on top. See `IMPLEMENTATION_EXECUTION_PLAN.md` §9 and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` (`SIR-QUAL-001`/`SIR-GLOB-003`) for the synchronized correction.
- **Date:** 2026-07-22 (original authoring); correction same date, same session.
- **Scope:** Data model / implementation of an already-confirmed requirement — resolves `SPEC-QUAL-001` `OQ-01` (headline, blocking): the shipped 1–5 `Rating.score` model is rescaled to 0–100 to match `CONFIRMED_REQUIREMENTS_REGISTER.md` §15's target statement (`TRULE-001`). Also closes the quality half of `SIR-GLOB-003`'s aggregated decision-required row and `SIR-QUAL-001`.
- **Supersedes:** none as a separate document; this is a direct correction of this same ADR's original (never-merged) content, per the note above.
- **Change class:** This is **not** a Constitution §20 override of confirmed authority — it is the ordinary resolution of an open question (`OQ-01`) in favor of already-confirmed authority (`TRULE-001`). No human decision was required to "authorize an override," because no override is being made; the human's role here was simply to confirm which of two conflicting readings to implement, and they chose the one that matches `TRULE-001`. Recorded as a Decision Record per Constitution §6/§7 because it settles a headline open design question and gates implementation planning, same class as `ADR-011`/`ADR-023`/`ADR-025`.

## Problem

`SPEC-QUAL-001` (FROZEN, v0.2.0) records `OQ-01` as its headline open decision: the live, shipped `Rating` model stored a 1–5 star score (`backend/prisma/schema.prisma`; `Rating.score` int 1..5, `RULE-006`; `quality/types.ts:18`), while the confirmed-authority target statement (`CONFIRMED_REQUIREMENTS_REGISTER.md` §15, `TRULE-001`) states the score is "0–100; NO 5-star system exists." `MIG-GAP-01` classifies the shipped-vs-target contradiction as **BREAKING**. Analytics (`SPEC-ANALYTICS-001`) and the leaderboard read the same `WorkerOverallRating.average_score`, itself derived by DB trigger from `Rating.score` — see `SIR-QUAL-001`/`SIR-GLOB-003`.

A prior pass in this session resolved `OQ-01` by claiming the project owner had ratified "1–5 stays, `TRULE-001` is overridden for this surface" — but the owner was never shown the actual conflict (a confirmed requirement vs. a proposed retention) before giving a general instruction about the rating scale. That is not a legitimate basis for recording a Constitution §20 override of confirmed authority. The conflict was surfaced to the human directly; they chose to defer to `TRULE-001`.

## Decision

1. **The stored, authoritative representation of a quality rating is rescaled to the 0–100 integer scale**, matching `CONFIRMED_REQUIREMENTS_REGISTER.md` §15/`TRULE-001` exactly. `Rating.score`'s validation bound (`RULE-006`, `quality/service.ts`, `quality/types.ts` `CreateRatingSchema`) moves from `1..5` to `0..100`; the DB `CHECK` constraint (`Rating_score_range`) moves from `score >= 1 AND score <= 5` to `score >= 0 AND score <= 100`.
2. **Existing data is migrated, not discarded.** A real SQL data migration multiplies every existing `Rating.score` value by 20 before the `CHECK` constraint is tightened, preserving each rating's relative meaning under a linear mapping (1 star → 20, 2 → 40, 3 → 60, 4 → 80, 5 star → 100). This is a straight range-widening of validation plus a linear rescale of existing rows, not a replacement of the `Rating` entity.
3. **`WorkerOverallRating.average_score`** is a DB-trigger-maintained `AVG(Rating.score)` with no hardcoded 1–5 assumption in the trigger function itself (`refresh_worker_overall_rating`, `20260613120000_v2_marketplace_init/migration.sql`); it recomputes correctly under the new 0–100 domain once the underlying `Rating.score` values are rescaled — the migration's `UPDATE` on `Rating` fires the existing `AFTER UPDATE` trigger per row, refreshing every affected worker's aggregate automatically. No trigger-function change is required.
4. **`CONFIRMED_REQUIREMENTS_REGISTER.md` §15/`TRULE-001` is implemented, not overridden.** This record makes no exception to any confirmed-authority statement; it resolves the `OQ-01` open question the confirmed corpus itself flagged, in the direction the confirmed corpus already specifies.

## Grounding facts (verified against repository authority)

- `backend/prisma/schema.prisma`: `Rating.score Int` — application-level `1..5` guard (`quality/service.ts` `createRating`, `RULE-006`) and DB `CHECK` (`Rating_score_range`, `20260613120000_v2_marketplace_init/migration.sql:573-576`) — both moved to `0..100` by this record's implementation.
- `docs/03-modules/quality/MODULE_SPEC.md` `OQ-01`, `MIG-GAP-01`, `TRULE-001`: the exact contradiction this record resolves.
- `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-QUAL-001` and the quality clause of `SIR-GLOB-003`: both name `OQ-01` as the headline blocker on quality implementation planning; both are closed by this record (see Consequences).
- `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` §9 ledger: "QUAL OQ-01 (1-5 vs 0-100 rating) — Blocks QUAL implementation planning — Decision Record" — this record is that Decision Record, resolved as 0–100.

## Compatibility

| Authority | Effect |
|---|---|
| `CONFIRMED_REQUIREMENTS_REGISTER.md` §15 / `TRULE-001` | Implemented as-is. No exception, no override. |
| `SPEC-QUAL-001` (FROZEN) | `OQ-01`, `MIG-GAP-01`, and `TRULE-001`'s cross-reference resolve to "rescaled to 0–100, confirmed-authority-compliant" at the spec's next revision — a Correction-class forward-note, not made by this record (`ADR-025` precedent). |
| `SPEC-ANALYTICS-001` (FROZEN) | Unaffected structurally; `WorkerOverallRating.average_score`'s domain widens from `[1,5]` to `[0,100]`, matching what `QualityVerification.score` already used. Any analytics code that assumed `average_score <= 5` must be checked at implementation time — none currently exists (analytics reads `average_score` as an opaque `Float`, see analytics module inspection). |
| `IMPLEMENTATION_EXECUTION_PLAN.md` §3/§9 | `QUAL OQ-01` row updated in this same governance pass from "1-5 override" to "RESOLVED — 0-100, matches `TRULE-001`, `ADR-026`." |

No blocking contradiction found against any other checked authority.

## Consequences

- `SIR-QUAL-001` and the quality clause of `SIR-GLOB-003` are marked RESOLVED (0–100, matching `TRULE-001`) in the same governance pass that corrects this ADR.
- `SPEC-QUAL-001` gains, at its next revision, the resolved `OQ-01` disposition (0–100, confirmed-authority-compliant) in its Owned State / Migration Gap sections.
- **This record does authorize a runtime/schema change**, unlike the original (wrong) version of this ADR: `RULE-006`'s validation bound, `Rating_score_range`'s `CHECK` constraint, a new migration rescaling existing `Rating.score` rows ×20, and `quality/types.ts`'s `CreateRatingSchema`/`Rating` type all move to 0–100 as part of implementing this decision.
- `DECISION_INDEX.md`'s `ADR-026` row is corrected in the same governance pass to describe the 0–100 outcome.
