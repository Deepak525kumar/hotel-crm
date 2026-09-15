# E2E Run — 2026-09-15 — Zelle field-report conversations (scenario 21)

- **Commit under test:** branch `fix/zelle-field-conversations` (off `main` at `7fe3e400`), uncommitted at run time
- **Environment:** local dev — PostgreSQL 16 in Docker, all migrations applied; no LLM provider (AWS session expired)
- **Executed by:** Claude Code (agent), on the owner's field report
- **Method:** prerequisites (hotel group, hotel, manager, Parveen Kumar, Harvir Singh, two finished shifts, eight room logs, one conversation) seeded with Prisma; every scenario then driven through the REAL registry, executor gate and owning services, and every write **read back from the database**. No direct DB write stands in for a path under test.

## Results

| Scenario | Result | Evidence (reply → database) |
|---|---|---|
| S01 day summary (90 rooms, 10 "blibe") | PASS | `DailyShiftSummary` total 90, stay-over 10. First run exposed a false "worth a check" note — fixed, re-run clean |
| S02 create ID → form link | PASS | Reply carries `/users/new#…` with name, email, `+4916090744182`, role, hotel, skills; **0** `User` rows created |
| S03 copy chat | PASS (unit) | Web Copy writes "You: … / Zelle: …" to the clipboard; apps use the share sheet. No backend path |
| S04 German phone | PASS (schema) | `CreateUserSchema` stores `016090744182` as `+4916090744182`. Full `POST /users` with photo NOT run (see below) |
| S05 schedule Harvir Singh | PASS | Precheck REFUSED before confirmation, one sentence: "Harvir Singh is a manager, not a worker or checker…"; **0** assignments for Harvir |
| S06 "manger not worker" | PASS (by S05) | The refusal now gives the true reason; no write path exists to test |
| S07 cancel Parveen | PASS | `WorkerAssignment.status` CANCELLED, `cancelled_at` set. Precheck for a day with no shift refused with "has no shift at … on 2026-09-20" |
| S08 previous chats | PASS | Tool lists the opening message; own transcript returns 2 rows (USER first); **another user reading the same id gets null** |
| S09 work summary | PASS | "2 shifts (2 finished) worked by 1 person, 0 hours clocked, 8 rooms logged". First run said **16** rooms — defect found and fixed, re-run 8 |
| S10 availability | NOT RUN | Existing tool, unchanged; needs a live model to route |
| S11 "ok make" | PASS | Nested names resolved to "Parveen Kumar" ×3; 3 `WorkerAssignment` CONFIRMED + 3 `CalendarEntry` |
| S12 "add that another dates also" | NOT RUN | Model behaviour only; budget cause removed (cap 1M, Berlin day) |
| S13 "parveen didi today 10 rooms" | PASS | Unlogged finished shift → `RoomsCompletedEntry.rooms_completed` 10. Shift with 8 logged rooms → refused, **no** entry written |
| AUTHZ worker cannot cancel | PASS | Executor DENIED (`MISSING_PERMISSION`); assignment still CONFIRMED |

Final data-layer run: **10/10 checks passed.** Automated gates: backend tsc clean, lint 0 errors, chatbot + phone suites 1,085/1,085; frontend lint 0 errors, tests pass, `next build` succeeds; worker app 406+ and checker app 377+ tests pass, lint 0 errors.

## New defects found

