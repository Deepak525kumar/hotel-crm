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
| Worker | User role token `WORKER` | `backend/prisma/schema.prisma` | Definition unresolved |
| Checker | User role token `CHECKER` | `backend/prisma/schema.prisma` | Definition unresolved |
| Manager | User role token `MANAGER` | `backend/prisma/schema.prisma` | Definition unresolved |
| Admin | User role token `ADMIN` | `backend/prisma/schema.prisma` | Definition unresolved |
| Work request | Named backend module and Prisma domain concept | `backend/src/modules/work-requests/`, `backend/prisma/schema.prisma` | Definition unresolved |
| Work application | Named backend module and Prisma domain concept | `backend/src/modules/work-applications/`, `backend/prisma/schema.prisma` | Definition unresolved |

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
