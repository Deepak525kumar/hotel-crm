> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# Staging Deploy Runbook (F2)

**Scope:** Hotel CRM — staging EC2 instance only
**Audience:** Engineers triggering or debugging a staging deployment
**Platform:** AWS (EC2 + RDS + S3, eu-central-1)
**Updated:** 2026-06-19

> Reconciled from DigitalOcean Droplet to **AWS EC2**. The staging host is an EC2 instance (tag `Name=hotel-crm-staging`). The staging database is an RDS PostgreSQL instance. File uploads use S3. See `AWS_DEPLOYMENT_GUIDE.md` for first-time provisioning.

---

## 1. Normal Deploy (Automatic)

Push to `develop`. GitHub Actions runs:

```
ci  →  deploy-staging
```

The CI gate (`ci.yml`) must pass before the deploy step runs.
Monitor the run at: `https://github.com/deepak525kumar/hotel-crm/actions`

---

## 2. Pre-flight Checklist

Before pushing, confirm:

- [ ] `STAGING_DATABASE_URL` secret is set in GitHub → Settings → Secrets → Actions → `staging` environment (RDS endpoint, `?sslmode=require`)
- [ ] `AWS_DEPLOY_ROLE_ARN` (OIDC role) or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secrets are set
- [ ] `ECR_REGISTRY` secret is set (`<account-id>.dkr.ecr.eu-central-1.amazonaws.com`)
- [ ] `/etc/hotel-crm/.env` exists on the staging EC2 instance (see §6) or secrets are pulled from AWS Secrets Manager
- [ ] EC2 instance is reachable: `aws ssm start-session --target <instance-id>` then `pm2 list`

---

## 3. What the Workflow Does

```
GitHub Actions runner (ubuntu-latest)
  1. npm ci                      (backend, runner — full install; build needs devDeps)
  2. npm run build               (backend TypeScript → dist/, runner)
  3. prisma migrate deploy       (runner → STAGING_DATABASE_URL / RDS)
  4. docker build + push image   (→ ECR: hotel-crm/backend:<sha>)

Deploy to EC2 (via SSM Run Command or SSH)
  5. git fetch origin develop && git checkout origin/develop
  6. aws ecr get-login-password | docker login   (pull new image)
  7. cd backend && npm ci && npm run build        (or run the pulled container)
  8. cd frontend && npm ci && npm run build
  9. source /etc/hotel-crm/.env  (or load from Secrets Manager)
 10. pm2 restart hotel-crm-api --update-env
 11. pm2 restart hotel-crm-web --update-env
 12. sleep 15
 13. curl -sf http://localhost:3001/api/v1/health   (must return HTTP 200)
 14. curl -sf http://localhost:3000                  (must return HTTP 200)
```

---

## 4. Manual Deploy (Fallback)

Connect to the EC2 instance and run the deploy script:

```bash
aws ssm start-session --target <STAGING_INSTANCE_ID>
# or: ssh ubuntu@<STAGING_EC2_HOST>
bash /opt/hotel-crm/scripts/deploy.sh staging origin/develop
```

The script loads `/etc/hotel-crm/.env` (or Secrets Manager) automatically before running migrations and pm2.

---

## 5. Health Check Verification

After any deploy, confirm both processes are healthy:

```bash
aws ssm start-session --target <STAGING_INSTANCE_ID>

# API
curl -s http://localhost:3001/api/v1/health
# Expected: {"status":"ok","uptime":<seconds>,"timestamp":"..."}

# Frontend
curl -sI http://localhost:3000 | head -1
# Expected: HTTP/1.1 200 OK

# PM2 process list
pm2 list
# Both hotel-crm-api and hotel-crm-web should show status: online
```

---

## 6. First-Time EC2 Setup

Provision the staging EC2 instance and dependencies per `AWS_DEPLOYMENT_GUIDE.md` (sections 5–7), then populate the secret file:

