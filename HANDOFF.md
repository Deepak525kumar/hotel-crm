# Hotel CRM — MVP Handoff

Last updated: 2026-08-04
Current branch: `feat/worker-mobile-hr` (investigation only, zero code changes — safe to delete or reuse)

## How to resume

This project has been following a strict workflow for every worker-facing mobile feature:

1. **Investigate** — read the backend module (routes/controller/service/types), the web implementation (if any), and the mobile app's current state. Cite exact files/lines. Never assume a contract shape — read it.
2. **Stop if a backend capability is genuinely missing** — produce an evidence package, do not invent an API or silently work around a gap.
3. **Plan** — present scope, architecture, file list, execution order. Wait for explicit approval before writing code.
4. **Implement** — small, focused diffs, matching existing repo conventions exactly (see "Codebase conventions" below).
5. **Review** — dispatch four independent subagent reviews in parallel (architecture, dependency, security, consistency) against the staged diff. Fix every actionable finding; document (don't silently fix) anything out of scope.
6. **Validate** — typecheck, lint, full test suite, all must be clean (or match the pre-existing baseline — see below).
7. **PR, confirm with user before pushing, merge.**

Do not skip steps 1–3 to "just start coding" — every deviation from this sequence in this project has produced worse outcomes than following it.

---

## What's done (merged to `main`)

### PR #330 — Worker Onboarding Flow (Employee Management admin UI)
- New backend endpoint: `GET /employee-management/by-user/:user_id` (returns `EmploymentRecord | null`, not 404).
- New frontend `WorkerOnboardingCard` on the admin user-detail page (`frontend/app/(protected)/users/[id]/page.tsx`), letting an admin create + drive a worker's `EmploymentRecord` through its lifecycle (`INACTIVE → UNDER_REVIEW → ACTIVE`).
- **Known gap, not fixed, flagged in PR**: `FEATURE_EMPLOYMENT_RECORD` defaults `false` and is **not set** in `backend/.env` or `backend/.env.staging`. This entire feature is inert until an operator flips that flag in the relevant environment. **This is probably still true — check `backend/.env`/`.env.staging` before assuming onboarding works in any deployed environment.**

### PR #331 — Worker Mobile Documents
- Ported web's Documents feature (`frontend/components/documents/DocumentsCard.tsx`) to `mobile/worker-app`.
- New screen `mobile/worker-app/src/app/documents.tsx`, reached via a link on Profile.
- Added `expo-document-picker` (new native dependency, only one in this whole mobile-porting sequence).
- Fixed `mobile/worker-app/src/lib/api.ts`'s `request<T>()` to skip the default `Content-Type: application/json` when the body is FormData-like (duck-typed check, not `instanceof`).
- **Known backend bugs found, NOT fixed (flagged in PR, still open)**:
  1. `backend/src/modules/documents/validation.ts`'s `uploadDocumentSchema` declares `is_work_permit: z.boolean().optional()`, but multipart fields always arrive as strings. Verified empirically: `z.boolean().optional().safeParse('true')` fails. **Uploading a document with the work-permit flag set likely 422s today, on web too** (same contract, web has the identical bug, never caught because no existing test sends that field). Needs a `z.preprocess` or similar fix in that one file.
  2. `backend/src/modules/documents/service.ts`'s `getDocumentCompleteness` has no worker self-scope check (its three sibling methods all correctly deny a worker querying another worker's data; this one doesn't). Not currently exploitable — no client anywhere calls `completeness()` — but must be fixed before anything does.

### PR #332 — Worker Mobile Consent
- Ported web's Consent feature (`frontend/components/consent/ConsentCard.tsx`) to `mobile/worker-app`.
- New screen `mobile/worker-app/src/app/consent.tsx`, reached via a Profile link.
- No new dependency, no backend changes — pure JSON CRUD against an already-frozen contract (`SPEC-CONSENT-001@0.2.0`).
- Established a smaller/cleaner internal pattern than Documents: no custom hook (flow was simple enough for plain `useState`), no optimistic updates (mobile has no SWR to seed, so every action awaits then sets state from the real response), pure status→action mapping extracted to `lib/consent-status.ts` and unit-tested directly.
- Only the `daily-access-gate` consent instance is surfaced (`chatbot-data-processing` excluded — Chatbot module is unbuilt, out of MVP scope, matches web's own exclusion).
- **Confirmed architectural fact, load-bearing for how this feature is framed**: the daily consent gate does **not** block app access anywhere in the backend. No middleware/route enforces it. Both backend (`consent/service.ts`'s own code comment) and web (`ConsentCard.tsx`'s own code comment) explicitly describe this as "a self-service record/decision surface, not an access-blocking wall." Mobile mirrors that posture. **Do not build access-enforcement on top of this without a new, explicit decision — it would contradict the established architecture.**

### Established mobile-app conventions (apply these to every future mobile PR)
- **No shared state-management library** (no SWR/react-query equivalent) — every screen manages its own `useState`/`useCallback` load/error/pending cycle locally. This is deliberate, confirmed working across 3 PRs; don't introduce one without a real, demonstrated need.
- **No component library** beyond `ThemedText`/`ThemedView`/`Spacing` (from `constants/theme.ts`) — forms use plain `Pressable`/`TextInput` styled inline via `StyleSheet.create()`, not a design-system kit. There is no `Select`, `Checkbox`, `Modal`, or `Badge` component on mobile (unlike web, which has a full `components/ui` kit).
- **No semantic theme colors** — `constants/theme.ts`'s `Colors` object only has neutral tokens (`text`/`background`/`backgroundElement`/`backgroundSelected`/`textSecondary`). Every status color (success/error/warning) anywhere in this app is a hardcoded hex literal, **colocated with the component that renders it** (e.g. `shifts.tsx`'s `STATUS_COLOR`, `absences.tsx`'s `KIND_COLOR`), never centralized in a shared `lib/` function. Follow this pattern, don't invent a new one.
- **Navigation pattern**: new worker self-service features are stack screens (`mobile/worker-app/src/app/<feature>.tsx`), reached via a link row on `mobile/worker-app/src/app/(app)/profile.tsx` — **not** new tabs. The tab bar (`(app)/_layout.tsx`) has 6 tabs already (Dashboard, Jobs, My Shifts, Sick/Vacation, Alerts, Profile) and should stay that way.
- **Test conventions**: this app's Jest config (`testEnvironment: 'node'`) cannot import real Expo native modules (e.g. `expo-document-picker`) — they fail to parse. Any pure logic that needs testing (validation, status-mapping, etc.) must live in a file with **zero native-module imports**, separate from the file that does the native import, so it can be unit-tested directly. No React Testing Library / component-rendering test library exists — test pure functions, not rendered components.
- **Known pre-existing lint baseline**: `npm run lint` in `mobile/worker-app` fails with a fixed set of `react-hooks/set-state-in-effect` errors in `offer/[id].tsx`, `shift/[id].tsx`, `use-color-scheme.web.ts`, and — as of PR #331/#332 — `documents.tsx`/`consent.tsx` too (each has a `useEffect(() => { load(); }, [load])` pattern the linter flags). This is a **known, already-tolerated, unfixed** class of lint error — every new screen that fetches data on mount will add one more instance of it. Don't try to fix it repo-wide as a side effect of a feature PR; just confirm the count only grows by exactly one error per new screen (compare before/after) and flag it in the PR description, same as the last two PRs did.

---

## What's left for MVP

### 1. Worker Mobile HR Self-Service — IN PROGRESS, investigation complete, blocked pending a decision

**Status**: fully investigated. A backend gap was found and the user (project lead) has already decided how to proceed — **do not re-litigate this decision, just execute it.**

**The decision**: build a small, additive backend change FIRST (its own PR), then build the mobile HR screen as a second PR — not a combined PR, not mobile-only with a degraded UX.

**Evidence already gathered** (don't re-investigate, this is settled):
- Backend `backend/src/modules/hr/routes.ts` has exactly two worker-usable routes:
  - `GET /hr/workers/:worker_id/contract-status` — worker self-access via `hr:contract:read-own` permission token, self-scope double-checked in `hr/service.ts:243-245` (`getContractStatus`). Returns `ContractDto | null`. **This one already works for workers, no backend change needed.**
  - `POST /hr/payslip-requests` — worker-only (`requireRole('worker')`, `hr:payslip:request` token), body `{period_start, period_end}` only, `worker_id` always server-derived. **Already works.**
- **The gap**: there is no route letting a worker list their own past payslip requests. `GET /hr/payroll` (the only list endpoint for `PayslipRequestDto`) is hard-gated `requireRole(['admin', 'manager'])` at the route layer (`hr/routes.ts:113`). The service method (`hrService.listPayroll`, `hr/service.ts:644-667`) already has `worker_id`-filtering logic that *could* self-scope — the route guard is the only thing blocking it. A worker can create a payslip request but never see whether it was fulfilled.
- Web has **no** worker-self-service HR UI at all (confirmed: `hrApi` has no method calling `POST /hr/payslip-requests`; `ContractCard`/`PayslipRequestsCard` are both admin/manager-only via `HrPayrollGate = allow: ["admin","manager"]`, viewing *a worker's* data, not the worker's own view). **This means the mobile HR screen is new UI construction, not a port** — unlike Documents/Consent, there's no existing web pattern to mirror for the worker-facing interaction. Use the web components' *data shapes* (`Contract`/`PayslipRequest` types in `frontend/lib/types.ts:925-972`) as a shape reference only, not their UX.

**Immediate next task — PR 1 (backend)**:
1. Add a new permission token (`hr:payslip:read-own`, following the exact naming/precedent of `hr:contract:read-own` — see `backend/src/config/constants.ts` around line 191-196, and the `ADR-042` comment there explaining why a dedicated narrower token was created for the contract-read case).
2. Widen `GET /hr/payroll`'s route guard to also admit `worker`, using the same `requireContractReadAccess()`-style role-specific-token pattern already established in `hr/routes.ts:62-67` for contract-status (worker needs `hr:payslip:read-own`, not `hr:read`).
3. Self-scope the worker's results — the service already supports filtering by `worker_id`; ensure a worker caller is forced to their own `worker_id` (mirroring `getContractStatus`'s `actorId !== workerId → ForbiddenError` pattern) rather than trusting a query param, to avoid an IDOR (a worker must not be able to pass another worker's `worker_id` and see their payslip history).
4. Add backend tests for the new worker-self-read path (both the happy path and the IDOR-denial path), following this module's existing test conventions in `backend/src/__tests__/`.
5. Same 4-gate review process (architecture/dependency/security/consistency via parallel subagents) before merge — this is a real permission/authorization change, treat it with full rigor even though it's small.

**Then — PR 2 (mobile)**, scope confirmed by the user:
- **Contract section** (read-only): status, position, start date, end date. No contract type field exists in the backend DTO — don't invent one; the actual fields are exactly what `ContractDto` has (`hr/types.ts:17-33`).
- **Payslips section**: request payslip (period start/end date inputs), list of previous requests with Pending/Fulfilled badge and request date.
- **Explicitly excluded** (all are `requireRole(['admin','manager'])`-only in the backend, no worker self-action exists for any of these): upload signed contract, confirm contract, extend contract, lapse contract, payroll/payslip management (creating requests *for* a worker, marking fulfilled).
- Follow the exact established mobile conventions above (no hook unless genuinely needed, no optimistic updates, colocated status colors, Profile-linked stack screen, pure-function test extraction for anything needing native-module-free testing).

**Do not start PR 2's mobile code until PR 1 (backend) is merged to `main`.**

### 2. Password reset (deprioritized behind HR)
- Token generation exists server-side (`backend/src/modules/auth/service.ts`) but the `enqueue()` call to actually email the reset token was never wired — tracked as `SIR-NOTIF-007`/`SIR-AUTH-005` in code comments. Verify these tracking IDs still describe the current state before starting; things may have changed.
- No frontend forgot-password/reset-password page exists either (web or mobile).
- Lower urgency — admin-mediated password resets remain a viable interim path for users who get locked out.
- **Not yet investigated in depth this session** — before implementing, do the same investigate-first pass: read the backend auth module fully, check for any existing partial frontend work, check mobile's login screen for hooks that might already assume a "forgot password" link exists.

### 3. Employment Record verification audit (not a feature — a repo-wide audit)
- User's framing: verify every worker-facing flow now correctly uses the `EmploymentRecord` model (introduced by the Onboarding PR #330's underlying backend work) and that no code still assumes the old marketplace-era model.
- Not started. Do this as a read-only audit (grep + targeted file reads across backend modules that reference worker eligibility/scope), not a coding task, unless it finds something that needs fixing.

### 4. MVP stabilization pass (do this LAST, after 1–3 are done)
- Full worker journey walkthrough (mobile app, start to finish).
- Mobile ↔ web parity audit.
- Loading-state consistency, error-handling consistency, theme consistency, navigation review across all mobile screens.
- API contract verification (spot-check that every mobile `api.*` call still matches its backend route — especially worth doing given the `is_work_permit` bug found in PR #331, which suggests other silent contract mismatches may exist).
- Regression testing.
- The user explicitly expects this phase to surface more real issues than another feature PR would — treat it as seriously as a feature, not a checkbox pass.

---

## Explicitly out of scope for MVP (do not build, do not suggest)

- Chatbot (module doesn't exist, referenced only as a future consumer in consent/employee-management code comments)
- Recruitment / onboarding-orchestration module enhancements (deliberately never scoped — `hr/service.ts` has an explicit comment confirming no onboarding module exists in code, and this was a conscious pivot decision, not an oversight)
- Offline sync for either mobile app
- Advanced analytics
- Enterprise integrations
- New infrastructure work
- Compliance governance report (`IF-COMPLIANCE-GetGovernanceReport`) — explicitly deferred pending an unresolved RBAC decision (`OD-COMPLIANCE-006`, no scope defined for an Admin/DPO caller class)
- Manager Operations Calendar UI as originally conceived — the `/calendar/.../operations` stub is **architecturally dead** (`ADR-051` formally removed it, the underlying reception-data model has no owning module, a "Workforce Planning module" reframing was explicitly considered and rejected). The actual target requirement this was confused with (`REQ-CAL-T01`, manager weekly-plan/placement view) was already substantially delivered by the merged PR #329 (`assignments/calendar-entries`). Do not resurrect the `/operations` stub as a feature target without a new, explicit product decision assigning that data to some module — it's not a mobile-porting-style task.
- Standalone Quality web page — functionality is reachable via the Assignments detail page; not a hard MVP blocker.
- Worker "my stats" mobile view — backend route (`/analytics/my-stats`) exists, no client anywhere calls it, not prioritized.
- Checker-app equivalents of any of the above worker-app features — checker is a distinct actor with its own (already largely complete) app; don't assume feature parity is required.

---

## Boundaries / operating rules for whoever picks this up

- **Never push or open a PR without confirming with the user first.** Every PR in this project so far was preceded by an explicit "push and open PR?" confirmation. This is a standing expectation, not a one-time preference.
- **Never merge your own PR.** The user merges after reviewing.
- **Don't silently fix bugs found outside your current PR's scope.** Two real backend bugs were found during the Documents port (the `is_work_permit` schema bug, the `getDocumentCompleteness` IDOR gap) and correctly left unfixed, just documented in the PR description and in this file. Follow that precedent — flag, don't drift.
- **Don't invent new architectural patterns without evidence there's no existing one to follow.** Every "should I add X" question in this project's history was resolved by grepping the actual codebase for precedent first (shared packages: none exist in this npm-workspaces monorepo, confirmed before deciding not to add one; hooks: only added when a screen's complexity actually justified it, compared directly against `useDocumentUpload.ts`'s complexity each time). Do the same — investigate before assuming a pattern doesn't exist.
- **The 4-gate review process (architecture/dependency/security/consistency subagents in parallel) is not optional for feature PRs.** It has caught a real, non-obvious bug in every single PR so far (URL encoding gaps, response-vs-literal state derivation, IDOR-adjacent findings, label consistency, comment overclaims). Don't skip it because a change "seems small."
- **When investigation surfaces a backend gap mid-feature, stop and produce an evidence package — do not invent an endpoint or silently work around it client-side.** This just happened correctly for HR (this file documents the outcome); the same discipline applies to any future feature.
- **This repo has a `.claude/CLAUDE.md`-defined "AI Engineering Platform Bootloader"** referencing `constitution/`, `workflows/`, `knowledge/`, `governance/` directories at the repo root — **these do not exist** at those paths (only `.claude/constitution/ENGINEERING_CONSTITUTION.md` and `.claude/constitution/REVIEWER_FINDINGS.md` are real). This was confirmed by multiple review subagents independently. Don't waste time trying to locate the bootloader's other referenced files; proceed with direct repository evidence-gathering instead, as every session in this project's history has done.

---

## Quick reference: where things are

| What | Where |
|---|---|
| Backend HR module | `backend/src/modules/hr/{routes,controller,service,types}.ts` |
| Backend Documents module | `backend/src/modules/documents/{routes,controller,service,types,upload-policy,validation}.ts` |
| Backend Consent module | `backend/src/modules/consent/{routes,controller,service,types}.ts` |
| Backend Employee Management module | `backend/src/modules/employee-management/{routes,controller,service,types}.ts` |
| Web HR components | `frontend/components/hr/{ContractCard,PayslipRequestsCard}.tsx`, `frontend/lib/api.ts`'s `hrApi`, `frontend/lib/types.ts:920-990` |
| Web Consent component (reference for mobile port pattern) | `frontend/components/consent/ConsentCard.tsx` |
| Mobile worker-app screens | `mobile/worker-app/src/app/{documents,consent}.tsx` (done), `(app)/profile.tsx` (link mounting point) |
| Mobile worker-app API client | `mobile/worker-app/src/lib/api.ts` (`api.documents`, `api.consent` namespaces already exist — add `api.hr` next) |
| Mobile worker-app types | `mobile/worker-app/src/types/api.ts` |
| Mobile worker-app tests | `mobile/worker-app/src/__tests__/` (flat directory, one file per concern, e.g. `consent-api.test.ts`, `consent-status.test.ts`) |
| Permission tokens / role matrix | `backend/src/config/constants.ts` (search for `ROLE_PERMISSIONS` / the `hr:*` tokens) |

---

## Immediate next action

Do **not** resume mid-investigation. Start fresh at the top of this file's "Worker Mobile HR Self-Service" section: **implement PR 1 (backend `hr:payslip:read-own` capability)** — plan it explicitly (file list, exact route/permission changes, test plan), get it approved, then build it. Only after that PR is merged, start PR 2 (mobile HR screen).
