# ADR-006: AWS Deployment Architecture

## Status

**Accepted** — 2026-07-04 (ratified 2026-07-15 by the commissioning human via the G2 Approval Workflow; see `.claude/CHANGELOG.md`)

Deciders: Authored by AI Engineering Platform; formal ratification was granted by the commissioning human on 2026-07-15 (G2 Approval Workflow; see `.claude/CHANGELOG.md`).

- Supersedes: none
- Superseded by: none

This record documents the production deployment mechanism currently evidenced in the repository; it was human-ratified on 2026-07-15 (G2 Approval Workflow). Claims are scoped strictly to repository evidence; unverified AWS services are marked UNKNOWN.

## Context

The application must run in production in the EU region with HTTPS, edge protection, and a repeatable deployment path from the default branch.

Forces:

- Deployment should ship precisely the CI-validated commit and be recoverable if a release fails its health checks.
- Edge concerns (DNS, TLS, WAF, rate limiting) must be addressed even if provisioned manually rather than as code.
- EU data-residency is a stated regional constraint (`deploy/aws-edge-checklist.md:7`; CI `AWS_REGION: eu-central-1`).

Current-state facts (CONFIRMED):

- Production runs on an AWS **EC2** host: the deploy job is named "Deploy to Production EC2 instance" and connects over SSH (`appleboy/ssh-action`) as user `deploy` to `PROD_EC2_HOST`, then builds and reloads services (`.github/workflows/deploy-production.yml:19,72-84,124-125`).
- Application processes run under **PM2**, not containers: `ecosystem.config.js` defines `hotel-crm-api` (port 3001) and `hotel-crm-web` (port 3000), both `exec_mode: 'fork'` (`ecosystem.config.js:1-43`).
- An Nginx configuration is present (`nginx/hotelcrm.conf`).
- AWS edge services are provisioned via a **manual checklist** (not IaC): Route53 (optional), ACM (TLS), ALB, AWS WAF (managed rules + rate limiting), EC2 security groups, CloudFront (optional), and AWS Shield Standard (`deploy/aws-edge-checklist.md:1-119`).
- CI/CD region is `eu-central-1` (Frankfurt) (`.github/workflows/ci.yml:73`; `deploy/aws-edge-checklist.md:7`).
- The only containerized production service is Redis (`docker-compose.prod.yml:1-22`).

Current-state facts (UNKNOWN / NOT evidenced as used):

- **AWS RDS**: no repository evidence. The production database is reached via an external `DATABASE_URL` secret (`.github/workflows/deploy-production.yml:64`); whether it is RDS or another host is unverified.
- **ECS / Fargate / ECR container orchestration**: no evidence. The app is not containerized in production — it runs via PM2 on EC2. `docker-compose.prod.yml` defines only Redis.

> Note: `README.md` mentions AWS RDS and ECR/Docker images (`README.md:98,112,205-211,321-330`). Those are aspirational/architecture-narrative statements not corroborated by the deployment automation, which uses EC2 + PM2 + external `DATABASE_URL`. Per Source of Truth, the repository worktree and reproducible deployment behavior outrank the narrative (`.claude/constitution/SOURCE_OF_TRUTH.md:9-19`); the README claims are therefore recorded as UNKNOWN/unverified here.

## Decision

Production runs on an AWS EC2 host: the backend API and web frontend are executed by PM2 (`hotel-crm-api` on 3001, `hotel-crm-web` on 3000) behind Nginx, deploying the CI-validated commit over SSH with a git-SHA health-checked rollback. The primary PostgreSQL database is external, addressed via an injected `DATABASE_URL` secret. AWS edge services — ACM (TLS), an Application Load Balancer, AWS WAF, and optionally Route53/CloudFront — are provisioned per a manual checklist in region `eu-central-1`. This ADR records the existing implemented state.

Explicitly out of scope / not claimed: AWS RDS as the database host, and ECS/Fargate/ECR container orchestration for the application. These are marked UNKNOWN below.

## Consequences

Positive:

- Deploys ship the exact CI-validated SHA and roll back to the previous SHA on failed health checks (`.github/workflows/deploy-production.yml:79-141`).
- Edge protection (TLS, WAF managed rules, rate limiting, Shield Standard) is defined even without IaC (`deploy/aws-edge-checklist.md:45-77`).
- EU region (`eu-central-1`) supports data-residency expectations.

Negative:

