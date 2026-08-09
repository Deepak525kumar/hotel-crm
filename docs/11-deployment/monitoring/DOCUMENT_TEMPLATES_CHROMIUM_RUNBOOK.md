# Document Templates — Chromium/Playwright Deployment Runbook

| Field | Value |
|---|---|
| Build item | PR #398, review follow-up (2026-08-10) |
| Runtime | `backend/src/modules/document-templates/pdf-renderer.ts` (Playwright, headless Chromium) |
| Health probe | `GET /api/v1/health/ready` → `checks.chromium` (`backend/src/lib/health.ts`) |
| Provisioning | `deploy.sh` (EC2), `.github/workflows/ci.yml` (CI) |

## What can go wrong, and why it's silent by default

`playwright` (the npm package, installed by `npm ci`) is not the same thing as
the Chromium **browser binary** Playwright drives — that's a separate ~300MB
download (`npx playwright install --with-deps chromium`). An environment that
ran `npm ci` but skipped that step starts up completely normally, serves every
other route correctly, and looks healthy on a shallow `/health` check. It only
fails the first time someone calls `GET /document-instances/:id/preview` or
`POST /document-instances/:id/finalize` — both of which throw at the point
Playwright tries to launch a browser it cannot find.

## How to verify Chromium is actually available after a deploy

**1. Check the readiness endpoint** — this is the fast path, no SSH needed:

```
curl -fsS https://<your-host>/api/v1/health/ready | jq .checks.chromium
```

Expect:
```json
{ "status": "available" }
```

If you instead see `"status": "unavailable"` with a `detail` field naming a
missing executable path, Chromium is not installed on this instance. This
does **not** fail the overall readiness check (`status: "ready"` can still be
true) — a missing browser degrades one feature, not the whole app, so nothing
else will alert on this by itself. **You must check this field explicitly
after every deploy that could plausibly have skipped the install step** (a
fresh EC2 instance, a new AMI, a manually-run deploy that bypassed
`deploy.sh`).

**2. If unavailable, install it directly on the instance:**

```
ssh <ec2-user>@<ec2-host>
cd <project-path>/backend
npx --no-install playwright install --with-deps chromium
```

This is idempotent — safe to run even if you're not sure whether it's already
installed. Re-check step 1 afterward.

**3. Smoke-test an actual render** (proves the browser can actually launch, not
just that the binary exists on disk — a corrupted download or a missing
system library `--with-deps` should have installed can still fail at launch
time even when the executable path itself resolves):

```
cd <project-path>/backend
node --input-type=module -e "
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<h1>smoke test</h1>');
const pdf = await page.pdf();
console.log('OK, PDF bytes:', pdf.length);
await browser.close();
"
```

A non-zero byte count printed with no error means Chromium can actually
render. If this fails while step 1 reported `available`, the issue is a
launch-time problem (missing system library, sandbox/permissions issue in a
locked-down container) rather than a missing binary — check Playwright's own
error output, which usually names the missing dependency directly.

## Where provisioning happens (so it isn't silently skipped again)

- **EC2 / production**: `deploy.sh` runs `npx --no-install playwright install
  --with-deps chromium` unconditionally on every deploy, right after `prisma
  generate`. Unlike the `npm ci` step above it (gated on a `package-lock.json`
  diff), this step always runs — a fresh instance/AMI could be missing the
  Chromium cache even when dependencies haven't changed since the last deploy.
- **CI**: `.github/workflows/ci.yml`'s `ci` job caches `~/.cache/ms-playwright`
  keyed on `backend/package-lock.json`'s hash, then runs the same install
  command before typecheck/lint/build/test.

If either of these steps is ever removed "to speed things up," this whole
class of failure comes back silently — re-add the runbook check above to
whatever replaces it.

## Known gap (tracked, not yet closed)

No automated end-to-end test exercises the real renderer today — the test
suite mocks `renderInstanceToPdf`/`renderSectionHtml` entirely
(`document-templates-service.test.ts`), so a broken Chromium install would
never fail CI, only a real deploy. An E2E smoke test (create a minimal
template → instance → sign → finalize, in a real environment with Chromium
actually installed) is the intended closer for this gap — see `HANDOFF.md`'s
document-templates entry for current status.