```bash
# On the EC2 instance, as root (or fetch from Secrets Manager):
vim /etc/hotel-crm/.env
# Fill in all variables from backend/.env.example (AWS values: S3_BUCKET, AWS_REGION, etc.)
# Set ownership: chown root:deploy /etc/hotel-crm/.env && chmod 640 /etc/hotel-crm/.env

# Clone the repo
git clone https://github.com/deepak525kumar/hotel-crm.git /opt/hotel-crm
chown -R deploy:deploy /opt/hotel-crm

# Start PM2 for the first time (as deploy user)
su - deploy -c 'source ~/.nvm/nvm.sh && cd /opt/hotel-crm && pm2 start ecosystem.config.js --env production && pm2 save'
```

> **Preferred:** attach an IAM instance role to the EC2 instance for S3 / Secrets Manager / ECR access instead of static AWS keys in the env file.

---

## 7. Diagnosing a Failed Deploy

### Health check timed out / curl failed

```bash
pm2 logs hotel-crm-api --lines 50
pm2 logs hotel-crm-web --lines 50
```

Common causes:
- Missing env var → check `/etc/hotel-crm/.env` (or Secrets Manager) has all required keys
- Port already in use → `lsof -i :3001` or `lsof -i :3000`
- Build failed silently → re-run `npm run build` manually in `/opt/hotel-crm/backend`
- RDS unreachable → confirm EC2 security group is allowed inbound on the RDS SG (5432)

### PM2 process in errored state

```bash
pm2 describe hotel-crm-api   # shows restart count, error reason
pm2 restart hotel-crm-api
```

### Migration failed

The migration runs on the GitHub Actions runner (not the EC2 instance) against `STAGING_DATABASE_URL` (RDS).
Check the Actions log for the `Run migrations (staging)` step.
If the migration is partially applied, connect to the staging RDS DB and inspect `_prisma_migrations`.

### Secrets not loaded (env vars missing at runtime)

`ecosystem.config.js` uses `node_args: '--env-file=/etc/hotel-crm/.env'` (Node 20 built-in).
Verify Node version on EC2: `node --version` must be ≥ 20.6.

```bash
# Confirm env var is present at runtime:
pm2 exec hotel-crm-api -- node -e "console.log(process.env.DATABASE_URL ? 'ok' : 'MISSING')"
```

---

## 8. Rollback Procedure

There is no automatic rollback in staging. To revert:

```bash
aws ssm start-session --target <STAGING_INSTANCE_ID>
cd /opt/hotel-crm
git log --oneline -10                  # find the previous good commit SHA
git checkout <SHA>
cd backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd /opt/hotel-crm
set -a && source /etc/hotel-crm/.env && set +a
pm2 restart hotel-crm-api --update-env
pm2 restart hotel-crm-web --update-env
sleep 15
curl -sf http://localhost:3001/api/v1/health
```

> Alternatively, re-deploy the previous image tag from ECR (`hotel-crm/backend:<previous-sha>`).

> **Note:** Do NOT run `prisma migrate deploy` when rolling back — migrations are forward-only.
> If a migration must be reversed, use `prisma migrate resolve --rolled-back <migration_name>` after manually reverting the schema changes in the DB.

---

## 9. Known Remaining Issues

| ID | Issue | Impact | Workaround |
|----|-------|--------|------------|
| NVM-PATH | SSM/SSH non-login shell may not have NVM in PATH | `npm`/`pm2` not found during deploy | Add `. ~/.nvm/nvm.sh` to deploy user's `~/.profile`; verify `pm2 startup systemd` ran |
| ROLLBACK-PROD | Production workflow restarts broken code on health check failure instead of reverting | Production only; staging unaffected | Manual rollback per §8 |
| TAG-PERMS | Production tag push may fail (403) — `permissions: contents: write` missing from deploy-production.yml | Release tag not created; deploy itself succeeds | Add `permissions: contents: write` to deploy job in deploy-production.yml |
| REDIS-ENV | `docker-compose.prod.yml` has no `env_file:` directive; `${REDIS_PASSWORD}` may not expand | Redis starts with empty password | Pass `REDIS_PASSWORD` in shell before `docker compose up`, or add `env_file: /etc/hotel-crm/.env` |
| IAM-ROLE | Static AWS keys in `.env` are a follow-up risk | Long-lived credentials on host | Migrate to EC2 IAM instance role for S3/Secrets Manager/ECR |
</content>
