# ADR-026: Quality `Rating` Scale — 1–5 Remains the Canonical Stored Representation

- **Status:** Accepted. Ratified directly by the project owner (human decision, recorded 2026-07-22, session `claude/epic-5-verification-next-u5tet9`) — Constitution §20 human/product authority. This record authorizes no code change beyond what is described under Consequences; it is a decision record, not an implementation.
- **Date:** 2026-07-22
- **Scope:** Data model / product decision — resolves `SPEC-QUAL-001` `OQ-01` (headline, blocking): whether the shipped 1–5 `Rating.score` model is rescaled, replaced, or retired under `CONFIRMED_REQUIREMENTS_REGISTER.md` §15's "0–100, no 5-star system" target statement (`TRULE-001`). Also closes the quality half of `SIR-GLOB-003`'s aggregated decision-required row and `SIR-QUAL-001`.
- **Supersedes:** none. Overrides, for this specific product surface only, the confirmed-authority statement in `CONFIRMED_REQUIREMENTS_REGISTER.md` §15/PIVOT §4.6 ("the score is 0–100; NO 5-star system exists"), exercising the human's Constitution §20 authority to make product decisions that the frozen confirmed-requirements corpus itself flagged as unresolved/contradictory (`OQ-01`) rather than settled.
- **Change class:** Material product/data-model decision requiring a Decision Record per Constitution §6/§7, same class as `ADR-011`/`ADR-023`. Settles the design; `SPEC-QUAL-001`'s FROZEN text is corrected at its next revision (Correction-class forward-note), not by this record, mirroring the `ADR-025` precedent.

## Problem

`SPEC-QUAL-001` (FROZEN, v0.2.0) records `OQ-01` as its headline open decision: the live, shipped `Rating` model stores a 1–5 star score (`backend/prisma/schema.prisma:419-441`; `Rating.score` int 1..5, `RULE-006`; `quality/types.ts:18`), while the confirmed-authority target statement (`CONFIRMED_REQUIREMENTS_REGISTER.md` §15, `TRULE-001`) states the score is "0–100; NO 5-star system exists." `MIG-GAP-01` classifies the shipped-vs-target contradiction as **BREAKING**. Analytics (`SPEC-ANALYTICS-001`) and the leaderboard read the same `WorkerOverallRating.average_score`, itself derived by DB trigger from `Rating.score` (1–5 scale) — see `SIR-QUAL-001`/`SIR-GLOB-003`. No code, migration, or specification could proceed past this ambiguity without a human ruling.

## Decision

1. **The stored, authoritative representation of a quality rating remains the 1–5 integer scale** (`Rating.score`, `RULE-006`'s existing 1..5 guard). No schema rescale, no data migration, no replacement of the `Rating` entity or its `1..5` validation is authorized or required by this record.
2. **Analytics/reporting surfaces may derive a normalized percentage score** (e.g. `score / 5 * 100`) from the 1–5 stored value for presentation or cross-metric comparison purposes. Any such derivation is a read-time/report-time projection, not a new stored field, and does not change `Rating.score`'s persisted meaning or range.
3. **`CONFIRMED_REQUIREMENTS_REGISTER.md` §15 / `TRULE-001`'s "0–100, no 5-star system" statement is not implemented for this surface.** This is a deliberate, human-authorized override of that confirmed-authority statement for the `Rating` entity specifically — the human decision (Constitution §20) resolves the contradiction `OQ-01` itself identified rather than adopting the confirmed target literally. No other confirmed-authority statement is affected.
4. **`WorkerOverallRating.average_score`** (DB-trigger-maintained average of `Rating.score`) continues to be expressed on the same 1–5 scale it already uses; a normalized/derived percentage, if surfaced, is computed from it the same way as item 2, not stored as a competing field.

## Grounding facts (verified against repository authority)

- `backend/prisma/schema.prisma:419-441`: `Rating.score Int` with an application-level `1..5` guard (`quality/service.ts:92-133`, `RULE-006`) — live, shipped, unchanged by this record.
- `docs/03-modules/quality/MODULE_SPEC.md` `OQ-01` (line 554), `MIG-GAP-01` (line 494), `TRULE-001` (line 198): the exact contradiction this record resolves.
- `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-QUAL-001` (line 140) and the quality clause of `SIR-GLOB-003` (line 63): both name `OQ-01` as the headline blocker on quality implementation planning; both are closed by this record (see Consequences).
- `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` §9 ledger, line 422: "QUAL OQ-01 (1-5 vs 0-100 rating) — Blocks QUAL implementation planning — Decision Record" — this record is that Decision Record.

## Compatibility

| Authority | Effect |
|---|---|
| `CONFIRMED_REQUIREMENTS_REGISTER.md` §15 / `TRULE-001` | Explicitly overridden for the `Rating` entity by human product authority (Constitution §20); no other confirmed statement affected. |
| `SPEC-QUAL-001` (FROZEN) | `OQ-01`, `MIG-GAP-01`, `TRULE-001`'s cross-reference, and the "Rating rescaled/replaced/retired" language resolve to "retained, 1–5, unchanged" at the spec's next revision — a Correction-class forward-note, not made by this record (`ADR-025` precedent). |
| `SPEC-ANALYTICS-001` (FROZEN) | Unaffected structurally; if/when analytics derives a normalized percentage from `average_score`, that is new read-time logic, not a contract change to `WorkerOverallRating`'s stored shape. |
| `IMPLEMENTATION_EXECUTION_PLAN.md` §3/§9 | `QUAL OQ-01` row updated in this same governance pass from "Decision Record" (required) to "Resolved — `ADR-026`"; Epic 6's QUAL OQ-01-dependent PR is now sequenceable per §2 Epic 6 guidance ("author... after their Decision Records land"). |

No blocking contradiction found against any other checked authority.

## Consequences

- `SIR-QUAL-001` and the quality clause of `SIR-GLOB-003` are marked RESOLVED in the same governance pass that adds this ADR (see `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`).
- `SPEC-QUAL-001` gains, at its next revision, the resolved `OQ-01` disposition (1–5 retained) in its Owned State / Migration Gap sections.
- No runtime change, no schema migration, no code is authorized by this record beyond what a future analytics derivation (item 2) would itself require as ordinary read-time logic.
- `DECISION_INDEX.md` gains this row (`ADR-026`, Accepted) in the same governance pass.
