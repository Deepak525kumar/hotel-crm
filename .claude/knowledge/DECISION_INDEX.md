# Decision Index

## Index Rules

Decision records belong in the project’s authoritative decision directory and use `ADR-*`. This index records status and links; it does not restate decisions.

| Decision ID | Title | Status | Source | Affected scope | Supersedes |
|---|---|---|---|---|---|

## Unratified Architecture Claims

| Candidate | Repository claim | Evidence | Required action |
|---|---|---|---|
| `ADR-PENDING-001` | Backend follows a modular-monolith architecture | `README.md`, `backend/src/modules/` | Confirm authority and create/locate Decision Record before treating as immutable architecture law |
| `ADR-PENDING-002` | PostgreSQL/Prisma is the primary persistence approach | `README.md`, `backend/prisma/schema.prisma` | Confirm authority and create/locate Decision Record |
| `ADR-PENDING-003` | AWS/Docker is the production deployment approach | `README.md`, `docker-compose.prod.yml`, deployment scripts | Reconcile with active infrastructure docs and create/locate Decision Record |

At the observed profile revision, `docs/09-decisions/` contained placeholders but no substantive indexed decision record. This is a gap, not permission to invent decisions.
