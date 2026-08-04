> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# AWS_DEPLOYMENT_EXECUTION_PLAN

**Role:** AWS Deployment Engineering Authority
**Date:** 2026-06-20
**Branch:** `claude/charming-albattani-efc213`
**Scope:** Audit remaining DigitalOcean (DO) / Cloudflare assumptions in **code/config** after the documentation migration to AWS, and prepare the repository for the **first AWS staging deployment**.
**Target region:** `eu-central-1` (Frankfurt, EU/GDPR).

> Guardrails honored: **no AWS resources provisioned, no deployment performed.** This plan covers repository readiness plus the human-run AWS/GitHub steps that must follow.

---

## Audit Result — DigitalOcean Assumptions Found

Documentation was already reconciled to AWS (see `AWS_DEPLOYMENT_GUIDE.md`, `AWS_DOCUMENTATION_AUDIT.md`, `docs/STAGING_DEPLOY_RUNBOOK.md`, `deploy/aws-edge-checklist.md`). The audit confirmed all residual DO/Cloudflare assumptions were in **code/config artifacts**, exactly the 11 follow-ups logged in `AWS_DOCUMENTATION_AUDIT.md`. Each is addressed below.

| Area | File(s) | DO/Cloudflare assumption | Status |
|---|---|---|---|
| Env validation | `backend/src/config/env.ts` | Validated `DO_SPACES_*` | ✅ Fixed → `AWS_REGION`/`S3_BUCKET`/`AWS_*` |
| Env templates | `backend/.env.example`, `backend/.env.staging` | `DO_SPACES_*`, `*.ondigitalocean.com` DB | ✅ Fixed → S3 + RDS endpoints |
| CI matrix | `.github/workflows/ci.yml` | `DO_SPACES_*` test env | ✅ Fixed → `AWS_*`/`S3_*` |
| Backups | `scripts/backup-db.sh` | `pg_dump` → DO Spaces `--endpoint-url` | ✅ Fixed → `aws s3 cp` (S3, instance role) |
| Provisioning | `scripts/setup-droplet.sh` | DO Droplet, Cloudflare IPs, DO Spaces | ✅ Fixed → renamed `setup-ec2.sh`, AWS CLI, instance role |
| Deploy/rotate | `scripts/deploy.sh`, `scripts/rotate-secrets.sh` | "Droplet" host references | ✅ Fixed → EC2 + Secrets Manager note |
| Reverse proxy | `nginx/hotelcrm.conf` | Cloudflare origin cert paths, DO Spaces CSP | ✅ Fixed → `/etc/ssl/hotelcrm`, ALB+ACM/certbot, S3 CSP |
| CI/CD deploy | `.github/workflows/deploy-staging.yml`, `deploy-production.yml` | `*_DROPLET_IP` secrets, "Droplet" labels | ✅ Fixed → `*_EC2_HOST` |
| Storage code | `backend/src/modules/hr/service.ts` | — (upload is a `NotImplementedError` stub) | ⚠️ No SDK wiring yet — remaining work |

False positives (no change): `docs/API_SPEC_V1.md` ("spaces" = char class), `mobile/*/api.ts` (`\bDO\b`), `_legacy/*` (archived).

---

## Completed AWS Work

Implemented on this branch in four isolated commits (PR opened):

1. **`feat(config)`** — `env.ts`, `.env.example`, `.env.staging`, `ci.yml`: `DO_SPACES_*` → `AWS_REGION` / `S3_BUCKET` / `S3_BUCKET_BACKUPS` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; sample DB URLs re-pointed at RDS.
2. **`feat(backups)`** — `backup-db.sh`: S3 upload via instance role (no custom endpoint), `S3_BUCKET_BACKUPS` + `AWS_REGION`.
3. **`feat(infra)`** — `setup-droplet.sh`→`setup-ec2.sh` (AWS CLI v2, `postgresql-client`, instance role, RDS/S3 template); `nginx` cert paths + ALB/ACM/certbot guidance + S3 CSP; `deploy.sh`/`rotate-secrets.sh` Droplet→EC2.
4. **`ci(deploy)`** — `deploy-staging.yml`/`deploy-production.yml`: `*_DROPLET_IP` → `*_EC2_HOST`.

Documentation (pre-existing): AWS deployment guide, edge checklist, staging runbook, and reconciliation reports are AWS-canonical.

---

## Remaining AWS Work

| # | Task | Files | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| R1 | Wire the S3 SDK for document upload/presign (replace the `NotImplementedError` stub) using `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` and the instance role | `backend/src/modules/hr/service.ts`, new `backend/src/lib/storage.ts`, `package.json` | M (0.5–1 d) | Med | env vars (done) |
| R2 | (Optional) Containerize backend for ECR/CodeDeploy path; current deploy is source+pm2 over SSH | new `backend/Dockerfile`, workflows | M (1 d) | Med | AWS provisioning |
| R3 | (Optional) Load secrets from AWS Secrets Manager at boot instead of `/etc/hotel-crm/.env` | `backend/src/config/env.ts`, bootstrap | M (0.5 d) | Med | IAM, Secrets Manager |
| R4 | Recreate GitHub environment secrets under the new names (`*_EC2_HOST`, `STAGING_DATABASE_URL`) | GitHub UI | S (0.5 h) | Low | AWS provisioning |

R2/R3 are **not blockers** for a first staging deploy (source+pm2+env-file path works). R1 is only a blocker if document upload is in the staging acceptance scope.

---

## Deployment Blockers

