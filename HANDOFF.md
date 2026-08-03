# Hotel CRM — MVP Handoff

Last updated: 2026-08-04
Current status: **MVP Feature Complete** (Stabilization Phase)

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

### PR #333 — Worker Mobile HR Self-Service (Backend)
- Added `hr:payslip:read-own` permission token to allow workers to list their own payslip requests via `GET /hr/payroll`.
- Implemented IDOR guard (`actor.role === 'worker' && actor.userId !== worker_id`) in `hrService.listPayroll`.
- Full tests written and 4-gate review passed.

### PR #334 — Worker Mobile HR Self-Service (Mobile)
- Added `hr.tsx` stack screen to `worker-app`, reached via Profile.
- Reads `Contract` (read-only) and allows users to request a new payslip and view past payslip requests.
- Mirrors the backend `api.hr` layer in mobile.

### PR #335 — Password Reset
- Implemented backend token generation and outbox enqueueing inside a `prisma.$transaction`.
- Built web `/forgot-password` and `/reset-password` UI.
- Mobile delegates password reset to web via `expo-web-browser`.

---

## What's left for MVP (Stabilization)

### 1. Employment Record verification audit (not a feature — a repo-wide audit)
- User's framing: verify every worker-facing flow now correctly uses the `EmploymentRecord` model (introduced by the Onboarding PR #330's underlying backend work) and that no code still assumes the old marketplace-era model.
- Not started. Do this as a read-only audit (grep + targeted file reads across backend modules that reference worker eligibility/scope), not a coding task, unless it finds something that needs fixing.

### 2. MVP stabilization pass
- Full worker journey walkthrough (mobile app, start to finish).
- Mobile ↔ web parity audit (Completed: Parity achieved, ExportMyData intentionally omitted from Mobile).
- Loading-state consistency, error-handling consistency, theme consistency, navigation review across all mobile screens.
- API contract verification.
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

The MVP feature phase is formally complete! Proceed to execute the **MVP stabilization pass** (API contract verification, finding UI inconsistencies, and the Employment Record verification audit) and fix the found issues.
