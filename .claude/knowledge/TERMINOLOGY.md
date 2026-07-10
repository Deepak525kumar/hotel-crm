# Terminology

**Status:** Seed inventory; no project term becomes canonical without authoritative confirmation.

## Framework Terms

| Term | Definition |
|---|---|
| Current state | Reproducible behavior/content at an identified repository revision. |
| Target state | Approved intended behavior in a frozen specification or decision. |
| Frozen specification | Versioned target-state artifact with approval and no blocking issue. |
| Module | Cohesive owned unit with an explicit responsibility and boundary. |
| Contract | Versioned interface governing interaction between a producer and consumer. |
| Foundation | Architecture, terminology, business rules, shared templates, constitution, and ownership. |
| Drift | Evidence that sources or dependents no longer agree with approved truth. |
| Gate | Mandatory evidence-based decision point returning a defined status. |
| Validation | Independent confirmation that a candidate meets approved criteria; not author review. |

## Project Term Candidates

| Term | Observed meaning | Evidence | Canonical status |
|---|---|---|---|
| Hotel CRM | Repository/product name | `README.md`, `package.json` | Provisional |
| Modular monolith | Documented backend architecture claim | `README.md`, `backend/src/modules/` | Recorded in ADR-003 (Proposed); pending human ratification |
| Worker | User role token `WORKER` | `backend/prisma/schema.prisma` | Definition unresolved. `[TARGET]` CONFIRMED §1/PIVOT §4.1 confirm a 5th role (Regional Manager) is being added; none of the resulting 5 roles is formally defined beyond the bare `UserRole` enum token (`SPEC-AUTH-001`) |
| Checker | User role token `CHECKER` | `backend/prisma/schema.prisma` | Definition unresolved. `[TARGET]` see Worker row note (`SPEC-AUTH-001`) |
| Manager | User role token `MANAGER` | `backend/prisma/schema.prisma` | Definition unresolved. `[TARGET]` see Worker row note (`SPEC-AUTH-001`) |
| Admin | User role token `ADMIN` | `backend/prisma/schema.prisma` | Definition unresolved. `[TARGET]` see Worker row note (`SPEC-AUTH-001`) |
| Work request | Named backend module and Prisma domain concept | `backend/src/modules/work-requests/`, `backend/prisma/schema.prisma` | Definition unresolved |
| Work application | Named backend module and Prisma domain concept | `backend/src/modules/work-applications/`, `backend/prisma/schema.prisma` | Definition unresolved |
| Session | `Session` Prisma model — one active refresh-token grant per login/signup, rotated in place on refresh, deleted on logout/password-reset; sole-owned by `backend-auth` | `backend/prisma/schema.prisma`, `SPEC-AUTH-001` | Definition unresolved (proposed by `SPEC-AUTH-001`, not yet ratified) |
| Access token | Short-lived HS256 JWT carrying `{sub,email,role,permissions}`, presented as a `Bearer` header | `backend/src/lib/jwt.ts`, `SPEC-AUTH-001` | Definition unresolved (proposed by `SPEC-AUTH-001`) |
| Refresh token | Long-lived HS256 JWT carrying `{sub,type:'refresh'}`, exchanged via `POST /auth/refresh`, backed 1:1 by a `Session` row | `backend/src/lib/jwt.ts`, `SPEC-AUTH-001` | Definition unresolved (proposed by `SPEC-AUTH-001`) |
| `auth-middleware` | In-process contract exposing `authMiddleware`/`optionalAuthMiddleware`; owned by `backend-auth`; consumed by every other active backend module | `backend/src/middleware/auth.ts`, `DEPENDENCY_GRAPH.yaml` | Definition unresolved (proposed by `SPEC-AUTH-001`) |
| `permissions-middleware` | In-process contract exposing `requireRole`/`requirePermission`/`checkHotelAccess`; owner `unassigned`, distinct from `auth-middleware`, not consumed by `backend-auth` itself | `backend/src/middleware/permissions.ts`, `DEPENDENCY_GRAPH.yaml` | Definition unresolved (proposed by `SPEC-AUTH-001`) |
| Scope | `[TARGET]` the hotel or hotel-group a user may act within, carried on the access token alongside `user_id`/`role`; not present in any current token | `PIVOT_DESIGN_DOCUMENT.md` §5.3, `SPEC-AUTH-001` | Target term, unbuilt (proposed by `SPEC-AUTH-001`; `SPEC-CRM-001` uses this term consistently as a secondary source, not a competing definition — canonical-source attribution remains `SPEC-AUTH-001` pending human/Lead Architect confirmation, per `SPEC-CRM-001` `FIND-CONS-CRM-003`) |
| Regional Manager | `[TARGET]` a new role, not present in `UserRole` today; sees Hotel-Manager-shaped data across an entire Hotel Group | `CONFIRMED_REQUIREMENTS_REGISTER.md` §1, `PIVOT_DESIGN_DOCUMENT.md` §4.1, `SPEC-AUTH-001` | Target term, no code representation yet (proposed by `SPEC-AUTH-001`; `SPEC-CRM-001` uses this term consistently as a secondary source, not a competing definition — canonical-source attribution remains `SPEC-AUTH-001` pending human/Lead Architect confirmation, per `SPEC-CRM-001` `FIND-CONS-CRM-003`) |
| Hotel (Property) | An operating property of FHM Hotelservice GmbH; the durable reference record owned by `backend-crm` and read by scheduling/roster/dispatch/attendance/quality | `backend/prisma/schema.prisma:175`, `SPEC-CRM-001` | Definition unresolved (proposed by `SPEC-CRM-001`, not yet ratified) |
| Hotel Group (Organization) | `[TARGET]` a set of hotels administered together under one Regional Manager, with shared billing; no first-class data model exists yet (data-model home open, `SPEC-CRM-001` `OD-CRM-01`) | `CONFIRMED_REQUIREMENTS_REGISTER.md` §11, `PIVOT_DESIGN_DOCUMENT.md` §4.3, `SPEC-CRM-001` | Target term, unbuilt (proposed by `SPEC-CRM-001`) |
| Pause new jobs | `[TARGET]` a per-hotel boolean toggle that suspends new job creation for that hotel without deactivating it; not implemented (no field, no route) | `CONFIRMED_REQUIREMENTS_REGISTER.md` §11, `SPEC-CRM-001` | Target term, unbuilt (proposed by `SPEC-CRM-001`) |
| Soft-delete | Deactivation that sets `is_active=false` and records `deleted_at`, preserving the row and its history; used platform-wide, canonically defined for `Hotel` by `SPEC-CRM-001` | `backend/src/modules/crm/service.ts:101-108`, `SPEC-CRM-001` | Definition unresolved (proposed by `SPEC-CRM-001`, not yet ratified) |