| Blocker | Type | Owner | Resolution |
|---|---|---|---|
| B1 | No AWS infrastructure exists (IAM/RDS/S3/EC2/SGs) | Infra | Phase 3 provisioning (human-run; out of repo scope) |
| B2 | GitHub environment secrets still under old names / unset | CI/CD | Phase 2 — create `STAGING_EC2_HOST`, `STAGING_SSH_KEY`, `STAGING_DATABASE_URL` |
| B3 | TLS not issued (ACM cert or certbot) | Edge | Phase 3/4 — see `deploy/aws-edge-checklist.md` |
| B4 | S3 upload code is a stub (R1) | Code | Only blocks if uploads are in staging scope; otherwise defer |
| B5 | DNS for `staging.hotelcrm.app` / `staging-api.hotelcrm.app` not pointed at the host/ALB | Edge | Phase 4 |

No blocker remains in the repository itself for a non-upload staging smoke test once B1–B3, B5 are satisfied by the operator.

---

## Infrastructure Requirements

- **IAM:** GitHub OIDC deploy role; EC2 instance role (S3 RW on `hotelcrm-*`, Secrets Manager read on `hotel-crm/*`, ECR pull, CloudWatch logs); break-glass admin with MFA.
- **RDS:** PostgreSQL 15, `db.t3.micro` (staging), private subnet, public access **No**, `sg-rds` ← `sg-ec2:5432`, encryption + automated backups, master password in Secrets Manager.
- **S3:** `hotelcrm-staging` (uploads) + `hotelcrm-backups-staging` — block public access, versioning, default encryption, lifecycle (Glacier).
- **EC2:** Ubuntu 24.04, `t3.small` (staging), instance profile attached, 30GB gp3, bootstrap via `scripts/setup-ec2.sh`.
- **Security Groups:** `sg-alb` (443/80 from `0.0.0.0/0`), `sg-ec2` (3000/3001 from `sg-alb`; 22 break-glass/SSM), `sg-rds` (5432 from `sg-ec2`).
- **Edge:** ACM cert (`*.hotelcrm.app`) on ALB **or** certbot on EC2; Route53/external DNS.
- **GitHub:** `staging` environment with `STAGING_EC2_HOST`, `STAGING_SSH_KEY`, `STAGING_DATABASE_URL`.

---

## Execution Order

### Phase 1 — Code/config migration (repository) — ✅ DONE on this branch
| Task | Files | Effort | Risk | Depends on |
|---|---|---|---|---|
| Env vars DO→AWS | `backend/src/config/env.ts`, `.env.example`, `.env.staging`, `ci.yml` | S | Low | — |
| Backups → S3 | `scripts/backup-db.sh` | S | Low | env vars |
| EC2 provisioning + nginx + ops scripts | `scripts/setup-ec2.sh`, `nginx/hotelcrm.conf`, `scripts/deploy.sh`, `scripts/rotate-secrets.sh` | M | Low | — |
| Deploy workflow secret names | `.github/workflows/deploy-*.yml` | S | Low | — |
| (Optional) S3 upload SDK wiring (R1) | `backend/src/modules/hr/service.ts`, `backend/src/lib/storage.ts` | M | Med | env vars |

### Phase 2 — GitHub environments and secrets (human, GitHub UI)
| Task | Effort | Risk | Depends on |
|---|---|---|---|
| Create/confirm `staging` environment | S | Low | — |
| Add `STAGING_EC2_HOST`, `STAGING_SSH_KEY`, `STAGING_DATABASE_URL` | S | Low | Phase 3 outputs (host/RDS URL) |
| (If OIDC/ECR) add `AWS_DEPLOY_ROLE_ARN` | S | Low | Phase 3 IAM |

### Phase 3 — AWS provisioning (human; **do not run from this repo**)
| Step | Effort | Risk | Depends on |
|---|---|---|---|
| IAM (OIDC deploy role, EC2 instance role) | M | Med | AWS account hardened |
| RDS PostgreSQL 15 (staging, private) | M | Med | VPC/subnets, IAM |
| S3 buckets (`hotelcrm-staging`, `-backups-staging`) | S | Low | IAM |
| EC2 (`t3.small`, instance profile, `setup-ec2.sh`) | M | Med | IAM, S3, RDS |
| Security Groups (alb→ec2→rds chain) | S | Med | VPC |

### Phase 4 — Staging deployment
| Step | Effort | Risk | Depends on |
|---|---|---|---|
| DNS → host/ALB; TLS (ACM or certbot) | M | Med | EC2, edge checklist |
| Populate `/etc/hotel-crm/.env` (or Secrets Manager) | S | Med | RDS, S3 |
| `prisma migrate deploy` → staging RDS (via CI) | S | Med | RDS, secrets |
| Trigger `deploy-staging.yml` (push to `develop`) | S | Med | Phase 2/3 |

### Phase 5 — Validation
| Step | Effort | Risk | Depends on |
|---|---|---|---|
| `GET /api/v1/health` → 200; frontend `/` → 200 | S | Low | Phase 4 |
| TLS check (`curl -I`, SSL Labs A/A+) | S | Low | TLS |
| S3 round-trip (if R1 done) via presigned URL | S | Med | R1, S3 |
| RDS connectivity + migration state | S | Low | Phase 4 |
| Backup dry run (`backup-db.sh` → S3) | S | Low | S3, IAM |
| CloudWatch logs/alarms reachable | S | Low | EC2 role |

---

## Verification Performed

- `grep` confirms **zero** residual `Droplet` / `Cloudflare` / `digitalocean` / `DO_SPACES` references in `scripts/` and `nginx/`.
- Remaining `DO_SPACES` matches are **documentation only** (audit/historical reports) — intentionally preserved as record.
- `bash -n` passes on all three modified shell scripts.
- `env.ts` change is self-contained zod; no other source references the removed vars (storage path is a stub). Backend `npm` typecheck not run here — dependencies are not installed in this environment; change is low-risk and CI will gate it.
