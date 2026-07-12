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
| ADR-011 | Hotels and Scheduling Capability Ownership (No Standalone Modules) | Accepted | `../../docs/09-decisions/architecture-decisions/ADR-011-hotels-and-scheduling-capability-ownership.md` | Module/ownership boundaries — Hotels capability owned by `backend-crm`/`SPEC-CRM-001`; Scheduling capability owned by `backend-calendar`/`SPEC-CALENDAR-001`; no `SPEC-HOTELS-001`/`SPEC-SCHEDULING-001` | — (closes `OD-CRM-06`/`SIR-CRM-006` ambiguity) |
| ADR-012 | Contracts Capability Ownership (HR Bounded Context) | Accepted | `../../docs/09-decisions/architecture-decisions/ADR-012-contracts-ownership-hr-bounded-context.md` | Module/ownership boundaries — Contracts capability (contract lifecycle, templates, generation, metadata, versions, amendments, signatures, manager confirmation, acceptance workflow, renewals, expiry, archival state) owned by `backend-hr`/`SPEC-HR-001`; no `SPEC-CONTRACTS-001`/`backend-contracts`; Onboarding/Employee Management/Documents/Payslips/Compliance consume, not own | — (closes `OD-HR-01a`/`OD-HR-01b`/`SIR-HR-001` ambiguity) |

## Pending Decision Records (SPEC-CRM-001)

Decisions surfaced by `docs/03-modules/crm/MODULE_SPEC.md` (SPEC-CRM-001, v0.1.1) requiring a Decision Record before target-state implementation or G2 freeze. No ADR yet exists for any of these; recorded here as pending per the Proposed Knowledge Deltas of that specification.

