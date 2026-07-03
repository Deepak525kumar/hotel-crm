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
| Modular monolith | Documented backend architecture claim | `README.md`, `backend/src/modules/` | Requires Decision Record confirmation |
| Worker | User role token `WORKER` | `backend/prisma/schema.prisma` | Definition unresolved |
| Checker | User role token `CHECKER` | `backend/prisma/schema.prisma` | Definition unresolved |
| Manager | User role token `MANAGER` | `backend/prisma/schema.prisma` | Definition unresolved |
| Admin | User role token `ADMIN` | `backend/prisma/schema.prisma` | Definition unresolved |
| Work request | Named backend module and Prisma domain concept | `backend/src/modules/work-requests/`, `backend/prisma/schema.prisma` | Definition unresolved |
| Work application | Named backend module and Prisma domain concept | `backend/src/modules/work-applications/`, `backend/prisma/schema.prisma` | Definition unresolved |

## Alias and Deprecation Rules

Record approved term, aliases, deprecated terms, replacement, effective decision/version, and migration deadline. Do not normalize similar-looking documentation module names to code modules without evidence.
