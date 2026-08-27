# Inspection & Rework Flow — Implementation Plan (ADR-072)

Ordered plan for the checker-initiated inspection flow decided in
[`ADR-072`](../14-governance/architecture-decisions/ADR-072-inspection-flow-and-rework-confirmation.md).
Each PR is independently reviewable and leaves the system working. Do not collapse them: PR 1
changes a shipped state machine, and the client PRs depend on its shape.

## What already exists — do not rebuild it

`ADR-069` shipped most of the loop. Verified against the worktree on 2026-08-26:

| Capability | Where | State |
|---|---|---|
| Rework as a linked assignment, excluded from ratio denominators and day-exclusivity | `schema.prisma:1032` | Built |
| Checker assigns rework to the same worker, with notes | `quality/service.ts:364` | Built |
| Inbox row + push on assign (`REWORK_REQUIRED`), double-assign guarded by compare-and-swap | `quality/service.ts:418` | Built |
| Worker uploads mandatory photos, marks done; photos appended so the checker sees before/after | `quality/service.ts:445` | Built |
| Checker notified on completion (`REWORK_COMPLETED`) | `quality/service.ts:497` | Built |
| 20-minute escalation, idempotent via `rework_escalated_at` | `quality/rework-escalation-job.ts` | Built |
| Checklist, 0–100 score, per-criterion scores, photos with rating | `quality/inspection-checklist.ts`, `types.ts` | Built |
| Worker's rework screen: "rework done" + photos only, no check-in/out | `worker-app/src/app/rework/[id].tsx` | Built |
| Worker may read the checker's photos for their own work (authorization) | `quality/service.ts:892` | Built — no client surface |

## PR 1 — Backend: confirmation state, auto-close, attendance exclusion

The only PR that touches the database. Everything else depends on it.

1. **Schema**: add the awaiting-confirmation state and a confirmation timestamp to
   `QualityVerification`, plus the idempotence marker the auto-close job needs. `rework_completed_at`
   keeps its meaning (the worker finished); closure is a new, later fact. Migration must not
   retroactively reopen reworks already `COMPLETED` (ADR-072 §3).
2. **`completeRework`**: stop setting the rework assignment to `COMPLETED`. Move it to awaiting
   review and notify the checker as it does today.
3. **New**: checker confirmation endpoint — closes the rework assignment. Same authorization surface
   as `assignRework` (rework is an outcome of the inspection, not a separate capability), plus the
   compare-and-swap pattern both existing rework mutations use.
4. **New**: auto-close job for unconfirmed reworks (ADR-072 §2.3). Model it on
   `ReworkEscalationJob` — marker column written in the same transaction as the state change and
   part of the query predicate, or it will re-fire every tick. The delay is **one hour**
   (ADR-072 §4.1) — a named constant, with the reasoning at the definition.
5. **Escalation recipients** (ADR-072 §2.2): confirm the escalation targets
   `verification.verified_by_id` — the checker who actually inspected — and the worker's manager.
   Extend the notification payload so a client can route to the evidence: verification id, worker,
   hotel, and the originating assignment.
6. **Attendance exclusion** (ADR-072 §2.4): `rework_of_assignment_id IS NULL` in the attendance
   module — both where attendance rows are created and where queues are listed. This predicate now
   exists in three places; add a named helper if a fourth appears.
7. **Worker picker endpoint** (ADR-072 §2.5): workers with an assignment dated today across the
   checker's scope. Check whether `listAssignments` already serves this before adding a route.

**Tests:** the worker's upload does not close the assignment; confirmation does; auto-close fires
once and only once; a rework assignment produces no attendance row and appears in no attendance
queue; escalation reaches the inspecting checker rather than any checker at the hotel.

## PR 2 — Checker app: start inspection, picker, approve/rework, review tab

Depends on PR 1's endpoints.

- Start-inspection entry replacing the attendance queue as the primary action
  (`(app)/index.tsx` today lists unverified attendance).
- Worker picker: today's shifts across scope, no check-in filter (ADR-072 §2.5).
- Photos → checklist → score, then two explicit outcomes: approve, or rework with notes.
- Review tab listing reworks in flight and their state, so confirmation does not depend on the
  checker still holding the push notification (ADR-072 §2.3).
- The escalation notification must open to the evidence, not just display text (§2.2).

## PR 3 — Worker app: 15-minute rework urgency, and seeing the checker's evidence

- Show the 15-minute countdown (§2.1). The 20-minute escalation is server-side and unchanged — do
  not reimplement the deadline client-side.
- A screen for the checker's photos on the worker's own work — **all inspections, not only rework**
  (§2.6). The API already permits it; this is purely the missing surface.

## PR 4 — Web: manager visibility

- Rework state and evidence on the manager surfaces, so an escalation the manager receives is
  actionable from the web rather than only from a phone.

## Settled since this plan was written

`ADR-072` §4 now decides all three: auto-close at one hour (§4.1); send-back creates a second rework
assignment rather than reopening the first (§4.2); rework carries no payroll or time-tracking
treatment (§4.3).

One consequence is worth repeating where an implementer will hit it: `rework_completed_at` means
*the current cycle is complete*, not *rework is finished*. Closure is `rework_confirmed_at` alone.
