# E2E Run — 2026-08-17 — daily consent gate (PR #485) verification

- **Commit under test:** `b7cb91b` (branch `claude/daily-consent-gate`)
- **Environment:** local dev — Docker Postgres + Redis, backend `:3001`, frontend `:3000`
- **Executed by:** Claude (agent session)
- **Stack versions:** Postgres 16 (`hotel-crm-postgres-1`), Node 20, 58 migrations
- **Flags:** `FEATURE_EMPLOYMENT_RECORD=true`, `FEATURE_RM_ROLE` absent (off),
  `FEATURE_CONSENT_GATE` — run **twice**: default-off baseline, then `true`

## Scope

This run targets the daily consent gate specifically, plus a regression check that the gate
does not break the wider system. It is **not** a full 00–10 sweep — see "Could not test".

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | **PASS** | Migrations clean; fresh-DB drift check `No difference detected` |
| Gate OFF baseline | **PASS** | Confirms the defect the gate fixes (below) |
| Gate ON — enforcement | **PASS** | 403 `CONSENT_REQUIRED` on 6 data routes |
| Gate ON — escape hatches | **PASS** | All reachable while gated |
| Gate ON — accept flow | **PASS** | Verified in Postgres, not just the response |
| Gate ON — decline → re-accept | **PASS** | `RULE-CONSENT-02` supersession |
| Gate ON — manager notification | **PASS** | `REQ-CONSENT-003` |
| Gate ON — admin exemption | **PASS** | Zero consent records, full access |
| Gate ON — bypass attempts | **PASS** | No prefix-confusion bypass |
| Gate ON — 401 vs 403 precedence | **PASS** | Auth failure wins over consent |
| Gate ON — cache / withdrawal | **PASS** | Withdrawal immediate, not TTL-delayed |
| Gate ON — calendar-day rollover | **PASS** | Yesterday's grant does not admit |
| 07 Frontend UI (Playwright) | **PASS** (after 2 fixes) | 6 RTL tests + a purpose-written gate test |

### The defect this gate fixes, observed directly

With `FEATURE_CONSENT_GATE` off, a regional manager whose consent status was **`absent`**
received `HTTP 200` on `/notifications`. That is the pre-existing hole: `RULE-CONSENT-01`
requires the block, and nothing enforced it. With the flag on, the same token on the same
route returns `403 CONSENT_REQUIRED`.

### Data-layer verification (not response-only)

```
ConsentRecord for cg-rm2:  DECLINED 22:16:28  →  GRANTED 22:16:38   (both rows retained, immutable)
Notification:              CONSENT_DECLINED → the group's regional_manager_user_id
```

The decline → manager-notification path only fires for an **ACTIVE** employment record with a
`hotel_group_id`; against a `PENDING` record it correctly no-ops (`service.ts`
`notifyResponsibleManager` returns early). A first attempt appeared to show a missing
notification — that was the test subject's state, not a defect. Re-tested with an ACTIVE
worker in a group with an RM assigned, and the row appeared.

### ADR-068 verified end-to-end

A gated user changed `preferred_language` to `uk` via `PUT /auth/profile` (exempt) **while
blocked**, then re-fetched the notice and received `language=uk`, `rtl=false`. This is exactly
the case that previously fell back to German, and it exercises two escape hatches in sequence.

### Lockout-critical exemptions confirmed live

| Route | Result |
|---|---|
| `POST /auth/refresh` while gated | **200** — the permanent-lockout case is closed |
| `PUT /auth/profile` while gated | 200 |
| `GET /auth/me`, `/consent/*`, `/health` | 200 |
| `/consent-fake`, `/consentXYZ`, `/healthz`, `/users/../notifications` | 403 — no bypass |
| no token / bad token on a gated route | **401**, not 403 — auth failure wins |

Once consented, `/employees/review-queue` returns `FORBIDDEN` for an out-of-scope RM — the
gate layers on top of authorization without masking it.

## New defects found

1. **Web `ConsentGate` used a design-system-less button** — `frontend/components/consent/ConsentGate.tsx`
   — **Medium (UX/GDPR affordance)** — fixed this run.
   Hand-rolled Tailwind (`bg-primary`, `text-primary-foreground`) rendered **Grant unstyled
   while Decline kept a visible border**, making Decline look like the emphasised choice on a
   consent screen. Only a screenshot could catch this — the DOM assertions passed. Replaced
   with the shared `components/ui/Button` (`variant`, `loading`).
2. **Undefined Tailwind token `text-muted-foreground`** — same file — **Low** — fixed this run.
   Not defined in this project (only one other file uses it). Replaced with the
   `text-gray-600 dark:text-gray-400` convention `ConsentCard.tsx` already uses.

Neither is a server-side or enforcement defect; the gate itself behaved correctly throughout.

## Environment/config problems (not code defects)

1. **`@playwright/test` was not installed** in the workspace — `npx playwright test` failed with
   `MODULE_NOT_FOUND`. Installed with `npm install --no-save @playwright/test`. Worth adding to
   scenario 00's preconditions.
2. **Playwright's own web server (`:3100`) served a stale build** without the gate, producing a
   false failure: the dashboard rendered with no consent wall while five 403s fired in console
   and **no `/consent` request was made at all**. Re-running against the live dev server with
   `E2E_BASE_URL=http://localhost:3000` showed the gate working correctly. **If a UI change
   appears to have no effect under Playwright, check this first** — it looks exactly like a
   missing component.

## Scenario 00 corrections needed

`POST /api/v1/users` now requires **`phone`, `job_title`, `start_date`, `employment_type`** —
none documented in scenario 00 §4. Discovered by three successive 422s.

Also: an **admin may only create `regional_manager`** (ADR-065 hierarchy). Scenario 00's table
implies admin creates all six users directly; it cannot. Managers/workers/checkers must come
down the hierarchy, and each new user starts `PENDING` with no `hotel_group_id`.

## Could not test

1. **Scenarios 01–06, 08–10 in full** — this run was scoped to the consent gate plus a
   regression check. The gate is orthogonal to onboarding/documents/race conditions, and those
   flows were exercised only incidentally.
2. **Mobile apps against the live stack** — verified by unit tests and typecheck only; no
   simulator/device run. The mobile `ConsentGate` mirrors the web one, which *was* verified in a
   real browser, but that is inference rather than observation.
3. **Multi-process cache divergence** (pm2 cluster) — single-process dev server only. The
   grant→withdraw sibling-process window described in the runbook is untested.
4. **The 15-minute token-expiry-on-the-locked-screen case** end-to-end. `/auth/refresh` was
   verified reachable while gated, which is the mechanism, but not the full wait.
5. **A real notice** — content is a placeholder in all 13 languages, so nothing here says
   anything about how real legal copy renders.

## Scenario files updated this run

None yet — the scenario-00 corrections above and a new consent-gate scenario should be written
up. Recorded here so the next run inherits them rather than rediscovering three 422s.
