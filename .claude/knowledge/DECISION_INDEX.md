# Decision Index

## Index Rules

Decision records belong in the project’s authoritative decision directory and use `ADR-*`. This index records status and links; it does not restate decisions.

| Decision ID | Title | Status | Source | Affected scope | Supersedes |
|---|---|---|---|---|---|
| ADR-001 | Documentation-First Development | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-001-documentation-first-development.md` | Engineering process (all workflows) | — |
| ADR-002 | AI Engineering Platform Adoption | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-002-ai-engineering-platform-adoption.md` | Engineering operating system (`.claude/`) | — |
| ADR-003 | Modular Monolith Architecture | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-003-modular-monolith-architecture.md` | Backend architecture (`backend/`) | — |
| ADR-004 | Prisma ORM | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-004-prisma-orm.md` | Backend data access & migrations | — |
| ADR-005 | PostgreSQL Database | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-005-postgresql-database.md` | Primary datastore | — |
| ADR-006 | AWS Deployment Architecture | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-006-aws-deployment-architecture.md` | Production deployment & edge | — |
| ADR-007 | Agent-Based Engineering Workflow | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-007-agent-based-engineering-workflow.md` | Engineering execution model | — |
| ADR-008 | Source of Truth Hierarchy | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-008-source-of-truth-hierarchy.md` | Truth resolution policy | — |
| ADR-009 | Context-Artifact Token-Optimization Architecture (Platform v1.2) | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-009-context-artifact-token-optimization.md` | Engineering operating system (`.claude/`); adds Context Artifacts, gate G1.5, LOOP_CONTROL §7-8 | — |
| ADR-010 | Governance Layer for the Specification Issues Register (Platform v1.3) | Proposed | `../../docs/09-decisions/architecture-decisions/ADR-010-governance-layer-specification-issues-register.md` | Engineering operating system (`.claude/`); adds the `governance/` top-level category, the Specification Issues Register, and the `SIR-*` artifact-ID class; amends CLAUDE.md Knowledge Separation | — |

## Unratified Architecture Claims

| Candidate | Repository claim | Evidence | Required action |
|---|---|---|---|
| `ADR-PENDING-001` | Backend follows a modular-monolith architecture | `README.md`, `backend/src/modules/` | Resolved by **ADR-003** (Modular Monolith Architecture). These `ADR-PENDING-*` entries are informal placeholders, not ratified ADRs, so ADR-003 records `Supersedes: none`. Decision Record now exists in `Proposed` status; ratification remains a human decision (see `.claude/CHANGELOG.md` Known Limitations). |
| `ADR-PENDING-002` | PostgreSQL/Prisma is the primary persistence approach | `README.md`, `backend/prisma/schema.prisma` | Resolved by **ADR-004** (Prisma ORM) and **ADR-005** (PostgreSQL Database). Informal placeholders, not ratified ADRs. Decision Records now exist in `Proposed` status; ratification remains a human decision. |
| `ADR-PENDING-003` | AWS/Docker is the production deployment approach | `README.md`, `docker-compose.prod.yml`, deployment scripts | Resolved by **ADR-006** (AWS Deployment Architecture), scoped to EC2 + PM2 + Nginx with external `DATABASE_URL`; RDS and container orchestration recorded as UNKNOWN. Informal placeholder, not a ratified ADR. Decision Record now exists in `Proposed` status; ratification remains a human decision. |

Decision Records for the three former `ADR-PENDING-*` candidates now exist under `docs/09-decisions/architecture-decisions/` in `Proposed` status. Because the `ADR-PENDING-*` entries were informal candidates rather than ratified Decision Records, the new ADRs record `Supersedes: none` (they resolve/close the placeholders rather than supersede a prior ADR). Ratification and owner assignment remain reserved human authority; until ratified, these records document current state and do not constitute immutable architecture law.
