# Archived: pre-pivot Hotels design package

**Archived 2026-08-22** from `docs/` (repository root of the docs tree) during the documentation
synchronization pass. These are historical evidence only — see `.claude/CLAUDE.md`, Repository
Rules: *"Treat `docs/legacy/` and equivalent archive paths as historical evidence only."*

## What these are

Three documents dated **2026-06-03**, written as the readiness gate for a standalone Hotels
module that was never built as such:

| File | What it was |
|---|---|
| `HOTELS_DESIGN_PATCH_V1.md` | Design patch over the original Hotels module design |
| `HOTELS_IMPLEMENTATION_OVERRIDE_SHEET.md` | Implementation override sheet for the same |
| `HOTELS_IMPLEMENTATION_READINESS_REPORT.md` | Principal-architect readiness gate before handoff |

## Why they were archived rather than kept or deleted

- **Superseded.** `ADR-011` (Accepted) settled that there is **no standalone Hotels module and no
  `SPEC-HOTELS-001`** — the Hotels capability is owned by the CRM bounded context
  (`backend-crm` / `SPEC-CRM-001`). The live redirect marker is
  [`docs/03-modules/hotels/README.md`](../../03-modules/hotels/README.md).
- **Internally broken.** The readiness report reviews three documents that do not exist anywhere in
  the repository — `HOTELS_MODULE_DESIGN.md`, `HOTELS_ENDPOINT_SPEC.md`, and
  `HOTELS_IMPLEMENTATION_CHECKLIST.md` — so it cannot be followed as written.
- **Dead code paths.** They cite `backend/src/middleware/requireHotelScope.ts` and
  `backend/src/types/express.d.ts`, neither of which exists.
- **Unreferenced.** No document outside this directory linked to any of the three.

Deleting them would have destroyed the only record of the pre-`ADR-011` Hotels design intent, so
they are archived instead. **Do not treat anything here as current.** For the Hotels capability as
it actually exists, read `docs/03-modules/crm/MODULE_SPEC.md`.
