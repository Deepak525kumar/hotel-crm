# Release Notes — Hotel CRM MVP

Last synchronized 2026-08-04 (Release Candidate documentation pass).

## Summary

Engineering implementation is complete. This release turns on functionality that has already
been built and merged, and reconciles the production deployment architecture (PM2 process
topology, deploy script, deploy pipeline) with what's actually running in production. No new
product features were added in this release cycle.

## What's newly enabled (feature flags)

- **Employment Record management** (`FEATURE_EMPLOYMENT_RECORD`) — admins can create and manage
  worker employment records through their lifecycle (INACTIVE → UNDER_REVIEW → ACTIVE);
  managers can view employment profiles, skills, and hotel blocklists.
- **Split permission matrix** (`FEATURE_GD02_MATRIX`) — hotel create/edit/delete narrows to
  admin-only; hotel-group read access expands appropriately; permissions are now derived at
  request time from role rather than a stored column (the stored `User.permissions` column has
  been retired and dropped).
- **Job Dispatch Phase 2** (`FEATURE_JOBDISPATCH_PHASE2`) — broadcast job offers (raise, close,
  accept, eligibility check) and manager-driven calendar direct-assignments
  (`/assignments/calendar-entries`) are live.

## What's explicitly not in this release

- **Regional Manager role** (`FEATURE_RM_ROLE`) — code is complete server- and client-side (the
  mobile/frontend work has already shipped), but the role-promotion mechanism is not cleanly
  reversible once used, with no demote path built yet. Held for a future release pending that
  decision.
- Frontend automated test coverage — not part of this project's Definition of Done; tracked as a
  post-MVP improvement, not a gate for this release.
- Chatbot module, compliance governance report, calendar "Operations" UI, offline sync, advanced
  analytics — all previously and correctly scoped out of MVP; unchanged by this release.

## Deployment tooling fixes and reconciliation

These are infrastructure/tooling changes only — no application behavior changes for end users:

1. Fixed the deploy pipeline's post-deploy health check to verify database connectivity
   (`/health/ready`), not just process liveness (`/health`).
2. Fixed stale APNs bundle-ID environment variable names in the environment template files
   (including `scripts/setup-ec2.sh`'s provisioning template) and in CI's test-job configuration,
   which referenced a retired single variable instead of the two variables (one per mobile app)
   the code has actually read since push notifications were split per app.
3. Fixed the root `package.json`'s `type-check` script, which called a backend script name
   (`type-check`) that doesn't exist — the backend's actual script is `typecheck` (no hyphen).
4. **Reconciled the production PM2 process topology with the repository.** `ecosystem.config.js`
   now declares exactly the two processes (`hotel-crm-api`, `hotel-crm-worker`) that live
   production actually runs, at the correct working directory and env-file path. `deploy.sh` now
   lives at the repository root (the previous `scripts/deploy.sh` copy was removed) and reloads
   both processes together via `pm2 reload ecosystem.config.js`. This closes what was previously
   an open, unconfirmed risk between this repository's infrastructure-as-code and what was
   actually deployed.

**Two smaller artifacts were not part of this reconciliation and remain open** (see
`KNOWN_LIMITATIONS.md`): `scripts/rotate-secrets.sh` still targets a stale env-file path and
misses one of the two processes; `nginx/hotelcrm.conf` still carries a server block for a
frontend process that no longer runs on this host (the frontend deploys separately, on Vercel).

## Push notifications

Push notification delivery code (APNs and FCM provider integrations, device-token registration,
deep-link handling) is fully implemented. This release does not change that code. What matters
operationally: confirm real APNs and Firebase credentials are configured in the deployed
environment before relying on push-driven notifications — see the Deployment Guide and
Production Launch Checklist.

## Known limitations

See `KNOWN_LIMITATIONS.md` in this directory.

## Post-MVP backlog

See `POST_MVP_BACKLOG.md` in this directory.
