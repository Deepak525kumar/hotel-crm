# Project Profile: Hotel CRM

**Profile status:** Provisional repository-derived baseline; ownership and architecture decisions require formal confirmation

## Repository Phase: Implementation Mode (entered 2026-07-20, human decision)

All ten implementation-backed module specifications are G2 FROZEN (see `SPECIFICATION_INDEX.yaml`); the discoverability/Module-Memory backfill pass closed the last open documentation-synchronization gap (PR #176, merged). The commissioning human has explicitly ended the documentation-authoring loop at this point and directed the repository into **Implementation Mode**:

- **Documentation is locked** — no further specification authoring, freezing, ADR creation, or repository-wide documentation audits are to be initiated proactively. The only documentation changes permitted going forward are **corrections discovered as a byproduct of implementation work** (e.g., a spec's stale citation found while writing code against it), applied narrowly to the affected section, not as a standalone documentation pass.
- **Implementation sequencing authority** is `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` (epic order, PR order, dependency graph, branch strategy, Definition of Done, testing/rollback strategy) — consult it before starting new implementation work instead of re-deriving priority order.
- **First implementation target (human-confirmed):** `SPEC-JOB-DISPATCH-001`'s unguarded `PATCH /assignments/:id` (OQ-01/FIND-SEC-001, Critical).
- This note itself is a project-specific operating-mode fact, not a framework rule change — the underlying documentation workflows in `.claude/workflows/` remain available for the narrow correction case above.

**Observed repository revision:** `5b16be40ef0aa9ac3f186e7323b960886a6153c2`

**Observed default branch:** `main` via `refs/remotes/origin/HEAD`

**Profile date:** 2026-07-04

## Repository Identity

| Fact | Status | Evidence |
|---|---|---|
| Package name is `hotel-crm-mvp` | Confirmed | `package.json` |
| Repository contains backend, web frontend, and two mobile apps | Confirmed | `backend/`, `frontend/`, `mobile/worker-app/`, `mobile/checker-app/` |
| Root package uses npm workspaces | Confirmed | `package.json` |
| Repository describes its backend as a TypeScript/Express modular monolith | Confirmed as documented claim; decision record not found | `README.md`, `backend/src/modules/` |
| PostgreSQL schema is managed through Prisma | Confirmed | `backend/prisma/schema.prisma` |
| Production deployment material targets AWS/Docker | Confirmed as repository configuration/documentation | `docker-compose.prod.yml`, `ecosystem.config.js`, `nginx/`, `scripts/`, `deploy/` |

## Active Surfaces

| Surface | Path | Observed role |
|---|---|---|
| Backend API | `backend/` | Express/TypeScript application and Prisma data access |
| Web client | `frontend/` | Next.js application |
| Worker mobile client | `mobile/worker-app/` | Expo/React Native application |
| Checker mobile client | `mobile/checker-app/` | Expo/React Native application |
| Documentation | `docs/` | Foundation, product, architecture, modules, API, security, testing, deployment, and decisions |
| Operations | root configs, `scripts/`, `nginx/`, `deploy/` | Local/production orchestration and deployment support |

## Documentation Authority Map

- `docs/00-foundations/` contains current foundation candidates.
- `docs/01-product/` through `docs/13-testing/` contain active-structure candidates but must be classified per artifact; empty directories do not establish authority.
- `docs/14-governance/architecture-decisions/` is the designated decision area and holds the ADR corpus (ADR-001..018, Accepted status as of `DECISION_INDEX.md`), indexed in `DECISION_INDEX.md`; the prior `docs/09-decisions/` location is retired (see `docs/15-audits/ADR_INTEGRITY_RESTORATION_2026-07-16.md`). This profile is otherwise unrefreshed since 2026-07-04 (see `Profile date` above) and a full repository-synchronization pass remains pending.
- `docs/legacy/` is historical evidence only unless an approved current source explicitly promotes content.
- Root `README.md` is repository guidance and an architecture claim; it is not automatically a frozen specification or ADR.
- Nested `frontend/CLAUDE.md` and `frontend/AGENTS.md` apply to frontend-scoped work after conflict checking against higher repository policy.

## Commands Observed

| Purpose | Command source |
|---|---|
| Root development | `npm run dev` in `package.json` |
| Root build | `npm run build` in `package.json` |
| Root test | `npm test` in `package.json` |
| Root type check | `npm run type-check` in `package.json` |

Commands must still be inspected in the affected workspace before use. This table does not prove environment readiness or successful execution.

## Known Gaps Requiring Pre-flight Resolution

- Human/accountable owners are not encoded in repository evidence.
- Architecture decisions are recorded as ADR-001..018 in `docs/14-governance/architecture-decisions/` (Accepted; see `DECISION_INDEX.md`). Product-decision directory remains empty.
- Documentation contains both active and legacy trees; artifact-by-artifact authority classification is required.
- Module names in documentation and implementation are not one-to-one; do not infer equivalence.
- Dependency graph is seeded only with directly observed imports and must be extended through validated analysis.
