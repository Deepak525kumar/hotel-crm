> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# AWS Deployment Guide — Hotel CRM

**Platform:** AWS (single-region MVP) · **Region:** `eu-central-1` (Frankfurt, EU/GDPR)
**Architecture:** Modular monolith — Node.js · Express · Prisma · PostgreSQL · Next.js · Expo
**Date:** 2026-06-19

This guide is sufficient to begin MVP deployment preparation. It standardizes on:

| Concern | AWS Service |
|---|---|
| Compute | EC2 |
| Database | RDS PostgreSQL |
| Object storage | S3 (documents, uploads, worker files) |
| Container registry | ECR |
| Monitoring | CloudWatch |
| SSL/TLS | ACM |
| DNS | Route53 (optional if domain stays external) |
| Secrets | AWS Secrets Manager (preferred) / env vars (MVP acceptable) |

**MVP topology:**

```
Internet → Domain (Route53/external) → ALB (optional for MVP, ACM TLS) → EC2 (Node backend + Nginx) → RDS PostgreSQL
                                                                              └── S3 (documents, uploads, worker files)
```

---

## 1. AWS Account Setup

1. Create an AWS account (or an AWS Organizations member account for isolation).
2. Enable **MFA** on the root user; then **stop using the root user**.
3. Set the default region to `eu-central-1` in the console and CLI.
4. Set up **billing alerts** (Billing → Budgets → create a monthly budget + CloudWatch billing alarm).
5. Install and configure the AWS CLI v2:
   ```bash
   aws configure   # use an IAM user/role, region eu-central-1, output json
   aws sts get-caller-identity   # verify
   ```
6. Execute the **AWS GDPR Data Processing Addendum** (AWS Artifact) before storing production personal data; confirm all resources stay in `eu-central-1`.

---

## 2. IAM Setup

Principle of least privilege — no static keys on servers where an instance role works.

1. **Admin/break-glass user** with MFA for console access (not used day-to-day).
2. **Deploy IAM role (GitHub Actions via OIDC)** — `AWS_DEPLOY_ROLE_ARN`:
   - Trust policy: GitHub OIDC provider (`token.actions.githubusercontent.com`), scoped to this repo.
   - Permissions: `ecr:*` (push/pull on the repo), `ssm:SendCommand` (deploy), read on the deploy artifacts.