| Candidate | Summary | Evidence | Required action |
|---|---|---|---|
| `OD-CRM-01` | Hotel Group / Organization data-model ownership unproven — CRR §11 requires it, PDD §9.3 names no entity | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-01` | Human/architecture decision on data-model home before `REQ-CRM-006/007` implementation |
| `OD-CRM-02` | Manager hotel-write authority contradiction — route role gate includes `manager`, permission map does not | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-02` | Human decision: reconcile route/permission-map, or accept current Admin-only behavior |
| `OD-CRM-05` | Scope + Regional Manager role absent from current enum/token model | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-05` | Human/architecture decision, coordinated with `SPEC-AUTH-001`'s own scope/role proposal |
| `OD-CRM-07` | List-endpoint role gate vs. permission map disagree on WORKER/CHECKER read access | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-07` | Human decision on intended list-audience |
| `OD-CRM-10` | Shared-billing ownership for a Hotel Group undefined | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-10` | Product/architecture decision before `REQ-CRM-007` implementation |
| `OD-CRM-12` | Interface/event contract versioning scheme undefined for this module | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-12` | Architecture decision, platform-wide event/versioning policy |
| `OD-CRM-15` | Route-nesting execution coupling (CRM↔hotel-workers, also work-requests↔work-applications) — platform-wide, not CRM-scoped | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-15`; architecture review `FIND-001` | Lead Architect platform-wide Decision Record |
| `OD-CRM-16` | Pause-jobs enforcement is a one-sided cross-module contract with `job-dispatch` | `docs/03-modules/crm/MODULE_SPEC.md` `OD-CRM-16`; architecture review `FIND-002` | Bilateral Decision Record or reciprocal spec reference with `SPEC-JOB-DISPATCH-001` |

## Pending Decision Records (SPEC-DOCUMENTS-001)

Decisions surfaced by `docs/03-modules/documents/MODULE_SPEC.md` (SPEC-DOCUMENTS-001, v0.1.2) requiring a Decision Record before target-state implementation or G2 freeze. No ADR yet exists for any of these; recorded here as pending per the Proposed Knowledge Deltas of that specification. Two items (`OD-DOC-005` permission-half, `OD-DOC-007`) additionally block G2 Specification Freeze per the G4 Security review round — see `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-DOC-005`/`SIR-DOC-007`.

| Candidate | Summary | Evidence | Required action |
|---|---|---|---|
| `OD-DOC-001` | GDPR retention-tier assignment for general uploaded documents and work-permit documents is unstated by CRR/PDD | `docs/03-modules/documents/MODULE_SPEC.md` `OD-DOC-001` | Human/product decision on Tier 2 vs. Tier 3 (or a document-type-specific split) |
| `OD-DOC-002` | Special-category document-type applicability (CRR §27 names fields, not document types) is unconfirmed | `docs/03-modules/documents/MODULE_SPEC.md` `OD-DOC-002` | Human/product decision before any special-category-classified document type is introduced |
| `OD-DOC-005` | Document category taxonomy + permission/access-control granularity — permission-half **blocks G2** | `docs/03-modules/documents/MODULE_SPEC.md` `OD-DOC-005` | Human/architecture decision on the downstream RBAC/management-chain model, coordinated with the self-scoping discipline already required on every `IF-DOC-*` interface |
| `OD-DOC-007` | No document-level RBAC/permission model exists beyond self-upload and manager-on-behalf-of-worker — **blocks G2** | `docs/03-modules/documents/MODULE_SPEC.md` `OD-DOC-007` | Human/architecture decision, same scope as `OD-DOC-005` |
| `OD-DOC-008` | Version history, document relationships, and archival mechanics have zero CRR/PDD textual basis — whether these responsibilities are confirmed or descoped from the module boundary | `docs/03-modules/documents/MODULE_SPEC.md` `OD-DOC-008` | Human/product decision; may require a future revision to formally descope if never confirmed |
| `OD-DOC-014` | Module owner unassigned; no `backend-documents` module id is registered anywhere (no code exists yet) | `docs/03-modules/documents/MODULE_SPEC.md` `OD-DOC-014`; tracked under the existing `SYNC-001`/`SIR-GLOB-001` umbrella, not a new item | Human ownership assignment |

## Pending Decision Records (Chatbot / Onboarding boundary)

Discovered by a Boundary Collision Gate (G1.5) run for a proposed `SPEC-CHATBOT-001` (`SYNC-027`). No ADR yet exists. Recorded here, mirroring the pattern used for the now-resolved `SPEC-HR-001`/Onboarding/`SPEC-CONTRACTS-001` boundary (`ADR-012`), so a future session sees the requirement immediately instead of rediscovering it.

| Candidate | Summary | Evidence | Required action |
|---|---|---|---|
| `SIR-GLOB-015` | Chatbot capability-ownership conflict — `docs/03-modules/onboarding/MODULE_SPEC.md` claims first-person execution ownership of the AI-agent document-collection chatbot (provider, model, conversation loop, cost controls — Sec 3 line 45, Sec 5 item 3 line 86, Sec 6.3 lines 142-160, Sec 18 line 498) for the identical capability the repository separately registers as its own module id `backend-chatbot` (`MODULE_REGISTRY.yaml:202-212`; `PIVOT_DESIGN_DOCUMENT.md` §2.2 line 44 lists "chatbot (placeholder)" as its own current module, parallel to "geo (placeholder)"). `docs/03-modules/documents/MODULE_SPEC.md` independently assumes the opposite reading, treating `backend-chatbot` as a distinct capability. A proposed `SPEC-CHATBOT-001` was blocked at the pre-authoring Boundary Collision Gate (G1.5) rather than authored, to avoid adding a second competing claim. | `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-GLOB-015`; `docs/03-modules/onboarding/MODULE_SPEC.md:45,86,142-160,498`; `docs/03-modules/documents/MODULE_SPEC.md` (Chatbot disclaimer); `.claude/knowledge/SYNC_STATE.yaml` `SYNC-027` | Human/architecture Decision Record (ADR), structurally analogous to `ADR-011`/`ADR-012`, settling whether Chatbot becomes/remains a standalone module (`backend-chatbot`) that Onboarding consumes through an interface contract, or Onboarding retains first-person chatbot-execution ownership and `backend-chatbot` is retired or re-labeled as an alias. Required before any `SPEC-CHATBOT-001` is authored, or the onboarding spec's chatbot-related sections reach G2 freeze. |

## Unratified Architecture Claims

| Candidate | Repository claim | Evidence | Required action |
|---|---|---|---|
| `ADR-PENDING-001` | Backend follows a modular-monolith architecture | `README.md`, `backend/src/modules/` | Resolved by **ADR-003** (Modular Monolith Architecture). These `ADR-PENDING-*` entries are informal placeholders, not ratified ADRs, so ADR-003 records `Supersedes: none`. Decision Record now exists in `Proposed` status; ratification remains a human decision (see `.claude/CHANGELOG.md` Known Limitations). |
| `ADR-PENDING-002` | PostgreSQL/Prisma is the primary persistence approach | `README.md`, `backend/prisma/schema.prisma` | Resolved by **ADR-004** (Prisma ORM) and **ADR-005** (PostgreSQL Database). Informal placeholders, not ratified ADRs. Decision Records now exist in `Proposed` status; ratification remains a human decision. |
| `ADR-PENDING-003` | AWS/Docker is the production deployment approach | `README.md`, `docker-compose.prod.yml`, deployment scripts | Resolved by **ADR-006** (AWS Deployment Architecture), scoped to EC2 + PM2 + Nginx with external `DATABASE_URL`; RDS and container orchestration recorded as UNKNOWN. Informal placeholder, not a ratified ADR. Decision Record now exists in `Proposed` status; ratification remains a human decision. |

Decision Records for the three former `ADR-PENDING-*` candidates now exist under `docs/09-decisions/architecture-decisions/` in `Proposed` status. Because the `ADR-PENDING-*` entries were informal candidates rather than ratified Decision Records, the new ADRs record `Supersedes: none` (they resolve/close the placeholders rather than supersede a prior ADR). Ratification and owner assignment remain reserved human authority; until ratified, these records document current state and do not constitute immutable architecture law.
