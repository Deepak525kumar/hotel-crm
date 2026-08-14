# ADR-067: Worker Visibility of the Quality Leaderboard — Own Hotel Group, Non-Contact Fields

- **Status:** Accepted — ratified by the commissioning human on 2026-08-14 ("i authorize amending"),
  in response to an escalation that declined to edit the `ADR-030` §3 capability matrix without an
  authorizing record. Authored by the Lead Architect from that ratification instruction.
- **Date:** 2026-08-14
- **Scope:** `ADR-030` §3 capability `C-28` ("View quality / leaderboard", token `quality:read`),
  WORKER column only. Resolves the quality-leaderboard half of `GD-06` (worker analytics access),
  which `ADR-030` §10 recorded rather than resolved.
- **Supersedes:** none. **Amends:** `ADR-030` §3, row `C-28`, WORKER cell only —
  `✗ (GD-06)` → `✓ᶜ (ADR-067)`.
- **Change class:** Product decision with an authorization effect — a role gains a permission
  token, so it is a Decision Record per Constitution §6/§7 rather than an implementation choice.

---

## 1. Context

The worker mobile app ships a Leaderboard screen (`worker-app/src/app/ratings.tsx`). It called
`GET /analytics/leaderboard`, which is gated `requireRole(['admin','manager','regional_manager'])`.
Every worker received `403 Insufficient permissions`, confirmed against a running stack. The screen
has therefore never functioned for its only audience.

Two routes could serve it, and the distinction is the whole decision:

- `GET /analytics/leaderboard` accepts `hotel_id` / `hotel_group_id` as **parameters** and applies
  **no actor scoping**. Admitting WORKER here would hand every worker the platform-wide board.
- `GET /quality/leaderboard` resolves scope from the **actor**, and already carries the
  2026-08-08 IDOR fix that confined managers to their own group after the bare route was found
  returning everything.

`C-28`'s WORKER denial cites `GD-06`. `ADR-030` §10 lists `GD-06` among the items "recorded rather
than resolved, being genuinely outside this record's scope". So the cell is not a considered denial
of worker leaderboard access — it is an open question that defaulted to deny, which is the correct
default for an unresolved authorization question.

## 2. Decision

A WORKER may view the quality leaderboard **for their own hotel group only**, and sees
**non-contact fields only**.

1. `C-28`'s WORKER cell becomes `✓ᶜ` — allowed within the actor's scope, the same qualifier
   MANAGER, REGIONAL_MANAGER and CHECKER already carry on this row. WORKER gains `quality:read`.
2. Scope is the worker's own `EmploymentRecord.hotel_group_id`, read **server-side** from the
   authenticated caller. It is never accepted from the client, and `hotel_id` /
   `hotel_group_id` request parameters do not widen it.
3. An account that is not `ACTIVE`, or holds no group, sees an **empty** board — not an
   unscoped one. Absence of scope must never degrade to absence of filtering.
4. Peer rows expose identifying and work-related fields: name, primary hotel name, average
   score, total ratings, assignment counts, completion and on-time rates, worker-declared
   absences. **`email` is withheld** from WORKER and CHECKER callers. It is a manager-facing
   contact field, and a leaderboard is not a reason to distribute every colleague's address
   across a hotel group. MANAGER, REGIONAL_MANAGER and ADMIN responses are unchanged.

`primary_hotel` is read for its **name only**. `EmploymentRecord.primary_hotel_id` is documented
as display-only and must never drive an eligibility decision (`schema.prisma`); this decision does
not change that.

## 3. What this does NOT decide

- **`C-31` (View analytics, `analytics:read`) is untouched** and its WORKER cell remains
  `✗ (GD-06)`. `GD-06`'s analytics half stays open. This record resolves only the
  leaderboard half, and deliberately does not grant WORKER `analytics:read`.
- **`C-27` (Submit quality rating / verification, `quality:write`) is untouched.** A worker
  reads the leaderboard; they do not rate anyone. `quality:read` and `quality:write` gate
  different routes.
- CHECKER already held `✓ᶜ` on `C-28` and is unchanged by the matrix edit. The field-level
  withholding in Decision 4 does apply to CHECKER, as a peer viewer rather than a supervisor.

## 4. Consequences

**Accepted.** Workers in a group can see each other's average score, shift counts and base hotel.
This is deliberate: the commissioning human's instruction was "they should be able to see other
workers from their own hotel group", and a leaderboard is by construction a comparison between
colleagues. The mitigation is the boundary, not the blur — the group is the unit of comparison,
contact details are withheld, and nothing crosses a group edge.

**Guarded.** `quality:read` gates exactly two routes, both leaderboard reads. It confers no write
capability, and the scope narrowing in Decision 2 sits at a different seam
(`getLeaderboard`'s `where` construction) from the token check, so the two are independently
tested — `capability-policy.test.ts` for the token, the scope suites for the narrowing.

**Residual risk.** A worker who changes hotel group sees the new group's board and loses the old
one, following their employment record with no additional history exposure. Rows are limited to
`EmploymentRecord.status = ACTIVE`, so departed colleagues drop off.

## 5. Implementation

- `config/constants.ts` — `WORKER` gains `quality:read`.
- `modules/quality/service.ts` — `getLeaderboard()` gains a worker/checker scope branch reading
  the caller's employment record; peer responses have `email` stripped; `primary_hotel { id, name }`
  is included for display.
- `modules/quality/controller.ts` — threads `userId` into the actor passed to `getLeaderboard()`.
- `worker-app` — `ratings.tsx` calls `/quality/leaderboard`; `LeaderboardEntry` re-typed to the
  `WorkerOverallRating` shape (the analytics DTO it previously declared was never reachable).
- `__tests__/support/capability-matrix.ts` — `C-28` outcome `o(A, A, A, A, D)` → `o(A, A, A, A, A)`,
  citing this record, per that file's requirement that a diff cite the authorizing ADR.

## 6. Alternatives rejected

- **Admit WORKER to `/analytics/leaderboard`.** Rejected: that route applies no actor scoping, so
  this would have granted every worker the platform-wide leaderboard — reintroducing precisely the
  defect the 2026-08-08 IDOR fix closed for managers.
- **Replace the screen with the worker's own ratings** (`/analytics/my-stats`, already permitted).
  Rejected by the commissioning human in favour of peer visibility, though it remains the
  zero-authorization-change fallback if this decision is ever revisited.
- **Edit the capability matrix without a record.** Rejected on principle. That file is the
  independent half of the capability assertion and exists because `SIR-AUTH-021` and
  `SIR-ANLY-015` passed every other suite and were caught only by human review.
