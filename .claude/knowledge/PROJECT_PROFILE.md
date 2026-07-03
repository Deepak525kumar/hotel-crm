# Project Profile: Hotel CRM

**Profile status:** Provisional repository-derived baseline; ownership and architecture decisions require formal confirmation

**Observed repository revision:** `5a5f8d3058f991448a6e1c64c611bdc04982927a`

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
- `docs/09-decisions/` is the designated decision area, but no substantive Decision Record was observed at profile creation.
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
- Architecture and product decision directories do not currently contain substantive indexed decisions.
- Documentation contains both active and legacy trees; artifact-by-artifact authority classification is required.
- Module names in documentation and implementation are not one-to-one; do not infer equivalence.
- Dependency graph is seeded only with directly observed imports and must be extended through validated analysis.
