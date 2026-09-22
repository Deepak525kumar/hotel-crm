# ADR-075: One role-gated manager app, on a shared mobile package

## Status

`PROPOSED` — **awaiting human ratification.** Date: 2026-09-22.

The three decisions below were taken by the project owner on 2026-09-22 in the
session that authored `docs/implementation/MANAGER_APP_PLAN.md`, and the first
three PRs were built against them (PR #690). This record exists so that
authority is written down rather than living only in a conversation; flipping
it to `ACCEPTED` is reserved human authority (Constitution §12/§20) and is not
something the implementing session may do for itself.

Supersedes: none. Amends: nothing. Depends on `ADR-030` (capability model) and
its owed RULE A / RULE B amendments (see §Context).

## Context and Evidence

`frontend/` is the only surface for `manager`, `regional_manager` and `admin`
(`frontend/CLAUDE.md`: "workers and checkers use the Expo apps"). A hotel
manager at a front desk, or a regional manager moving between properties,
needs a laptop-shaped screen to approve an application, verify attendance, or
move tomorrow's rota. Housekeepers and checkers have native apps; the people
who supervise them do not.

Two facts constrain any answer:

1. **`REGIONAL_MANAGER` is `MANAGER` plus exactly one token.**
   `ROLE_PERMISSIONS.REGIONAL_MANAGER` is literally
   `[...MANAGER_PERMISSIONS, 'org_chart:read']`
   (`backend/src/config/constants.ts`). They differ otherwise only in scope
   breadth — `{type:'hotel'}` vs `{type:'hotel_group'}` (`ADR-030` D-5/D-7).
2. **`ADR-030` §3 is not wholly current.** RULE A / RULE B, ratified by the
   owner 2026-08-12 and implemented in `backend/src/lib/role-hierarchy.ts`,
   contradict the matrix in both directions; the ADR amendments remain owed
   (`docs/10-testing/e2e/REMAINING_WORK.md`, first two open items). Any app
   built from the matrix alone would ship the wrong gates.

## Decision

**D-1 — One role-gated app, not two or three.** `mobile/manager-app` serves
`manager`, `regional_manager` and `admin`; screens gate on role **and resolved
scope**. Rejected: a separate admin app (triples hand-maintained duplication
that already hurts), and manager-only-now (admin bolted on later is the more
expensive order).

**D-2 — A shared package, for the new app only.** `mobile/shared` is created
and `manager-app` built on it; `worker-app` and `checker-app` stay on their
copies. Accepted cost: three sources of truth during the transition, tracked
by `mobile/shared/MIGRATION.md` and `SIR-GLOB-028`. Rejected: migrating two
production apps as a prerequisite for starting a third.

**D-3 — Parity with what each role is already authorized to do.** No new
capability, no widening. `ADR-030`'s matrix is the scope boundary; master data
ships gated to `admin`.

**D-4 — Client gates mirror the route, never this document.** Every gate is
test-pinned against the real `ROLE_PERMISSIONS` and `role-hierarchy.ts`
(`mobile/manager-app/src/__tests__/capability-map.test.ts`). A client gate is a
convenience over server-scoped data and never the only gate.

**D-5 — `PushApp` gains `MANAGER`.** A third APNs topic, not a reused one: a
manager device answering another app's topic gets `DeviceTokenNotForTopic` on
every send, the asymmetric outage `PushApp` was introduced to prevent.

**D-6 — The calendar is designed, not ported.** The web's reschedule is
HTML5 drag-and-drop, which does not fire on touch at all, and `EditEntryModal`
omits a date field because "move is what drag/drop already covers"
(`frontend/app/(protected)/calendar/page.tsx`). Moving a placement is
therefore *currently unreachable on mobile*. The app uses an agenda-first view
with an explicit Move action; long-press-drag is out of scope (unreliable
inside a scroll view, and this is a destructive write to a real rota).

**D-7 — `h1`/`h2` are added to the type scale, and nothing existing changes.**
`title` stays 48pt. Changing it would restyle two production apps to suit a
third.

## Consequences

- The manager app is additive: no web or backend behaviour changes except D-5's
  enum and its migration.
- Every future manager-facing web change acquires a mobile counterpart, so
  `REMAINING_WORK.md`'s standing "update all the ui changes in mobile too" can
  no longer be answered "not applicable, mobile has no such screen" for
  manager surfaces.
- Locale catalogues become a four-way lockstep (frontend, worker, checker,
  shared). A key added to one package fails CI in packages the branch never
  opened.
- D-2's duplication is a standing cost until the shipped apps migrate.

## Compliance and Validation

`capability-map.test.ts` (role list and RM parity against the real matrix),
`role-admission.test.ts`, `scope.test.ts` (an RM and an admin both have a null
`scope_hotel_id` and must not resolve alike), `analytics-contract.test.ts`
(response shapes pinned against the backend's own declarations),
`locales.test.ts` (four-way catalogue parity), `dev-server-port.test.ts`.

E2E scenarios 23–35 are specified in `MANAGER_APP_PLAN.md` §8.3 and land with
the screens they describe.

## Synchronization Plan

- `SIR-CRM-020`, `SIR-GLOB-028`, `SIR-ANLY-016` recorded in
  `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` at this pass.
- `ADR-030`'s RULE A / RULE B amendments remain owed and are **not** discharged
  here; this record depends on them.
- No `MODULE_SPEC.md` is frozen by this work, so G2 does not apply.
