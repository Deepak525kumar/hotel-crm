# 21 — Zelle: the field-report conversations (2026-09-15)

**Status:** written 2026-09-15 from conversations the owner had with Zelle in real use, every
one of which failed. Tool-level behaviour is verified against a real PostgreSQL database
(run log `runs/2026-09-15-zelle-field-conversations.md`). **The live-model routing half is NOT yet
verified** — see "Could not test" in that run log. Re-run this whole file against a live model before
calling it passed.

**Why this file exists.** Each row below is a sentence a hotel manager actually typed, in the
spelling they typed it. They are deliberately not cleaned up: "blibe", "didi", "manger" and
"previews weeks" are the input, and a suite that tests tidied English tests a different product.

## Preconditions

- Scenario 00 done. `FEATURE_CHATBOT=true`, `CHATBOT_PROVIDER=mantle` (or `bedrock`) with working
  AWS credentials, `CHATBOT_TRANSCRIPT_KEY` set (History depends on stored transcripts).
- One hotel group containing **Premier Inn Essen City Centre Hotel**.
- A hotel-scoped **manager** at that hotel (the account you chat as).
- Workers with ACTIVE employment in the group: **Parveen Kumar** (worker).
- A second **manager** in the same group: **Harvir Singh**.
- `CHATBOT_USER_DAILY_TOKEN_CAP` at its default (1,000,000) or unset on the host. If the host
  `.env` still pins `250000`, S11–S13 will reproduce the original failure — that is a
  configuration fact, not a code defect (see run log).

For every write: **read the row back.** A "Scheduled"/"Cancelled"/"Recorded" reply is not evidence.

## The scenarios

| ID | Type exactly | Expected tool / surface | Pass criteria (reply AND data) |
|---|---|---|---|
| S01 | `Make day task rooms today we have 90 rooms to clean add that work list and 10 blibe` | `calendar.set_day_summary` | Reply states 90 rooms, 10 stay-over for today at the hotel. `DailyShiftSummary` row for (hotel, today) has `total_rooms=90`, `stay_over_rooms=10`; other counts unchanged if the row existed. |
| S02 | `I want make id more next employe` → `yes create id` | `users.new_account_link` | Reply explains a profile photo is required and carries a link rendered as **"Open the filled-in New user form"**. No `User` row is created by the chat. Never "contact your HR department". |
| S03 | `make me that chat copy` | Copy button (web) / Share (apps) | Reply points at Copy. Pressing Copy puts `You: … / Zelle: …` on the clipboard. |
| S04 | New user form: Mukesh kumar, phone `016090744182`, Worker, Premier Inn, Cleaner, photo | `POST /users` | 201. `User.phone = +4916090744182`. If anything is invalid, the form names the FIELD (not "Request body validation failed"). |
| S05 | `Put several workers on the schedule … Harvir Singh … 2026-09-15/16/17` | `assignments.place_many` | **No confirmation is shown.** One sentence: "Harvir Singh is a manager, not a worker or checker …". No `WorkerAssignment` rows created. |
| S06 | `manger not worker` | none (or same refusal) | No write. Does not claim a tool is missing; the rule is that managers are not scheduled on the cleaning calendar (owner decision 2026-09-15). |
| S07 | `cancel shift for parveen kumar 16 September` (with a live shift that day) | `assignments.cancel_shift` | Confirmation names Parveen Kumar and 2026-09-16. After Confirm: `WorkerAssignment.status = CANCELLED`, `cancelled_at` set. With NO shift that day: refusal **before** any confirmation. |
| S08 | `I want previous chats` | `chatbot.recent_conversations` + History | Reply lists recent conversations with their first message and points at History. History opens and a past conversation reads back with no Confirm buttons. |
| S09 | `give me record data previews weeks how much work we did` → `07.09.2026 data` | `reports.work_summary` | 07.09.2026 is read as **2026-09-07** (day first). Reply gives shifts, people, hours, rooms for the TEAM — not the manager's own rooms. A true zero says "no shifts on the calendar, nobody clocked in, and no rooms logged". |
| S10 | `make me plans. for parveen 17 18 19 September` | `calendar.check_availability` | Availability for 2026-09-17..19. |
| S11 | `ok make` | `assignments.place_many` (confirm) | Confirmation lists Parveen Kumar × 17, 18, 19. After Confirm: three `WorkerAssignment` + `CalendarEntry` rows. **Never** "You have asked me as much as I can answer today" at this point. |
| S12 | `add that another dates also` | clarifying question | Asks which dates. No write. No budget refusal. |
| S13 | `parveen didi today 10 rooms` | `rooms.record_worker_count` | If Parveen logged rooms on today's shift: reply states how many she logged and writes NOTHING (no `RoomsCompletedEntry`). If she logged none and the shift is COMPLETED: after Confirm, `RoomsCompletedEntry.rooms_completed = 10`. If still in progress with none logged: refusal saying so, no write. |