## Knowledge-Index Status Vocabulary

Canonical tokens used by `MODULE_REGISTRY.yaml` and `DEPENDENCY_GRAPH.yaml`. These are observed-state classification tokens derived from repository evidence; they are not product decisions.

| Field | Token | Definition |
|---|---|---|
| `lifecycle` | `active` | Module is implemented and wired into the running application (e.g. route-registered). |
| `lifecycle` | `declared` | Module directory exists but the module is not yet wired into the application. |
| `implementation_status` | `active` | Implemented with source and a corresponding test. |
| `implementation_status` | `active-no-tests` | Implemented and wired, but no dedicated test file was found. |
| `implementation_status` | `unimplemented-stub` | Directory contains only a placeholder; no functional code; not registered. |
| `implementation_status` | `not-applicable` | Entry is not a backend service module (e.g. an infrastructure surface). |
| `owner` | `unassigned` | No accountable owner is encoded in the repository; assignment is reserved human authority (SYNC-001). Equivalent in prose to `UNKNOWN`. |
| `published_events` / `consumed_events` | `none-observed` | No event publication/consumption observed; no event bus exists in the codebase. |
| `specification` | `UNKNOWN` | No frozen module specification maps to this module. |
| index `status` | `verified-inventory` | Module inventory is verified against the worktree at the observed revision. |
| index `status` | `verified-edges` | Code-level dependency edges are verified against the worktree at the observed revision. |

`unassigned` (a YAML field value) and `UNKNOWN` (a prose claim status) denote the same absence-of-evidence condition; either is acceptable, and neither may be replaced with an invented value.

## Alias and Deprecation Rules

Record approved term, aliases, deprecated terms, replacement, effective decision/version, and migration deadline. Do not normalize similar-looking documentation module names to code modules without evidence.
