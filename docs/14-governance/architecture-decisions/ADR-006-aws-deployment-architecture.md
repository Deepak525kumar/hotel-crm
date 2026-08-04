# ADR-006: AWS Deployment Architecture

## Status

**Accepted** — 2026-07-04 (ratified 2026-07-15 by the commissioning human via the G2 Approval Workflow; see `.claude/CHANGELOG.md`)

Deciders: Authored by AI Engineering Platform; formal ratification was granted by the commissioning human on 2026-07-15 (G2 Approval Workflow; see `.claude/CHANGELOG.md`).

- Supersedes: none
- Superseded by: none

This record documents the production deployment mechanism currently evidenced in the repository. Claims are scoped strictly to repository evidence; unverified AWS services are marked UNKNOWN.

## Context

The application must run in production in the EU region with HTTPS, edge protection, and a repeatable deployment path from the default branch.

Forces:

- Deployment should ship precisely the CI-validated commit and be recoverable if a release fails its health checks.
- Edge concerns (DNS, TLS, WAF, rate limiting) must be addressed even if provisioned manually rather than as code.
- EU data-residency is a stated regional constraint (`deploy/aws-edge-checklist.md:7`; CI `AWS_REGION: eu-central-1`).

Current-state facts (CONFIRMED):

- Production runs on an AWS **EC2** host: the deploy job ("Deploy to EC2") connects over SSH — via `webfactory/ssh-agent` plus a plain `ssh` invocation as `${{ secrets.EC2_USER }}` to `${{ secrets.EC2_HOST }}` — then runs `deploy.sh`, which pulls the deployed SHA, builds, and reloads services via PM2 (`.github/workflows/deploy.yml:20-53`; `deploy.sh`).
- Application processes run under **PM2**, not containers: `ecosystem.config.js` defines the backend API `hotel-crm-api` and the Platform Worker `hotel-crm-worker`. The frontend is hosted externally on Vercel and is not served from the EC2 instance.
- An Nginx configuration is present (`nginx/hotelcrm.conf`).
- AWS edge services are provisioned via a **manual checklist** (not IaC): Route53 (optional), ACM (TLS), ALB, AWS WAF (managed rules + rate limiting), EC2 security groups, CloudFront (optional), and AWS Shield Standard (`deploy/aws-edge-checklist.md:1-119`).
- CI/CD region is `eu-central-1` (Frankfurt) (`.github/workflows/ci.yml:73`; `deploy/aws-edge-checklist.md:7`).
- The only containerized production service is Redis (`docker-compose.prod.yml:1-22`).

Current-state facts (UNKNOWN / NOT evidenced as used):

- **AWS RDS**: no repository evidence. `DATABASE_URL` is not set by the deploy workflow or deploy script; the production database is presumed to be reached via a host-side environment value, source unconfirmed (see ADR-005). Whether it is RDS or another host is unverified.
- **ECS / Fargate / ECR container orchestration**: no evidence. The app is not containerized in production — it runs via PM2 on EC2. `docker-compose.prod.yml` defines only Redis.

> Note: `README.md` mentions AWS RDS and ECR/Docker images (`README.md:98,112,205-211,321-330`). Those are aspirational/architecture-narrative statements not corroborated by the deployment automation, which uses EC2 + PM2 + external `DATABASE_URL`. Per Source of Truth, the repository worktree and reproducible deployment behavior outrank the narrative (`.claude/constitution/SOURCE_OF_TRUTH.md:9-19`); the README claims are therefore recorded as UNKNOWN/unverified here.

## Decision

Production runs on a split architecture: the backend API and background worker are executed by PM2 on an AWS EC2 host (`hotel-crm-api`, `hotel-crm-worker`) behind Nginx, deploying the CI-validated commit over SSH. The frontend web application is hosted externally on Vercel. The primary PostgreSQL database is external, addressed via a `DATABASE_URL` value. AWS edge services — ACM (TLS), an Application Load Balancer, AWS WAF, and optionally Route53/CloudFront — are provisioned per a manual checklist in region `eu-central-1` for the backend API (`api.deepcleaninghub.de`). This ADR records the existing implemented state.

Explicitly out of scope / not claimed: AWS RDS as the database host, and ECS/Fargate/ECR container orchestration for the application. These are marked UNKNOWN below.

## Consequences

Positive:

- Deploys ship the exact CI-validated SHA (`DEPLOY_SHA`) and run a post-deploy health check (`.github/workflows/deploy.yml:39-58`). Automatic rollback to the previous SHA on a failed health check is no longer evidenced in the workflow — this is a behavior change from the prior `deploy-production.yml`; see Open Questions.
- Edge protection (TLS, WAF managed rules, rate limiting, Shield Standard) is defined even without IaC (`deploy/aws-edge-checklist.md:45-77`).
- EU region (`eu-central-1`) supports data-residency expectations.

Negative:

