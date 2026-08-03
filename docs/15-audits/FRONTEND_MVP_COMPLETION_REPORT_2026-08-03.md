# Frontend MVP Completion Report — 2026-08-03

Scope: web frontend (`frontend/`) only. Mobile apps (`mobile/worker-app`, `mobile/checker-app`) are out of scope for this report. Compiled from a route-by-route audit of every backend module against its frontend consumer, performed across PRs #310–#319.

## Completed features

Each line lists the backend interface(s) covered and the PR that shipped the frontend for it, where built this session.

| Module | Frontend surface | Notes |
|---|---|---|
| Auth | Login, session, `/profile` (self view) | Pre-existing |
| Users | List, detail, create, edit, role change, deactivate, **revoke-all-sessions** (#315) | |
| CRM (Hotels / Hotel Groups) | Full CRUD, detail pages | Pre-existing |
| Job Requests (core) | List, detail, create, edit/publish | Pre-existing. Broadcast/marketplace routes excluded — see Feature-Flagged Work |
| Assignments | List, detail, status transitions (start/complete/cancel), **rooms-completed logging** (#314) | |
| Attendance | List with filters, detail, check-out, manager review/verify | Pre-existing |
| Quality | Leaderboard (pre-existing), **verification + rating logging** (#319, role-gate corrected to admin+checker matching `quality:write`) | |
| HR | Payslip requests (list/create/fulfil, pre-existing), **contract lifecycle** — status, create, upload-signed, confirm, extend, lapse (#310) | |
| Documents | Upload/list (pre-existing), **completeness check + work-permit-required toggle** (#313) | |
| Employee Management | **Hotel blocklist** (read unrestricted, write admin/manager) (#311) | Everything else blocked — see Feature-Flagged Work |
| Calendar | Availability badge (pre-existing), **worker self-service absences** (list/mark) (#312) | Daily-operations excluded — see Intentional Exclusions |
| Consent | **Daily GDPR access-gate**: status, notice review, grant/decline, withdraw (#316) | `chatbot-data-processing` instance excluded — see Intentional Exclusions |
| Compliance | **GDPR subject-rights export**: bundle summary + JSON download (#317) | |
| Analytics | Manager dashboard + leaderboard (pre-existing), **worker self-service `my-stats`** (#318) | |
| Geo Check-ins | List, detail | Pre-existing |
| Notifications | List, mark-read, in-app bell | Pre-existing. Outbox/dead-letter admin tooling excluded — see Intentional Exclusions |

## Remaining intentional exclusions

Backend routes exist and are unblocked, but were judged out of MVP frontend scope per standing project rules (no ops tooling, no dashboards beyond MVP, no chatbot):

- **Notifications outbox admin tooling** — `GET /notifications/outbox/metrics`, `GET /outbox/dead-letters`, `POST /dead-letters/:id/requeue`, `DELETE /dead-letters/:id`. Admin-only queue monitoring/remediation. Confirmed with user 2026-08-03: excluded.
- **Retention audit-log / eligibility** — `GET /retention/audit-log`, `GET /retention/eligibility`. Keyed by opaque `module_id`/`category_id`/`record_ref` strings with no lookup or natural UI entry point; internal governance query, not a user-facing feature. Confirmed with user 2026-08-03: excluded.
- **Calendar daily-operations** — `GET`/`POST /calendar/hotels/:hotel_id/operations`. Confirmed dead: both handlers throw `NotImplementedError`, and the backing `DailyOperation` Prisma model has been physically removed from the schema (`schema.prisma`: "Removed: Room, Task, TaskPhoto, DailyOperation"). Not buildable against; not a frontend gap.
- **Chatbot** — excluded per standing project instructions, independent of backend state.
- **Web Push token registration** (`POST /notifications/push-tokens`) — already fully consumed by `mobile/worker-app` and `mobile/checker-app`. Building a browser equivalent would require inventing new infrastructure (service worker, VAPID keys, Web Push permission flow) that doesn't exist anywhere in this codebase — out of scope for "add UI to an existing endpoint."
- **Job Dispatch broadcast/marketplace UI** (`POST /work-requests/broadcasts`, `GET .../eligibility`, `POST .../accept`, `POST .../close`) — see Feature-Flagged Work; listed here too since even if flagged on, this is Phase 2 marketplace functionality of debatable MVP priority.

## Remaining feature-flagged work

All flags below default OFF in `backend/src/config/env.ts` and are not overridden in `backend/.env` or `backend/.env.staging` — confirmed by direct inspection, not assumption.

| Flag | Gates | Frontend impact if left off |
|---|---|---|
| `FEATURE_EMPLOYMENT_RECORD` | Entire `/employees/*` route mount (`routes/v1/index.ts`) | **Blocks 4 further PRs**: employee profile + skills view, org chart (Regional Manager/Admin), special-category fields + admin export, create-employee/bulk-import. The Blocklist UI shipped in #311 already calls this gated mount — **it 404s in every environment as currently configured.** Flagged to user at #311; user chose to handle separately, not addressed by this session. |
| `FEATURE_JOBDISPATCH_PHASE2` | `/work-requests/broadcasts*` routes | Blocks the marketplace/broadcast worker-accept flow. |
| `FEATURE_RM_ROLE` | Regional Manager role promotion (M-3) | No live Regional Manager accounts exist yet; frontend already widens types defensively (`Role` union includes `regional_manager`) so no code change is blocked, just no real users to exercise it. |
| `FEATURE_GD02_MATRIX`, `FEATURE_JOBDISPATCH_PHASE1` | Not surveyed for frontend impact this session | Out of this report's scope; flagging for awareness only. |

**Action needed from the user, not this session:** decide whether to enable `FEATURE_EMPLOYMENT_RECORD`. Until then, Employee Management work cannot proceed, and the merged Blocklist UI (#311) will continue to fail at runtime.

## Known runtime validation gaps

No frontend test suite exists in this repository (checked `package.json` — no `test` script, no `*.test.*` files under `frontend/`). Every PR this session was validated via `tsc --noEmit`, `eslint`, and `npm run build` only — **no PR in this session received actual browser/runtime verification**, because no running backend instance was available in this environment. This is a real gap, not a formality:

- **PR #311 (Blocklist UI) is confirmed broken at runtime today** — see Feature-Flagged Work above. This was never caught by typecheck/lint/build, only by manually inspecting the flag gate.
- Several PRs rely on backend error messages being surfaced verbatim through `FormError` (e.g. `ConflictError` on duplicate rooms-completed/verification/rating, past-date absence rejection, blocklist not-found). The *wiring* was verified by reading `apiFetch`'s error-handling code, but the actual error text has never been seen rendered in a browser.
- RTL rendering (`ConsentCard`'s `dir="rtl"` for Arabic/Urdu notices) has never been visually verified.
- File download (`ExportMyDataCard`'s JSON blob download) has never been exercised in an actual browser — `Blob`/`createObjectURL`/anchor-click is standard but untested here.
- Multipart file uploads (Documents, HR contract-scan) have never been exercised against a real multer-backed endpoint in this session.
- Optimistic SWR cache updates (`ConsentCard`'s `statusFromRecord`) have never been observed against real network timing/races.

## Suggested integration-testing checklist

Before this frontend work ships to real users, someone with a running backend + browser should verify:

1. **Flag-dependent breakage**: confirm `/employees/*` truly 404s with `FEATURE_EMPLOYMENT_RECORD` off, and that the Blocklist UI degrades gracefully (not a crash) rather than just failing silently.
2. **Conflict/duplicate paths**: submit a second rooms-completed entry, verification, rating, and blocklist entry for the same key each — confirm the `ConflictError`/`NotFoundError` message renders legibly in `FormError`, not as a raw stack trace or blank state.
3. **Self-scoped write correctness**: as a worker, confirm `AbsencesCard`, `ConsentCard`, `MyStatsCard`, and `ExportMyDataCard` all operate on the logged-in user's own data with no way to target another `worker_id` from the UI (defense-in-depth check — the backend is authoritative, but the UI should never even offer the wrong control).
4. **Role-gate accuracy**: for every `RoleGate`/permission-gated action added this session (HR contracts, Blocklist write, rooms-completed, quality verify/rate, revoke-sessions), log in as each bordering role (e.g. manager for quality actions) and confirm the UI's visibility matches the backend's actual 200/403 — the quality verify/rate gate was already caught wrong once during review (#319) and corrected; the same class of bug could exist elsewhere undetected.
5. **File flows**: upload a document and an HR signed-contract scan end-to-end against a real S3-backed (or stubbed) storage client; download a subject-rights export JSON and confirm it opens/parses correctly.
6. **RTL notice rendering**: switch a test account's language to Arabic or Urdu and confirm the consent notice renders right-to-left correctly.
7. **Token-revocation self-service**: as an admin, revoke your own sessions and confirm the app cleanly bounces to `/login` via the existing `TOKEN_REVOKED` handling, rather than hanging or erroring.
8. **Pagination/large lists**: nothing this session added new paginated lists, but existing ones (leaderboard, users, hotels) should be spot-checked against a seeded dataset large enough to exercise `has_next`/`has_prev`.
9. **Session-local-only data**: confirm the documented tradeoff (rooms-completed, verification, rating results vanish on reload since no GET endpoint exists) behaves as described — not as a silent bug — and that this is acceptable to stakeholders before wider rollout.

## Estimated frontend completion

**~85–90%** of the non-flagged, non-stub backend route surface has a web frontend consumer as of this report.

- Reaches **~95%+** if `FEATURE_EMPLOYMENT_RECORD` is enabled and the 4 blocked Employee Management PRs are built.
- The remaining 10–15% gap today is almost entirely: (a) Employee Management, blocked on the flag decision above, and (b) the explicitly-excluded ops tooling (Notifications outbox, Retention audit) and Chatbot, none of which are counted against MVP completion per standing project scope.
- This percentage measures **route coverage**, not verified correctness — see Known Runtime Validation Gaps above. No PR in this session has been exercised against a live backend in a browser.