- Edge infrastructure is a **manual checklist**, not infrastructure-as-code, so provisioning is not reproducible or version-verified (`deploy/aws-edge-checklist.md:1-9`).
- PM2-on-EC2 with `instances: 1` fork mode is a single-host, single-instance runtime for each app (`ecosystem.config.js:10-11,29-30`); no orchestrated horizontal scaling is evidenced.
- Rollback is code-only; database migrations are not rolled back, so migrations must stay backward-compatible (`.github/workflows/deploy-production.yml:89-99`).

Neutral / operational:

- Redis is the only containerized production service (`docker-compose.prod.yml:1-22`).
- Production deployment requires manual approval via a GitHub `production` environment (`.github/workflows/deploy-production.yml:22`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| EC2 + PM2 + Nginx, manual AWS edge (chosen) | SSH-deploy the CI SHA to an EC2 host; PM2 process management; ALB/ACM/WAF via checklist | Matches implemented deployment automation and configuration |
| ECS / Fargate + ECR (containerized) | Orchestrated containers with an image registry | No evidence in the deployment automation; app is not containerized in prod (only Redis is). Recorded as UNKNOWN, not adopted |
| Infrastructure-as-code for edge (Terraform/CloudFormation) | Version-controlled provisioning of Route53/ACM/ALB/WAF | Edge is currently a manual checklist (`deploy/aws-edge-checklist.md`); IaC is not present. A candidate improvement, not current state |
| Non-AWS / status quo | Different cloud or the prior Cloudflare edge | The edge was explicitly reconciled from Cloudflare to AWS as the single platform (`deploy/aws-edge-checklist.md:9`) |

## Related Documents

- [AWS Edge / DNS / SSL Checklist](../../../deploy/aws-edge-checklist.md)
- [Production deploy workflow](../../../.github/workflows/deploy-production.yml)
- [PM2 ecosystem config](../../../ecosystem.config.js)
- [Production Docker Compose (Redis)](../../../docker-compose.prod.yml)
- [Nginx configuration](../../../nginx/hotelcrm.conf)
- [Project README](../../../README.md)
- [ADR-005: PostgreSQL Database](ADR-005-postgresql-database.md)
- [ADR-003: Modular Monolith Architecture](ADR-003-modular-monolith-architecture.md)
- [Source of Truth](../../../.claude/constitution/SOURCE_OF_TRUTH.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| Production deploys to an AWS EC2 host over SSH as user `deploy` | Confirmed | `.github/workflows/deploy-production.yml:19,72-84` |
| App runs under PM2 (`hotel-crm-api` :3001, `hotel-crm-web` :3000, fork mode) | Confirmed | `ecosystem.config.js:1-43` |
| Deploy reloads services via `pm2 reload`/`pm2 restart` | Confirmed | `.github/workflows/deploy-production.yml:124-125` |
| Nginx config present | Confirmed | `nginx/hotelcrm.conf` |
| AWS edge (Route53/ACM/ALB/WAF/Shield/CloudFront) provisioned via manual checklist | Confirmed | `deploy/aws-edge-checklist.md:1-119` |
| Deployment/CI region is `eu-central-1` | Confirmed | `.github/workflows/ci.yml:73`; `deploy/aws-edge-checklist.md:7` |
| Only Redis is containerized in production | Confirmed | `docker-compose.prod.yml:1-22` |
| Code-only rollback; migrations must be backward-compatible | Confirmed | `.github/workflows/deploy-production.yml:89-99` |
| Production DB is AWS RDS | UNKNOWN | No evidence; prod DB reached via external `DATABASE_URL` secret (`.github/workflows/deploy-production.yml:64`) |
| ECS/Fargate/ECR container orchestration for the app | UNKNOWN | No evidence; app runs via PM2 on EC2, not containers |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Database hosting: whether the production PostgreSQL is AWS RDS or another host is UNKNOWN (only a `DATABASE_URL` secret is evidenced). Requires human confirmation.
- Container orchestration: whether ECS/Fargate/ECR is intended is UNKNOWN; current production is PM2-on-EC2. The README's ECR/Docker narrative (`README.md:98,205-211,321-330`) is unreconciled with the deployment automation — a synchronization/drift item.
- IaC: edge provisioning is a manual checklist; whether to codify it (Terraform/CloudFormation) is unresolved.
- Ownership: no accountable owner is assigned (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority.
- Ratification: this ADR was ratified (Proposed → Accepted) by the commissioning human on 2026-07-15 (G2 Approval Workflow).