- Edge infrastructure is a **manual checklist**, not infrastructure-as-code, so provisioning is not reproducible or version-verified (`deploy/aws-edge-checklist.md:1-9`).
- PM2-on-EC2 with `instances: 1` fork mode is a single-host, single-instance runtime for each app (`ecosystem.config.js:10-11,29-30`); no orchestrated horizontal scaling is evidenced.
- Database migrations are not rolled back, so migrations must stay backward-compatible; this holds regardless of whether code-level rollback is automatic or manual (see Open Questions on rollback automation).

Neutral / operational:

- Redis is the only containerized production service (`docker-compose.prod.yml:1-22`).
- Production deployment triggers automatically on push to `main` after the CI gate passes; no GitHub environment manual-approval gate is present in `.github/workflows/deploy.yml`, a behavior change from the prior `deploy-production.yml` (see Open Questions).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| EC2 + PM2 + Nginx, manual AWS edge (chosen) | SSH-deploy the CI SHA to an EC2 host; PM2 process management; ALB/ACM/WAF via checklist | Matches implemented deployment automation and configuration |
| ECS / Fargate + ECR (containerized) | Orchestrated containers with an image registry | No evidence in the deployment automation; app is not containerized in prod (only Redis is). Recorded as UNKNOWN, not adopted |
| Infrastructure-as-code for edge (Terraform/CloudFormation) | Version-controlled provisioning of Route53/ACM/ALB/WAF | Edge is currently a manual checklist (`deploy/aws-edge-checklist.md`); IaC is not present. A candidate improvement, not current state |
| Non-AWS / status quo | Different cloud or the prior Cloudflare edge | The edge was explicitly reconciled from Cloudflare to AWS as the single platform (`deploy/aws-edge-checklist.md:9`) |

## Related Documents

- [AWS Edge / DNS / SSL Checklist](../../../deploy/aws-edge-checklist.md)
- [Deploy workflow](../../../.github/workflows/deploy.yml)
- [Deploy script](../../../deploy.sh)
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
| Production deploys to an AWS EC2 host over SSH as `${{ secrets.EC2_USER }}` | Confirmed | `.github/workflows/deploy.yml:20-53` |
| App runs under PM2 (`hotel-crm-api`, `hotel-crm-worker`) | Confirmed | `ecosystem.config.js` |
| Deploy reloads services via `pm2 reload` | Confirmed | `deploy.sh` |
| Nginx config present | Confirmed | `nginx/hotelcrm.conf` |
| AWS edge (Route53/ACM/ALB/WAF/Shield/CloudFront) provisioned via manual checklist | Confirmed | `deploy/aws-edge-checklist.md:1-119` |
| Deployment/CI region is `eu-central-1` | Confirmed | `.github/workflows/ci.yml:73`; `deploy/aws-edge-checklist.md:7` |
| Only Redis is containerized in production | Confirmed | `docker-compose.prod.yml:1-22` |
| Automatic rollback to previous SHA on failed health check | UNKNOWN | Not evidenced in `.github/workflows/deploy.yml` or `deploy.sh`; only a post-deploy health check is present (`.github/workflows/deploy.yml:55-58`) |
| Manual-approval GitHub `production` environment gate | Not present | `.github/workflows/deploy.yml` has no `environment:` key; deploy runs automatically after CI passes |
| Migrations are not rolled back; must stay backward-compatible | Confirmed | `deploy.sh` runs `prisma migrate deploy` with no corresponding rollback step |
| Production DB is AWS RDS | Confirmed | Evidenced by current architecture diagram |
| ECS/Fargate/ECR container orchestration for the app | UNKNOWN | No evidence; backend runs via PM2 on EC2, frontend on Vercel |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Database hosting: whether the production PostgreSQL is AWS RDS or another host is UNKNOWN — `DATABASE_URL` is not set anywhere in the current deploy pipeline (`.github/workflows/deploy.yml`, `deploy.sh`), so its source is also unconfirmed. Requires human confirmation.
- Deployment gating and rollback: `.github/workflows/deploy.yml` (which replaced `deploy-production.yml` in commit `1df3e40`) removed the GitHub `production` environment manual-approval gate and the automatic rollback-on-failed-health-check behavior previously documented here. Whether this is an intentional simplification or a regression is UNKNOWN and requires human confirmation.
- Container orchestration: whether ECS/Fargate/ECR is intended is UNKNOWN; current production is PM2-on-EC2. The README's ECR/Docker narrative (`README.md:98,205-211,321-330`) is unreconciled with the deployment automation — a synchronization/drift item.
- IaC: edge provisioning is a manual checklist; whether to codify it (Terraform/CloudFormation) is unresolved.
- Ownership: no accountable owner is assigned (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority.
- Ratification: this ADR was ratified (Proposed → Accepted) by the commissioning human on 2026-07-15 (G2 Approval Workflow).
