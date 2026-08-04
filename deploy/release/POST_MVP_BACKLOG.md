# Post-MVP Backlog — Hotel CRM

Last synchronized 2026-08-04 (Release Candidate documentation pass). Extracted from repository
evidence gathered across the MVP audit and release-readiness passes. Nothing here is required
for this release. Ordered roughly by how directly it affects production operability, not by
business priority (that call belongs to the user).

## Deployment / operability

1. **Add a demote path for the Regional Manager promotion script** — client support for
   `regional_manager` already exists and works (frontend and both mobile apps). The only
   remaining item is `backend/src/scripts/run-regional-manager-promotion.ts` having no
   corresponding demote script, making the promotion a one-way operation. Build that before
   enabling `FEATURE_RM_ROLE` in production.
2. **Fix `scripts/rotate-secrets.sh` to match the reconciled PM2 topology** — it still targets
   `/etc/hotel-crm/.env` (the running processes now load env from `backend/.env`) and reloads
   only `hotel-crm-api` (missing `hotel-crm-worker`). Update both before relying on this script
   for a real secret rotation.
3. **Remove or explicitly annotate the vestigial frontend server block in
   `nginx/hotelcrm.conf`** — it proxies to `127.0.0.1:3000`, but nothing runs there; the
   frontend is deployed separately on Vercel. Left in place today only because removing nginx
   config is a deployment-affecting change, not a documentation fix.
4. **Reconcile `scripts/setup-ec2.sh` with the current deploy topology** — it still provisions
   `/opt/hotel-crm` under a `deploy` user with secrets at `/etc/hotel-crm/.env`, none of which
   matches the reconciled `deploy.sh`/`ecosystem.config.js` (`/home/ubuntu/apps/hotel-crm`,
   `backend/.env`). Only matters if a new host is ever provisioned from this script — no impact
   on the existing running host.
5. **Add a scripted rollback job** — a "redeploy previous SHA" GitHub Actions job, rather than
   the current manual SSH procedure.
6. **Add a Redis readiness check** to `/api/v1/health/ready` alongside the existing Postgres check.
7. **Wire log aggregation** (CloudWatch Logs or equivalent) for PM2's local log files.
8. **Automate Secrets Manager → EC2 sync** instead of manual `backend/.env` edits.
9. **Build an admin UI for the notification outbox** (metrics, dead-letter list, requeue/discard)
   — the API already exists and is role-gated; only the frontend consumption is missing.
10. **Wire push-delivery failures into Sentry** (or whatever alerting is chosen) — currently only
    worker-process uncaught exceptions reach Sentry; per-notification send failures are log-only.
11. **Add push-token invalidation on logout** — tokens are currently only cleaned up reactively
    when a provider reports them invalid, not proactively on logout.
12. **Add a push-token rotation listener** in both mobile apps instead of relying on opportunistic
    re-registration at next app-shell mount.
13. **Track APNs/Apple Developer account expiry** — no automated reminder exists for bundle
    ID/Developer account lifecycle.
14. **Delete the vestigial `FEATURE_JOBDISPATCH_PHASE1` flag** and its dead accessor — confirmed
    to gate nothing; pure cleanup.
15. **Fix the stale `deploy-production.yml` cross-reference** in
    `docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md` — it points at a workflow file that
    doesn't exist in this repository.

## Testing

16. **Add frontend automated test coverage** — no test script or test files exist today; not a
    current Definition-of-Done requirement, but a real coverage gap relative to backend and
    mobile, which both have CI-blocking Jest suites.

## Product (explicitly out of MVP scope, confirmed still true)

17. Chatbot module (directory exists as a placeholder only, referenced as a future consumer in
    consent/employee-management code comments).
18. Compliance governance report (`IF-COMPLIANCE-GetGovernanceReport`) — blocked on an
    unresolved RBAC decision for an Admin/DPO caller class (`OD-COMPLIANCE-006`). Note: the
    compliance module itself (`backend/src/modules/compliance/`) is real, implemented code —
    only this specific governance-report interface is deferred, not the whole module.
19. Manager Operations Calendar UI as originally conceived — the underlying `/operations` stub is
    architecturally superseded by `assignments/calendar-entries`; the dead route/stub code could
    be deleted as cleanup but isn't required.
20. Offline sync for either mobile app.
21. Advanced analytics beyond what's already built.
22. Enterprise integrations.
23. Standalone Quality web page (functionality already reachable via the Assignments detail page).

## Access control follow-ups (flagged by UAT, not yet confirmed as defects)

24. **Retention audit-log/eligibility role gating** — repository evidence suggests no role check
    exists on these routes. Confirm via UAT (checklist item A10); if confirmed, this becomes a
    real security fix, prioritized ahead of everything else in this list.
25. **Worker ratings screen vs. manager-gated analytics endpoint** — confirm via UAT (checklist
    item W20) whether this is a live defect or already handled correctly.
