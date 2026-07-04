# ADR-003: Modular Monolith Architecture

## Status

**Proposed** — 2026-07-04

Deciders: Authored by AI Engineering Platform; formal ratification is reserved human authority (see `.claude/CHANGELOG.md` v1.0.0 Known Limitations).

- Supersedes: none
- Superseded by: none

This record documents the architecture currently implemented in the repository; it is not yet human-ratified.

## Context

The backend must deliver an MVP quickly with low operational cost while leaving a credible path to per-service extraction if scale later demands it.

Forces:

- Microservices add deployment, network, and debugging overhead disproportionate to a small team and MVP scope; a single deployable is cheaper and simpler to operate (`README.md:13-20`).
- Modules should still have clear internal boundaries so a module can be extracted into its own service later without a rewrite (`README.md:9`).

Current-state facts:

- The README titles the system "Modular Monolith Architecture" and describes "a single Express.js + TypeScript application with clearly separated internal modules … designed to be extracted into a future microservice if needed, but runs in-process for MVP" (`README.md:1,9`).
- The v1 API router registers 13 in-process modules: `auth`, `users`, `crm`, `hotel-workers`, `work-requests`, `work-applications`, `assignments`, `attendance`, `quality`, `hr`, `notifications`, `analytics`, `calendar` (`backend/src/routes/v1/index.ts:4-34`).
- Two module directories exist but are empty stubs (each contains only `.placeholder`) and are NOT registered in the router: `backend/src/modules/chatbot/` and `backend/src/modules/geo/`. The README lists AI chatbot and geolocation as deferred Phase 2+ scope (`README.md:369-376`).
- The Constitution preserves the existing architectural style until an approved Decision Record changes it (`.claude/constitution/ENGINEERING_CONSTITUTION.md:78`).

## Decision

The backend is a modular monolith: a single Express.js + TypeScript application whose business logic is organized into in-process modules with explicit route boundaries, each designed for possible future extraction into a separate service. This ADR records the existing implemented state.

Scope and precision:

- 13 modules are implemented and route-registered (`backend/src/routes/v1/index.ts:4-34`).
- `chatbot` and `geo` are declared-but-unimplemented stubs (directories contain only a `.placeholder`, not route-registered) and are recorded as deferred Phase 2+ scope, not as current modules.

## Consequences

Positive:

- Single deployment, in-process calls (no inter-service network hop), and simpler debugging/logging (`README.md:13-20`).
- Module boundaries preserve an extraction path to microservices without an upfront rewrite (`README.md:9`).

Negative:

- A monolith shares one runtime and one failure domain; a fault in one module can affect the whole process.
- Boundary discipline is enforced by convention/review, not by process isolation; the Constitution's boundary rules must be actively upheld (`.claude/constitution/ENGINEERING_CONSTITUTION.md:76-77`).

Neutral / operational:

- Deferred modules (`chatbot`, `geo`) exist as empty stubs; their presence should not be read as implemented capability.
- Any change of architectural style requires a new approved Decision Record (`.claude/constitution/ENGINEERING_CONSTITUTION.md:78`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| Modular monolith (chosen) | Single app, in-process modules with extraction-ready boundaries | Matches implemented state; lowest ops cost and complexity for MVP (`README.md:9-20`) |
| Microservices | Independently deployed services per domain | Higher deployment, network, and debugging overhead for the team size and MVP timeline (`README.md:13-20`) |
| Unstructured monolith | Single app with no internal module boundaries | Forecloses future extraction and weakens ownership/boundary discipline the Constitution requires (`.claude/constitution/ENGINEERING_CONSTITUTION.md:76-77`) |
| Status quo (no recorded decision) | Leave the architecture as an unratified README claim | The style must be anchored in a Decision Record to be treated as architecture law (`.claude/constitution/ENGINEERING_CONSTITUTION.md:69,78`) |

## Related Documents

- [Project README](../../../README.md)
- [Engineering Constitution](../../../.claude/constitution/ENGINEERING_CONSTITUTION.md)
- [Module Registry](../../../.claude/knowledge/MODULE_REGISTRY.yaml)
- [Dependency Graph](../../../.claude/knowledge/DEPENDENCY_GRAPH.yaml)
- [ADR-004: Prisma ORM](ADR-004-prisma-orm.md)
- [ADR-005: PostgreSQL Database](ADR-005-postgresql-database.md)
- [ADR-006: AWS Deployment Architecture](ADR-006-aws-deployment-architecture.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| System is described as a modular monolith (single Express + TS app, in-process modules, extractable later) | Confirmed | `README.md:1,9` |
| 13 modules are route-registered in the v1 router | Confirmed | `backend/src/routes/v1/index.ts:4-34` |
| `chatbot` is an empty, unregistered stub | Confirmed | `backend/src/modules/chatbot/` contains only `.placeholder`; absent from `backend/src/routes/v1/index.ts` |
| `geo` is an empty, unregistered stub | Confirmed | `backend/src/modules/geo/` contains only `.placeholder`; absent from `backend/src/routes/v1/index.ts` |
| AI chatbot and geolocation are deferred Phase 2+ scope | Confirmed | `README.md:369-376` |
| Existing architectural style is preserved until an approved Decision Record changes it | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:78` |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Ownership: no accountable owner is assigned for the backend or its modules (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority; module ownership assignment is a v1.0.0 known limitation (`.claude/CHANGELOG.md`).
- Ratification: this ADR is `Proposed`; ratification is reserved human authority.
- The `README.md` structure diagram (`README.md:24-63`) lists module directory names (e.g. `staffing`) that differ from the registered route modules; reconciling the documented module map with the implemented router is an open synchronization item (UNKNOWN whether intentional).
