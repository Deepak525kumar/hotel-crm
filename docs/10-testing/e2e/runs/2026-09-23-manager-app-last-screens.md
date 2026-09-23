# E2E Run — 2026-09-23 (third pass) — the last three manager-app screens

- **Commit under test:** `d99f0914` → `378c2266` (branch `claude/manager-app-dto-contracts-2609`, PR #699)
- **Environment:** local dev — backend :3001, Postgres `hotelcrm_dev`, Redis
- **Executed by:** Claude Opus 5 (agent session)
- **Flags:** `FEATURE_EMPLOYMENT_RECORD=true`; `FEATURE_JOBDISPATCH_PHASE2` off

Built S-30, S-36 and S-37 — the remainder of `MANAGER_APP_PLAN.md` §7's screen
map — and exercised the report exports against the live API while doing so.

> Split from the second-pass log rather than appended to it: a run log is
> historical and gets a new file, never an edit (`docs/CLAUDE.md`). The
> addendum that briefly lived at the end of
> `2026-09-23-manager-app-hr-analytics.md` is this file.


Built S-30, S-36 and S-37, and exercised the report exports against the live
API while doing so.

### A defect the screen work uncovered

`POST /reports/export` requires `dataset`, `format`, `from` **and** `to`. The
mobile client sent `{ dataset: 'attendance' }` and nothing else, so **every
team export the app could make was rejected** — and because the route used a
bare `.parse()`, a missing field threw a raw ZodError that the handler
rendered as `500 INTERNAL_ERROR`. It read as the server being broken rather
than the request being incomplete.

| Request | Before | After |
|---|---|---|
| `{dataset}` only | `500 INTERNAL_ERROR` | **`422`**, naming `format`, `from`, `to` |
| full valid body | `500` | reaches generation and upload |

Both halves fixed: the route validates with `safeParse` → `ValidationError`
(matching the `parseRange` helper already in that file), and the client's
`exportTeam` signature now requires all four fields. Pinned by two new tests
in `mobile/manager-app/src/__tests__/api-contract.test.ts`, one of which
asserts the screen offers **every** dataset the server declares.

### Could not test — recorded, not a pass

**The upload itself.** All four datasets now pass validation and fail at
`storage.upload()` with `"Your session has expired. Please reauthenticate."`
— an **AWS STS** message: the local AWS session is expired. That is an
environment problem, not a code defect, and it is the reason this addendum
does not claim the export works end to end. What is proven is that the
request now reaches generation instead of being rejected before it starts.
Re-run with valid AWS credentials to close it.

### Screens added

- **S-37 `/reports`** — all four datasets, preset ranges, xlsx/pdf. Preset
  ranges rather than a date picker: the server requires both bounds, refuses
  `from > to` and caps the span at 366 days, and a preset cannot express any
  of those mistakes — nor does it add a native module (`mobile/CLAUDE.md`
  rule 4). Reachable from More → Analytics.
- **S-30 `/notification/[id]`** — the list could mark a row read and nothing
  else. Reads from the list rather than a new endpoint (there is no
  `GET /notifications/:id`), and reuses `resolvePushTapRoute` so an in-app tap
  and a push tap cannot disagree about where a notification leads.
- **S-36 `/admin/hotels/new` and `/admin/hotel-groups/new`** — create and edit
  in one screen each, admin-gated client-side on `admin` alone rather than
  mirroring `SIR-CRM-020`'s flag-dependent server quirk.

Manager-app suite: 175 → **182** tests, with `route-targets-exist` and
`more-menu` picking up the new routes automatically.