3. **EC2 instance role** — attached to the application instances:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"], "Resource": "arn:aws:s3:::hotelcrm-uploads/*" },
       { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::hotelcrm-uploads" },
       { "Effect": "Allow", "Action": ["secretsmanager:GetSecretValue"], "Resource": "arn:aws:secretsmanager:eu-central-1:*:secret:hotel-crm/*" },
       { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"], "Resource": "*" },
       { "Effect": "Allow", "Action": ["logs:CreateLogStream","logs:PutLogEvents","logs:CreateLogGroup"], "Resource": "*" }
     ]
   }
   ```
4. Enable **CloudTrail** (management events) for an audit trail of all API actions.

---

## 3. RDS PostgreSQL Setup

1. RDS → Create database → **PostgreSQL 15**.
2. Templates: **Production** (Multi-AZ) for prod; **Dev/Test** (single-AZ) for staging.
3. Instance class: prod `db.t3.medium`, staging `db.t3.micro`.
4. Storage: 50GB gp3, **storage autoscaling** enabled.
5. **Credentials:** manage the master password with **Secrets Manager** (RDS can create/rotate it).
6. Connectivity:
   - VPC: the application VPC; place RDS in **private subnets**.
   - Public access: **No**.
   - Security group: `sg-rds` allowing inbound 5432 **only** from `sg-ec2`.
7. Enable **automated backups** (30-day retention prod), **encryption at rest** (KMS), and **Performance Insights**.
8. Build the connection string:
   ```
   DATABASE_URL=postgresql://<user>:<pass>@<rds-endpoint>:5432/hotelcrm?schema=public&sslmode=require
   ```
9. Create the database and app user:
   ```sql
   CREATE DATABASE hotelcrm;
   CREATE USER hotelcrm_app WITH PASSWORD '...';
   GRANT ALL PRIVILEGES ON DATABASE hotelcrm TO hotelcrm_app;
   ```

---

## 4. S3 Setup

Used for **documents, uploads, and worker files**.

1. Create bucket `hotelcrm-uploads` (region `eu-central-1`).
2. **Block all public access:** ON (all four settings).
3. Enable **default encryption** (SSE-S3 or SSE-KMS).
4. Enable **versioning**.
5. Lifecycle rule: transition noncurrent versions to `GLACIER` after 180 days; expire after 365 days.
6. Create `hotelcrm-backups` for DB dumps (STANDARD_IA → Glacier lifecycle).
7. CORS (only if the browser uploads directly via pre-signed URLs):
   ```json
   [{ "AllowedOrigins": ["https://hotelcrm.app"], "AllowedMethods": ["GET","PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3000 }]
   ```
8. Access is via the **EC2 instance role** (Section 2) — no static keys. The app generates **pre-signed URLs** (15-min TTL) for client access.

---

## 5. EC2 Setup

1. EC2 → Launch instance:
   - AMI: **Ubuntu Server 24.04 LTS**.
   - Type: prod `t3.medium`, staging `t3.small`.
   - VPC/subnet: app VPC (private subnet if behind an ALB; public subnet for a no-ALB MVP).
   - **IAM instance profile:** the EC2 role from Section 2.
   - Storage: 30GB gp3.
   - Key pair: create one for break-glass SSH (prefer **SSM Session Manager** for routine access).
2. Bootstrap (user-data or manual) — installs the runtime:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   apt-get update && apt-get install -y curl git nginx docker.io postgresql-client unzip
   # Node 20 via nvm for the deploy user
   useradd -m -s /bin/bash deploy
   su - deploy -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash'
   su - deploy -c '. ~/.nvm/nvm.sh && nvm install 20 && npm i -g pm2'
   # AWS CLI v2
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
   unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install
   # CloudWatch agent
   curl -s https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -o /tmp/cwagent.deb
   dpkg -i /tmp/cwagent.deb
   mkdir -p /etc/hotel-crm && chown root:deploy /etc/hotel-crm
   systemctl enable --now docker nginx
   ```
3. Clone the app and start it (see Section 9).

---

## 6. Security Groups

| SG | Inbound | Source |
|---|---|---|
| `sg-alb` | 443 (HTTPS), 80 (redirect) | `0.0.0.0/0` |
| `sg-ec2` | 3001 (API), 3000 (web) | `sg-alb` only |
| `sg-ec2` | 22 (SSH) | break-glass IP only (prefer SSM, no SSH) |
| `sg-rds` | 5432 | `sg-ec2` only |

- No-ALB MVP: `sg-ec2` allows 443/80 from `0.0.0.0/0` (Nginx terminates TLS) — but the ALB+ACM path is recommended.
- Outbound: allow all (needed for APNs, FCM, SendGrid, S3, ECR).

---

## 7. Environment Variables

Stored in **AWS Secrets Manager** (`hotel-crm/<env>`) and/or `/etc/hotel-crm/.env` (chmod 640, `root:deploy`) for the MVP.

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://hotelcrm_app:***@<rds-endpoint>:5432/hotelcrm?schema=public&sslmode=require
JWT_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
CORS_ORIGIN=https://hotelcrm.app
FRONTEND_URL=https://hotelcrm.app

# AWS (prefer the EC2 instance role over static keys)
AWS_REGION=eu-central-1
S3_BUCKET=hotelcrm-uploads
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY only if not using an instance role

# Cache (optional)
REDIS_URL=redis://:***@127.0.0.1:6379
REDIS_PASSWORD=***

# External services
SENDGRID_API_KEY=***
APNS_KEY_ID=***
APNS_TEAM_ID=***
APNS_BUNDLE_ID=app.hotelcrm.worker
APNS_PRIVATE_KEY_BASE64=***
FIREBASE_PROJECT_ID=***
SENTRY_DSN=***
LOG_LEVEL=info
```

> Note: `backend/.env.example`, `backend/.env.staging`, and `backend/src/config/env.ts` still reference legacy `DO_SPACES_*` variables. Replacing them with `S3_BUCKET` / `AWS_*` is a tracked **code** follow-up (see `AWS_DOCUMENTATION_AUDIT.md`).

---

## 8. Prisma Migration Process

Migrations run from CI (the GitHub Actions runner), not on the EC2 host.

```bash
# Local / CI — create a migration during development
npx prisma migrate dev --name <change>

# Production / staging — apply committed migrations (idempotent, forward-only)
DATABASE_URL=<rds-url> npx prisma migrate deploy
```

Rules:
- **Additive-only** per deploy. Use expand-contract for renames/drops (add → deploy → backfill → remove → deploy).
- Migrations are **forward-only**; to back out, write a new corrective migration.
- The CI pipeline runs `prisma migrate deploy` against `<ENV>_DATABASE_URL` **before** swapping the app container.

---

## 9. Backend Deployment

1. Build and push the image to ECR (from CI or locally):
   ```bash
   aws ecr create-repository --repository-name hotel-crm/backend   # one-time
   aws ecr get-login-password --region eu-central-1 \
     | docker login --username AWS --password-stdin <acct>.dkr.ecr.eu-central-1.amazonaws.com
   docker build -t <acct>.dkr.ecr.eu-central-1.amazonaws.com/hotel-crm/backend:<sha> backend
   docker push <acct>.dkr.ecr.eu-central-1.amazonaws.com/hotel-crm/backend:<sha>
   ```
2. On EC2, pull and run (the instance role authorizes the ECR pull):
   ```bash
   aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin <acct>.dkr.ecr.eu-central-1.amazonaws.com
   docker pull <acct>.dkr.ecr.eu-central-1.amazonaws.com/hotel-crm/backend:<sha>
   docker run -d --name hotel-crm-api --env-file /etc/hotel-crm/.env -p 3001:3001 \
     <acct>.dkr.ecr.eu-central-1.amazonaws.com/hotel-crm/backend:<sha>
   ```
   *Source-based alternative (pm2):* `cd /opt/hotel-crm/backend && npm ci && npm run build && pm2 reload hotel-crm-api --update-env`.
3. Health check: `curl -sf http://localhost:3001/api/v1/health` must return 200, then switch the ALB target / Nginx upstream and stop the old container.

---

## 10. Frontend Deployment

The Next.js dashboard can run either on the same EC2 (via pm2/Nginx) or as a static/SSR deploy.

**On EC2 (co-located):**
```bash
cd /opt/hotel-crm/frontend
npm ci && npm run build
pm2 reload hotel-crm-web --update-env   # serves on :3000, proxied by Nginx
```
- Set `NEXT_PUBLIC_API_BASE_URL=https://api.hotelcrm.app/api/v1` at build time.
- Nginx routes `hotelcrm.app` → `:3000` and `api.hotelcrm.app` → `:3001`.

**Alternative (static export to S3 + CloudFront):** build, `aws s3 sync ./out s3://hotelcrm-web`, serve via CloudFront with the ACM cert.

---

## 11. Mobile API Configuration

Expo apps (`worker-app`, `checker-app`) select the API base URL by build profile:

```
APP_ENV=development → http://localhost:3001/api/v1
APP_ENV=staging     → https://staging-api.hotelcrm.app/api/v1
APP_ENV=production  → https://api.hotelcrm.app/api/v1
```

- Map `APP_ENV` per profile in `eas.json`.
- Production API must be reachable over HTTPS (ACM cert) for ATS (iOS) / cleartext rules (Android).
- Uploads use backend-issued **S3 pre-signed URLs** — the mobile apps never hold AWS credentials.

---

## 12. SSL Setup (ACM)

1. ACM (`eu-central-1`) → request a public certificate for `hotelcrm.app` and `*.hotelcrm.app`.
2. Validate via **DNS** (auto if using Route53).
3. Attach the issued certificate to the **ALB HTTPS (443) listener**; redirect 80 → 443.
4. No-ALB MVP: use Let's Encrypt (`certbot --nginx`) on EC2 instead.
5. Verify: `curl -I https://api.hotelcrm.app/api/v1/health` → 200; run an SSL Labs test (target A/A+).

See `deploy/aws-edge-checklist.md` for the full edge/DNS/SSL checklist.

---

## 13. Monitoring (CloudWatch)

- **CloudWatch agent** on EC2 ships system metrics (CPU/mem/disk) and app stdout to log group `/hotel-crm/api`.
- **Alarms → SNS → Slack/PagerDuty:**
  - EC2 CPU > 80% (5 min), memory > 85%, disk > 90%
  - RDS `DatabaseConnections` > 80% of max, `FreeStorageSpace` < 25%, `CPUUtilization` > 70%
  - ALB `HTTPCode_Target_5XX` rate, `UnHealthyHostCount` > 0
- **Sentry** for application error tracking + performance; **UptimeRobot** for external uptime on `/api/v1/health`.
- **Log retention:** 30 days in CloudWatch, then export to S3/Glacier (1 year), then purge. Never log raw PII.

---

## 14. Backups

- **RDS automated backups:** daily snapshots, 30-day retention (prod), PITR enabled (≈5-min RPO).
- **Weekly logical export** to S3 (cron on EC2 or scheduled Lambda):
  ```bash
  pg_dump $DATABASE_URL --format=custom --compress=9 \
    | aws s3 cp - s3://hotelcrm-backups/weekly/$(date +%Y%m%d).dump --storage-class STANDARD_IA
  ```
- **S3 uploads:** versioning + cross-region replication (eu-central-1 → eu-west-1) for the production bucket.
- **Restore drill:** monthly — restore the latest snapshot to a throwaway RDS instance and run `prisma db pull` to validate schema.

---

## 15. Rollback Procedure

**Application rollback (no schema change):**
```bash
# Re-deploy the previous image tag from ECR
docker pull <acct>.dkr.ecr.eu-central-1.amazonaws.com/hotel-crm/backend:<previous-sha>
docker rm -f hotel-crm-api
docker run -d --name hotel-crm-api --env-file /etc/hotel-crm/.env -p 3001:3001 <acct>.../hotel-crm/backend:<previous-sha>
curl -sf http://localhost:3001/api/v1/health
```
*Source/pm2:* `git checkout <good-sha> && npm ci && npm run build && pm2 reload hotel-crm-api`.

**Database rollback:** migrations are forward-only — **do not** `migrate deploy` a downgrade. If a migration broke data, restore via **RDS PITR** to just before the bad deploy (Section 14 / DR runbook P1), or write a corrective forward migration.

**Region failover:** see `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md` §9 (P3 — eu-west-1).

---

## 16. Production Readiness Checklist

- [ ] AWS account hardened (root MFA, billing alerts, CloudTrail on)
- [ ] IAM: deploy role (OIDC) + EC2 instance role (least privilege); no static keys on hosts
- [ ] RDS PostgreSQL provisioned (Multi-AZ prod), private subnet, encryption + automated backups
- [ ] S3 buckets created (uploads + backups), public access blocked, versioning + encryption
- [ ] ECR repository created; image built and pushed
- [ ] EC2 launched with instance role; runtime bootstrapped; CloudWatch agent running
- [ ] Security groups: ALB→EC2→RDS chain locked down
- [ ] Secrets in Secrets Manager (or chmod 640 `/etc/hotel-crm/.env`); validated by `env.ts`
- [ ] ACM certificate issued and attached to ALB (or certbot on EC2); HTTP→HTTPS redirect
- [ ] DNS records point to the ALB (Route53 or external)
- [ ] `prisma migrate deploy` runs cleanly against RDS from CI
- [ ] Backend + frontend deploy and pass `/api/v1/health` and `/`
- [ ] Mobile apps point at the production API over HTTPS
- [ ] CloudWatch alarms wired to SNS → Slack/PagerDuty; Sentry + UptimeRobot live
- [ ] Backup + restore drill executed successfully at least once
- [ ] Rollback procedure tested (previous image tag redeploy)
- [ ] GDPR: AWS DPA executed; all resources in eu-central-1; PII not logged
- [ ] **Code follow-ups closed:** `.env.*`, `env.ts`, `scripts/*`, `nginx/*`, CI workflows re-targeted from DigitalOcean to AWS (see `AWS_DOCUMENTATION_AUDIT.md`)
</content>