## Why each pass criterion is shaped the way it is

- **S05/S07 "no confirmation shown".** The original defect was a confirmation for a call that
  could not run: the manager pressed Confirm, saw "✓ Confirmed", and was then told nothing was
  scheduled. `reference-precheck.ts` now resolves names nested in `placements[]`, and tools with a
  `precheck` (cancel, rooms) prove their target exists before a confirmation is issued.
- **S09 "not the manager's own rooms".** `reports.query_team`'s `rooms` dataset reads
  `listMyRooms` — the caller's own log — so it is always empty for a manager. That is the most likely
  source of the original "the count is 0".
- **S13 "writes nothing when rooms are logged".** Analytics sums manager counts AND logged rooms,
  so a count over a logged shift doubles the reported work.
- **S11–S13 budget.** Measured 2026-09-15: ~12,700 prompt tokens per model step for a manager
  (37 tool schemas), 2–3 steps per turn, against a 250,000 daily cap — about seven messages a day.

## Follow-on tools (same day)

| Type exactly | Expected tool | Pass criteria |
|---|---|---|
| `Parveen can't come Thursday, give it to Anna` | `assignments.swap_worker` | Confirmation names both people; old assignment `REASSIGNED`, new `CONFIRMED` linked by `previous_assignment_id` |
| `Anna is off sick Monday, put Tomasz on Monday and Tuesday` | `calendar.apply_plan` | One confirmation listing both; Anna's Monday shift `CANCELLED`, absence row written, Tomasz 2 shifts. Any unknown name → nothing written |
| `Parveen's phone died, she started at 07:00 today` | `attendance.correct_times` | Check-in on today's attendance row is 07:00 Berlin; reason stored in notes |

## Knowingly untested here

- Live-model routing of every phrase above (needs AWS credentials; run
  `backend/scripts/chatbot-routing-check.ts` with these phrases added).
- The hand-edited production `.env` value of `CHATBOT_USER_DAILY_TOKEN_CAP` / `CHATBOT_CONVERSATION_TOKEN_CAP`.
- The mobile History/Share UI on a physical device (store logic is unit-tested).

## History

| Date | Finding | Fixed in |
|---|---|---|
| 2026-09-15 | Nested `placements[].worker_name` skipped by the confirmation precheck → "✓ Confirmed" then "Nothing was scheduled" ×3 | `reference-precheck.ts` |
| 2026-09-15 | A manager named in a schedule reported as "not on your team" | `worker-reference.ts` NOT_STAFFABLE |
| 2026-09-15 | No cancel tool; incomplete write args answered "did not catch that" | `assignments.cancel_shift`, `renderIncompleteRequest` |
| 2026-09-15 | German national phone format refused, form showed no field | `lib/phone.ts`, `users/new/page.tsx` |
| 2026-09-15 | Daily cap ~7 manager messages; day boundary in UTC | `env.ts` 1M cap, `startOfBerlinDay` |
| 2026-09-15 | "Previous chats"/"copy" refused — no surface existed | History routes + tool, Copy/Share |
| 2026-09-15 | Work summary double-counted rooms across consecutive days (16 for 8) | `work-summary.tools.ts` counts by room day |
| 2026-09-15 | Day summary flagged "90 rooms, 10 stay-over" as a discrepancy | `shift-summary.tools.ts` `mismatchNote` |
