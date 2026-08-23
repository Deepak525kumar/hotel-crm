# Documentation map

Start here. This file says what lives where, and — just as importantly — where things live that you
might expect to find here and won't.

The authority hierarchy is defined by [`ADR-008`](14-governance/architecture-decisions/ADR-008-source-of-truth-hierarchy.md).
In short: a **module specification** outranks any index that summarizes it, and a ratified **ADR**
outranks a specification it amends.

## Directory map

| Path | Holds | Authority |
|---|---|---|
| [`00-foundations/`](00-foundations/) | `CONFIRMED_REQUIREMENTS_REGISTER.md` (**CRR**) and `PIVOT_DESIGN_DOCUMENT.md` (**PDD**) | The two confirmed product authorities. Every module spec's target-state claims cite these. |
| [`02-architecture/system/`](02-architecture/system/) | Cross-cutting architecture that belongs to no single module | Specification |
| [`03-modules/`](03-modules/) | One `MODULE_SPEC.md` per bounded capability | **Primary specification authority** |
| [`04-implementation/`](04-implementation/) | Redirect marker only — content archived | See `implementation/` |
| [`05-api/`](05-api/) | HTTP API reference | Derived from code; code wins |
| [`05-execution/`](05-execution/) | Where work is (`EXECUTION_DASHBOARD`) and production readiness (`RELEASE_STATUS`) | Status, not specification |
| [`06-database/`](06-database/) | Schema and migration reference | Derived from `backend/prisma/`; schema wins |
| [`08-frontend/`](08-frontend/), [`09-mobile/`](09-mobile/) | Client application specifications | Specification |
| [`10-testing/e2e/`](10-testing/e2e/) | **The** end-to-end suite — scenarios, run logs, backlog | Mandatory entry point for any "test the app" request |
| [`11-deployment/`](11-deployment/) | Operational runbooks | Runbook |
| [`14-governance/architecture-decisions/`](14-governance/architecture-decisions/) | ADRs | **Decision authority** |
| [`15-audits/`](15-audits/) | Dated, immutable point-in-time audits | Historical evidence only |
| [`implementation/`](implementation/) | Live sequencing plan, governance register, decision backlog | Planning authority |
| [`legacy/`](legacy/) | Superseded material | **Historical evidence only — never current** |

## Where things are that aren't here

Several empty scaffold directories were removed on 2026-08-23 because they had stood empty for two
months while their subject matter was documented elsewhere. Empty scaffolding is a promise the
estate isn't keeping; this table is the honest version.

| If you're looking for | It's actually in |
|---|---|
| Product vision, roadmap, requirements | [`00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md`](00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md) and `PIVOT_DESIGN_DOCUMENT.md` |
| Security — authn, authz, auditing, GDPR | Per-module: [`auth`](03-modules/auth/MODULE_SPEC.md) (authn, sessions, throttle), [`consent`](03-modules/consent/MODULE_SPEC.md) (GDPR consent), [`compliance`](03-modules/compliance/MODULE_SPEC.md) (audit consumption), [`retention`](03-modules/retention/MODULE_SPEC.md) (erasure). Authorization model: [`ADR-030`](14-governance/architecture-decisions/ADR-030-manager-write-authority-capability-model.md), [`ADR-031`](14-governance/architecture-decisions/ADR-031-request-time-permission-derivation-and-token-revocation.md). |
| Infrastructure and deployment | [`11-deployment/`](11-deployment/), `deploy/` at the repository root, and [`ADR-006`](14-governance/architecture-decisions/ADR-006-aws-deployment-architecture.md) |
| Compliance | [`03-modules/compliance/MODULE_SPEC.md`](03-modules/compliance/MODULE_SPEC.md) |
| Backend / frontend / mobile architecture | The module specs, plus [`ADR-003`](14-governance/architecture-decisions/ADR-003-modular-monolith-architecture.md) (modular monolith) and [`ADR-029`](14-governance/architecture-decisions/ADR-029-transactional-outbox-and-worker-runtime.md) (Platform Worker) |
| Backend / frontend / integration / mobile test plans | Tests live with the code (`backend/src/__tests__/`, `frontend/__tests__/`, `frontend/e2e/`). The only *documented* suite is [`10-testing/e2e/`](10-testing/e2e/README.md). |
| Architecture diagrams | State machines: [`03-modules/onboarding/diagrams/`](03-modules/onboarding/diagrams/). A root `architecture/` directory existed holding only placeholder `.drawio` stubs and was removed 2026-08-23. |

## Modules that deliberately have no specification

- **Hotels** → owned by CRM. See [`03-modules/hotels/README.md`](03-modules/hotels/README.md), `ADR-011`.
- **Contracts** → owned by HR. See [`03-modules/contracts/README.md`](03-modules/contracts/README.md), `ADR-012`.
- **Onboarding** → has a specification but no code module; the lifecycle transitions live in
  `employee-management`. See `ADR-030` note ³.
- **Document Templates** → retired 2026-08-13, superseded by the HR contract flow.

## Machine-readable indexes

Under [`.claude/knowledge/`](../.claude/knowledge/). These **summarize and never outrank** the
documents they point at (`knowledge/README.md` Rule 3):
`MODULE_REGISTRY.yaml` (ownership, status, spec version), `SPECIFICATION_INDEX.yaml`,
`DECISION_INDEX.md` (every ADR), `API_INDEX.yaml` (mounts → module → clients),
`INTERFACE_INDEX.yaml` (`IF-*` → owner → signature), `SYNC_STATE.yaml` (synchronization record and
known drift).

Run `node .claude/tooling/repository-integrity-check.js` before relying on any of them.