1. **Work summary double-counted rooms across consecutive days** — `work-summary.tools.ts` summed `by_worker` from `listRoomsForHotels`, whose window deliberately includes the previous day (`rooms/service.ts` `dayRangeFrom`, night shifts). Eight rooms reported as sixteen. Fixed in the same pass (count by the room's own `day`) with a regression test.
2. **Daily summary flagged a correct half-entered sentence as a discrepancy** — `shift-summary.tools.ts` `mismatchNote` checked that BOTH parts were zero where its comment said EITHER. "90 rooms … 10 blibe" got "come to 10, not 90 — worth a check". Fixed with a regression test.
3. (Found by reading, confirmed by the S09 first-run shape) **`reports.query_team` dataset `rooms` is the caller's OWN room log** (`listMyRooms`), always empty for a manager — the likeliest source of the original "the count is 0". Not changed (approved tool); `reports.work_summary` now answers the question. Recorded in `CHATBOT_HANDOFF.md` §6a.

## Could not test

1. **Live-model routing of all 13 phrases** — AWS session expired (`aws login` needed). The phrases are now cases in `backend/scripts/chatbot-routing-check.ts`; run it before calling scenario 21 passed.
2. **Full `POST /users` with a real photo** — the local `.env` carries a live `RESEND_API_KEY` and account creation can send a welcome email; not exercised to avoid a real send. Schema-level normalisation verified; needs a run with email disabled.
3. **Production `.env` caps** — `CHATBOT_USER_DAILY_TOKEN_CAP` / `CHATBOT_CONVERSATION_TOKEN_CAP` on the EC2 host are hand-edited and may pin the old values, which would override the new code defaults.
4. **Mobile History/Share on a device** — store logic unit-tested only.

## Scenario files updated this run

- `scenarios/21-zelle-field-conversations.md` — created (13 verbatim conversations, pass criteria, history table).
- `README.md` — index row 21.

## Addendum (same day) — the rota tools, and the gaps closed

Built on the owner's follow-up instruction ("build the tools worth"), and verified the same way:
prerequisites seeded, then the real confirmation path (parse → reference precheck → tool
precheck → executor, confirmed) against PostgreSQL, rows read back. **5/5 passed.**

| Check | Result | Evidence |
|---|---|---|
| `assignments.swap_worker` hands a live shift over | PASS | Confirmation lists both canonical names; old assignment `REASSIGNED`, new one `CONFIRMED` with `previous_assignment_id` pointing at it — one atomic service call |
| swap with no shift that day | PASS | Refused at the tool precheck, before any confirmation |
| `calendar.apply_plan` "Anna sick Monday, Tomasz Monday and Tuesday" | PASS | Anna's existing Monday shift `CANCELLED` by the sick day, `CalendarAbsence` row written, Tomasz has 2 `CONFIRMED` shifts. Confirmation lists entries as lines, not JSON |
| plan with an unknown name in `absences[]` | PASS | Refused at the reference precheck; **nothing** written for the other entries |
| worker calls `apply_plan` | PASS | Executor DENIED |

Also closed from "Could not test" above:

- **S04 full `POST /users` path** — PASS. `CreateUserSchema` then `userService.createUser` with a
  photo (stub storage, `RESEND_API_KEY` blanked; the welcome email only reaches the outbox, which
  nothing drained): `User.phone = +4916090744182`, `profile_photo_key` set, `EmploymentRecord`
  PENDING with skills `[CLEANER]`.

Still open: live-model routing (AWS session expired) and the production `.env` caps.

## Addendum 2 (same day) — the everyday gaps

Chosen by mapping every platform route against the registry and keeping daily tasks with no tool.
Verified the same way (prerequisites seeded; the absence and the staffing requests created through
their real tools; confirmation path → executor; rows read back). **7/7 passed.**

| Check | Result | Evidence |
|---|---|---|
| `rooms.fix_my_room` change + remove (worker) | PASS | Log went 214/215/216 → 215/241 |
| fix a room not in the log | PASS | Refused at precheck, before confirmation |
| `rooms.team_today` (manager) | PASS | Per-worker count for the day only |
| `calendar.withdraw_worker_absence` | PASS | Absence rows 1 → 0; reply says a cancelled shift is not restored |
| `job_requests.list_for_my_team` | PASS | Both open requests listed, no ids |
| `job_requests.cancel_request` | PASS | Two requests on one day and no position → refused at precheck; with position, waiter `CANCELLED`, cleaner still `OPEN` |
| worker calls the management reads | PASS | Both DENIED |

Defect found by this run and fixed: requests on the same day were not ordered by start time.

**Deliberately not built:** a person changing their own phone number or language. `PUT /auth/profile`
enforces no permission token and a write tool must declare one; creating that token is a permission
change reserved for the owner.
