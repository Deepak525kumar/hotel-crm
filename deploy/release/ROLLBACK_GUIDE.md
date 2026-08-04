# Rollback Guide — Hotel CRM MVP

Last synchronized 2026-08-04 (Release Candidate documentation pass). No scripted rollback job
exists in this repository's CI/CD today. This guide documents the manual procedure. (Adding a
scripted rollback job is a legitimate future improvement — see `POST_MVP_BACKLOG.md` — not built
here.) This guide covers the backend + worker only, which are the only components deployed via
this repository's tooling — the frontend is deployed and rolled back independently via Vercel's
own deployment history/rollback feature.

## Decision order — cheapest fix first

1. **Is it a feature-flag issue?** → flip the flag, reload. Fastest, safest, no code involved.
2. **Is it an application bug in the newly deployed code, with no schema change involved?**
   → code rollback (below).
3. **Did a migration cause it?** → migration rollback (below) — rare, and one recent migration
   in this release's history is explicitly not fully reversible (see below); read the harness
   doc before touching this.

## 1. Feature-flag rollback (fastest path)

```bash
ssh <user>@<host>
sudo vim backend/.env    # set the problem flag back to false
pm2 reload ecosystem.config.js --env production --update-env
```

This reloads both `hotel-crm-api` and `hotel-crm-worker` together — see `DEPLOYMENT_GUIDE.md`'s
Topology section for the current process layout.

**Confirmed safe** for `FEATURE_EMPLOYMENT_RECORD`, `FEATURE_GD02_MATRIX`,
`FEATURE_JOBDISPATCH_PHASE2` — disabling any of these 404s their routes again; data already
written under the flag-on path becomes unreachable via API but is not corrupted, and re-enabling
later restores access to it.

**Do not use this as a rollback path for `FEATURE_RM_ROLE`** if it is ever turned on — its
associated promotion script mutates `User.role` directly with no corresponding "demote" path.
Disabling the flag afterward does not undo already-promoted accounts. If this ever needs
reverting, it requires a manual, deliberate data fix, not a flag flip. (This release does not
enable this flag at all — noted here only so future operators don't assume flag-off is
sufficient if it's turned on later.)

## 2. Application code rollback

No automated job exists. Manual procedure:

```bash
ssh <user>@<host>
cd /home/ubuntu/apps/hotel-crm   # confirmed path per live deploy logs; verify against the real host
git fetch origin
git checkout <previous-known-good-sha>
npm ci
cd backend && npx prisma generate && cd ..
npm run build
pm2 reload ecosystem.config.js --env production --update-env
pm2 save
curl -fsS http://localhost:3001/api/v1/health/ready
```

Note this does **not** run `prisma migrate deploy` — going backward in code while a forward
migration is already applied is usually fine (older code generally still works against a
superset schema, per how Prisma migrations in this repo are additive), but if the specific
migration in question changed or removed a column the old code depends on, you must resolve the
schema first (see §3) before the code rollback will actually work.

## 3. Database migration rollback

Every migration in this repository has a paired `down.sql`, enforced in CI by
`.github/workflows/migration-harness.yml`. Follow
`docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md`'s documented procedure exactly — do not
improvise raw SQL, and do not assume `prisma migrate resolve` alone reverts schema changes (it
only marks migration state, it does not run `down.sql` for you).

**One explicit exception in the current migration set**: `20260727010000_drop_user_permissions`
drops the `User.permissions` column and backs it up to
`_User_permissions_backup_20260727`. Its `down.sql` can restore the column from that backup, but
— per its own documentation — **cannot reconstruct any permission changes that were made after
the drop**, since those changes had nowhere to be written. This is not a concern for the current
release (nothing writes to a dropped column), but do not treat this migration's rollback as a
clean, lossless undo if it's ever needed months from now after other changes have happened.

## 4. Verifying a rollback succeeded

Run the same smoke tests as a forward deploy (`RELEASE_EXECUTION_PLAN.md` §5):
`/health/ready` returns 200, one login per role succeeds, `pm2 list` shows both `hotel-crm-api`
and `hotel-crm-worker` `online`. If rolling back a flag specifically, re-verify the affected
workflow from the UAT checklist now fails gracefully (404, not a 500) rather than partially
working.

## 5. Communication

This guide does not cover who to notify or when — that is an operational/organizational decision
outside repository scope. Confirm your team's incident-communication process separately; nothing
in this repository defines one.
