# Repository Integrity Validation Report

Generated: 2026-08-03T23:32:32.633Z

| Total | New (blocking) | Baselined | Warn |
|---|---|---|---|
| 156 | 67 | 4 | 85 |

## Findings by check

| Check | Total | New |
|---|---|---|
| broken-relative-path | 11 | 7 |
| duplicate-adr-number | 60 | 60 |
| orphan-document | 85 | 0 |

## New (blocking) findings

| Check | File | Target | Detail |
|---|---|---|---|
| broken-relative-path | `.claude/worktrees/frontend-web-fix/backend/README.md` | `.claude/worktrees/frontend-web-fix/MASTER_ARCHITECTURE.md` | markdown link target does not exist (raw: "../MASTER_ARCHITECTURE.md") |
| broken-relative-path | `.claude/worktrees/frontend-web-fix/backend/README.md` | `.claude/worktrees/frontend-web-fix/API_STANDARDS.md` | markdown link target does not exist (raw: "../API_STANDARDS.md") |
| broken-relative-path | `.claude/worktrees/frontend-web-fix/backend/README.md` | `.claude/worktrees/frontend-web-fix/AWS_DEPLOYMENT_GUIDE.md` | markdown link target does not exist (raw: "../AWS_DEPLOYMENT_GUIDE.md") |
| broken-relative-path | `.claude/worktrees/frontend-web-fix/backend/README.md` | `.claude/worktrees/frontend-web-fix/API_STANDARDS.md` | markdown link target does not exist (raw: "../API_STANDARDS.md") |
| broken-relative-path | `docs/14-governance/architecture-decisions/ADR-004-prisma-orm.md` | `.github/workflows/deploy-production.yml` | markdown link target does not exist (raw: "../../../.github/workflows/deploy-production.yml") |
| broken-relative-path | `docs/14-governance/architecture-decisions/ADR-005-postgresql-database.md` | `.github/workflows/deploy-production.yml` | markdown link target does not exist (raw: "../../../.github/workflows/deploy-production.yml") |
| broken-relative-path | `docs/14-governance/architecture-decisions/ADR-006-aws-deployment-architecture.md` | `.github/workflows/deploy-production.yml` | markdown link target does not exist (raw: "../../../.github/workflows/deploy-production.yml") |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-001-documentation-first-development.md` | `ADR-001` | also claimed by: docs/14-governance/architecture-decisions/ADR-001-documentation-first-development.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-002-ai-engineering-platform-adoption.md` | `ADR-002` | also claimed by: docs/14-governance/architecture-decisions/ADR-002-ai-engineering-platform-adoption.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-003-modular-monolith-architecture.md` | `ADR-003` | also claimed by: docs/14-governance/architecture-decisions/ADR-003-modular-monolith-architecture.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-004-prisma-orm.md` | `ADR-004` | also claimed by: docs/14-governance/architecture-decisions/ADR-004-prisma-orm.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-005-postgresql-database.md` | `ADR-005` | also claimed by: docs/14-governance/architecture-decisions/ADR-005-postgresql-database.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-006-aws-deployment-architecture.md` | `ADR-006` | also claimed by: docs/14-governance/architecture-decisions/ADR-006-aws-deployment-architecture.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-007-agent-based-engineering-workflow.md` | `ADR-007` | also claimed by: docs/14-governance/architecture-decisions/ADR-007-agent-based-engineering-workflow.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-008-source-of-truth-hierarchy.md` | `ADR-008` | also claimed by: docs/14-governance/architecture-decisions/ADR-008-source-of-truth-hierarchy.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-009-context-artifact-token-optimization.md` | `ADR-009` | also claimed by: docs/14-governance/architecture-decisions/ADR-009-context-artifact-token-optimization.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-010-governance-layer-specification-issues-register.md` | `ADR-010` | also claimed by: docs/14-governance/architecture-decisions/ADR-010-governance-layer-specification-issues-register.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-011-hotels-and-scheduling-capability-ownership.md` | `ADR-011` | also claimed by: docs/14-governance/architecture-decisions/ADR-011-hotels-and-scheduling-capability-ownership.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-012-contracts-ownership-hr-bounded-context.md` | `ADR-012` | also claimed by: docs/14-governance/architecture-decisions/ADR-012-contracts-ownership-hr-bounded-context.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-013-chatbot-ai-capability-ownership-vs-onboarding-workflow.md` | `ADR-013` | also claimed by: docs/14-governance/architecture-decisions/ADR-013-chatbot-ai-capability-ownership-vs-onboarding-workflow.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-014-payslips-ownership-hr-bounded-context.md` | `ADR-014` | also claimed by: docs/14-governance/architecture-decisions/ADR-014-payslips-ownership-hr-bounded-context.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-015-consent-bounded-context.md` | `ADR-015` | also claimed by: docs/14-governance/architecture-decisions/ADR-015-consent-bounded-context.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-016-audit-log-ownership-auth-writer-compliance-reader.md` | `ADR-016` | also claimed by: docs/14-governance/architecture-decisions/ADR-016-audit-log-ownership-auth-writer-compliance-reader.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-017-state-user-ownership-auth-writer.md` | `ADR-017` | also claimed by: docs/14-governance/architecture-decisions/ADR-017-state-user-ownership-auth-writer.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-018-accept-transaction-coupling-superseded-by-pivot.md` | `ADR-018` | also claimed by: docs/14-governance/architecture-decisions/ADR-018-accept-transaction-coupling-superseded-by-pivot.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-019-repository-integrity-validation-gate.md` | `ADR-019` | also claimed by: docs/14-governance/architecture-decisions/ADR-019-repository-integrity-validation-gate.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-020-context-management-layer.md` | `ADR-020` | also claimed by: docs/14-governance/architecture-decisions/ADR-020-context-management-layer.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-021-calendar-jobdispatch-scheduling-ownership-boundary.md` | `ADR-021` | also claimed by: docs/14-governance/architecture-decisions/ADR-021-calendar-jobdispatch-scheduling-ownership-boundary.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-022-retire-hotel-workers-into-employee-management.md` | `ADR-022` | also claimed by: docs/14-governance/architecture-decisions/ADR-022-retire-hotel-workers-into-employee-management.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-023-hotel-group-domain-model.md` | `ADR-023` | also claimed by: docs/14-governance/architecture-decisions/ADR-023-hotel-group-domain-model.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-024-epic5-cutover-mechanism-ordering.md` | `ADR-024` | also claimed by: docs/14-governance/architecture-decisions/ADR-024-epic5-cutover-mechanism-ordering.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-025-hotel-manager-association.md` | `ADR-025` | also claimed by: docs/14-governance/architecture-decisions/ADR-025-hotel-manager-association.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-026-quality-rating-scale-0-100-canonical.md` | `ADR-026` | also claimed by: docs/14-governance/architecture-decisions/ADR-026-quality-rating-scale-0-100-canonical.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-027-notification-channel-enum-shape.md` | `ADR-027` | also claimed by: docs/14-governance/architecture-decisions/ADR-027-notification-channel-enum-shape.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-028-rooms-completed-per-worker-no-room-task-layer.md` | `ADR-028` | also claimed by: docs/14-governance/architecture-decisions/ADR-028-rooms-completed-per-worker-no-room-task-layer.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-029-transactional-outbox-and-worker-runtime.md` | `ADR-029` | also claimed by: docs/14-governance/architecture-decisions/ADR-029-transactional-outbox-and-worker-runtime.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-030-manager-write-authority-capability-model.md` | `ADR-030` | also claimed by: docs/14-governance/architecture-decisions/ADR-030-manager-write-authority-capability-model.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-031-request-time-permission-derivation-and-token-revocation.md` | `ADR-031` | also claimed by: docs/14-governance/architecture-decisions/ADR-031-request-time-permission-derivation-and-token-revocation.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-032-inter-module-transport-direct-call-and-outbox-only.md` | `ADR-032` | also claimed by: docs/14-governance/architecture-decisions/ADR-032-inter-module-transport-direct-call-and-outbox-only.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-033-gdpr-retention-tier-provisional-assignment.md` | `ADR-033` | also claimed by: docs/14-governance/architecture-decisions/ADR-033-gdpr-retention-tier-provisional-assignment.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-034-cross-module-state-read-boundary.md` | `ADR-034` | also claimed by: docs/14-governance/architecture-decisions/ADR-034-cross-module-state-read-boundary.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-035-performance-slo-workload-baseline.md` | `ADR-035` | also claimed by: docs/14-governance/architecture-decisions/ADR-035-performance-slo-workload-baseline.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-036-optimistic-concurrency-platform-standard.md` | `ADR-036` | also claimed by: docs/14-governance/architecture-decisions/ADR-036-optimistic-concurrency-platform-standard.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-037-consent-module-lifecycle-and-fail-safety.md` | `ADR-037` | also claimed by: docs/14-governance/architecture-decisions/ADR-037-consent-module-lifecycle-and-fail-safety.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-038-mfa-deferred-post-mvp.md` | `ADR-038` | also claimed by: docs/14-governance/architecture-decisions/ADR-038-mfa-deferred-post-mvp.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-039-hr-contract-payroll-type-redesign.md` | `ADR-039` | also claimed by: docs/14-governance/architecture-decisions/ADR-039-hr-contract-payroll-type-redesign.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-040-hr-contract-continuation-manager-only.md` | `ADR-040` | also claimed by: docs/14-governance/architecture-decisions/ADR-040-hr-contract-continuation-manager-only.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-041-hr-payslip-request-escalation.md` | `ADR-041` | also claimed by: docs/14-governance/architecture-decisions/ADR-041-hr-payslip-request-escalation.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-042-hr-worker-facing-payslip-contract-rbac.md` | `ADR-042` | also claimed by: docs/14-governance/architecture-decisions/ADR-042-hr-worker-facing-payslip-contract-rbac.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-043-hr-list-route-hotel-scope-filtering.md` | `ADR-043` | also claimed by: docs/14-governance/architecture-decisions/ADR-043-hr-list-route-hotel-scope-filtering.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-044-hr-contract-scan-malware-scan-hook.md` | `ADR-044` | also claimed by: docs/14-governance/architecture-decisions/ADR-044-hr-contract-scan-malware-scan-hook.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-045-emp-offboarding-reengagement.md` | `ADR-045` | also claimed by: docs/14-governance/architecture-decisions/ADR-045-emp-offboarding-reengagement.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-046-worker-self-edit-boundary.md` | `ADR-046` | also claimed by: docs/14-governance/architecture-decisions/ADR-046-worker-self-edit-boundary.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-047-emp-bulk-import-row-handling.md` | `ADR-047` | also claimed by: docs/14-governance/architecture-decisions/ADR-047-emp-bulk-import-row-handling.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-048-emp-job-title-skill-tag-lookup-tables.md` | `ADR-048` | also claimed by: docs/14-governance/architecture-decisions/ADR-048-emp-job-title-skill-tag-lookup-tables.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-049-calendar-timezone-anchor-hotel-configured.md` | `ADR-049` | also claimed by: docs/14-governance/architecture-decisions/ADR-049-calendar-timezone-anchor-hotel-configured.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-050-calendar-rm-hotel-group-scope.md` | `ADR-050` | also claimed by: docs/14-governance/architecture-decisions/ADR-050-calendar-rm-hotel-group-scope.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-051-calendar-operations-stub-removal-composite-read-model.md` | `ADR-051` | also claimed by: docs/14-governance/architecture-decisions/ADR-051-calendar-operations-stub-removal-composite-read-model.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-052-calendar-autocancel-boundary-not-rebroadcast.md` | `ADR-052` | also claimed by: docs/14-governance/architecture-decisions/ADR-052-calendar-autocancel-boundary-not-rebroadcast.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-053-chatbot-orchestration-layer-tool-registry.md` | `ADR-053` | also claimed by: docs/14-governance/architecture-decisions/ADR-053-chatbot-orchestration-layer-tool-registry.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-054-job-dispatch-two-tier-target-architecture.md` | `ADR-054` | also claimed by: docs/14-governance/architecture-decisions/ADR-054-job-dispatch-two-tier-target-architecture.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-055-job-dispatch-broadcast-lifecycle-manager-initiated.md` | `ADR-055` | also claimed by: docs/14-governance/architecture-decisions/ADR-055-job-dispatch-broadcast-lifecycle-manager-initiated.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-056-job-dispatch-assignment-model-direct-creation.md` | `ADR-056` | also claimed by: docs/14-governance/architecture-decisions/ADR-056-job-dispatch-assignment-model-direct-creation.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-057-job-dispatch-background-execution-platform-worker-optimistic-concurrency.md` | `ADR-057` | also claimed by: docs/14-governance/architecture-decisions/ADR-057-job-dispatch-background-execution-platform-worker-optimistic-concurrency.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-058-job-dispatch-migration-strategy-architecturally-eligible.md` | `ADR-058` | also claimed by: docs/14-governance/architecture-decisions/ADR-058-job-dispatch-migration-strategy-architecturally-eligible.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-059-attendance-automation-target-architecture.md` | `ADR-059` | also claimed by: docs/14-governance/architecture-decisions/ADR-059-attendance-automation-target-architecture.md |
| duplicate-adr-number | `.claude/worktrees/frontend-web-fix/docs/14-governance/architecture-decisions/ADR-060-org-chart-flat-hotel-scoped-no-reporting-tree.md` | `ADR-060` | also claimed by: docs/14-governance/architecture-decisions/ADR-060-org-chart-flat-hotel-scoped-no-reporting-tree.md |

## Warnings (non-blocking, 85)

<details><summary>Expand</summary>

| Check | File | Detail |
|---|---|---|
| orphan-document | `.claude/agents/architecture-reviewer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/architecture-validator.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/backend-engineer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/business-rule-validator.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/consistency-reviewer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/dependency-reviewer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/documentation-validator.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/frontend-engineer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/implementation-planner.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/infrastructure-engineer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/lead-architect.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/mobile-engineer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/module-author.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/performance-reviewer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/qa-engineer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/release-manager.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/requirements-analyst.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/agents/security-reviewer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/architecture.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/business-rules.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/dependency.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/merge.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/performance.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/postflight.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/preflight.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/release.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/security.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/testing.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/checklists/validation.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/templates/BOUNDARY_CONFLICT_REPORT_TEMPLATE.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `.claude/templates/CONTEXT_ARTIFACT_TEMPLATES.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/03-modules/chatbot/MODULE_SPEC.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/03-modules/compliance/MODULE_SPEC.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/03-modules/consent/MODULE_SPEC.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/03-modules/geo/MODULE_SPEC.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/03-modules/onboarding/MODULE_SPEC.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/03-modules/retention/MODULE_SPEC.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-009-context-artifact-token-optimization.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-013-chatbot-ai-capability-ownership-vs-onboarding-workflow.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-014-payslips-ownership-hr-bounded-context.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-015-consent-bounded-context.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-016-audit-log-ownership-auth-writer-compliance-reader.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-017-state-user-ownership-auth-writer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-018-accept-transaction-coupling-superseded-by-pivot.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-021-calendar-jobdispatch-scheduling-ownership-boundary.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-022-retire-hotel-workers-into-employee-management.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-023-hotel-group-domain-model.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-024-epic5-cutover-mechanism-ordering.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-025-hotel-manager-association.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-026-quality-rating-scale-0-100-canonical.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-027-notification-channel-enum-shape.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-028-rooms-completed-per-worker-no-room-task-layer.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-030-manager-write-authority-capability-model.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-031-request-time-permission-derivation-and-token-revocation.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-032-inter-module-transport-direct-call-and-outbox-only.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-033-gdpr-retention-tier-provisional-assignment.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-034-cross-module-state-read-boundary.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-035-performance-slo-workload-baseline.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-036-optimistic-concurrency-platform-standard.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-037-consent-module-lifecycle-and-fail-safety.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-038-mfa-deferred-post-mvp.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-039-hr-contract-payroll-type-redesign.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-040-hr-contract-continuation-manager-only.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-041-hr-payslip-request-escalation.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-042-hr-worker-facing-payslip-contract-rbac.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-043-hr-list-route-hotel-scope-filtering.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-044-hr-contract-scan-malware-scan-hook.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-045-emp-offboarding-reengagement.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-046-worker-self-edit-boundary.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-047-emp-bulk-import-row-handling.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-048-emp-job-title-skill-tag-lookup-tables.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-049-calendar-timezone-anchor-hotel-configured.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-050-calendar-rm-hotel-group-scope.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-051-calendar-operations-stub-removal-composite-read-model.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-052-calendar-autocancel-boundary-not-rebroadcast.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-053-chatbot-orchestration-layer-tool-registry.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-054-job-dispatch-two-tier-target-architecture.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-055-job-dispatch-broadcast-lifecycle-manager-initiated.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-056-job-dispatch-assignment-model-direct-creation.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-057-job-dispatch-background-execution-platform-worker-optimistic-concurrency.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-058-job-dispatch-migration-strategy-architecturally-eligible.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-059-attendance-automation-target-architecture.md` | no inbound reference from any scanned markdown link or YAML index path |
| orphan-document | `docs/14-governance/architecture-decisions/ADR-060-org-chart-flat-hotel-scoped-no-reporting-tree.md` | no inbound reference from any scanned markdown link or YAML index path |

</details>

