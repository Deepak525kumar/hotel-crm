# 22 — Zelle: rota and everyday tools (2026-09-15)

**Status:** written 2026-09-15 for the tools built after scenario 21. Executable end to end with
`backend/scripts/chatbot-e2e-conversations.ts`, which drives this file and scenario 21 through the
real app, a real login and consent, the live model, and database read-back. See the run logs under
`runs/` for results.

**Run it:**

```bash
cd backend
aws login                      # the live model needs AWS credentials (Bedrock mantle, eu-central-1)
RESEND_API_KEY= npx tsx scripts/chatbot-e2e-conversations.ts          # all scenarios
ONLY=R1-swap,E4-fix-room RESEND_API_KEY= npx tsx scripts/chatbot-e2e-conversations.ts   # a subset
```

Point `backend/.env`'s `DATABASE_URL` at a throwaway database. Each run seeds its own tagged hotel,
group and people and leaves them for inspection. Every turn is a paid model call (~40 turns).

## Preconditions (seeded by the harness)

- A hotel group with **Premier Inn Essen City Centre Hotel `<tag>`**, and a hotel-scoped manager
  **Maria** who logs in and consents through the real routes.
- ACTIVE workers **Parveen Kumar**, **Anna Braun**, **Tomasz Nowak**; a second manager **Harvir Singh**.
- One COMPLETED shift for Parveen today (for S13). Anna's shift today with two logged rooms, and a
  logged room 214 on Parveen's shift, are seeded mid-run, only after the steps that must see an
  empty log.

## Scenarios

| ID | Who | Type | Expected tool | Pass criteria (data layer) |
|---|---|---|---|---|
| R1-swap | manager | `Parveen can't come on <day>, give her shift to Anna Braun` | `assignments.swap_worker` | After Confirm: Anna `CONFIRMED` that day, Parveen's row `REASSIGNED` |
| R2-plan | manager | `Anna is off sick on <d1>, put Tomasz on <d1> and <d2>` | `calendar.apply_plan` | One confirmation. `CalendarAbsence` for Anna on d1; Tomasz `CONFIRMED` on d1 and d2 |
| E1-withdraw-absence | manager | `Anna is better, she is not off on <d1>` | `calendar.withdraw_worker_absence` | Absence row gone; reply warns a cancelled shift is not restored |
| E2-requests | manager | `I need 2 cleaners on <day> from 07:00 to 15:00` → `which staffing requests are still open` → `cancel the cleaner request for <day>` | `job_requests.create_broadcast` → `job_requests.list_for_my_team` → `job_requests.cancel_request` | List names the cleaner request; the one `JobRequest` ends `CANCELLED` |
| E3-team-rooms | manager | `how many rooms has everyone done today` | `rooms.team_today` | Reply shows "Anna Braun 2" (counted for today only) |
| E4-fix-room | worker | `I logged 214 but it was 241` | `rooms.fix_my_room` | After Confirm: today's log has 241 and no 214 |
| E5-profile | worker | `my new number is 0160 7654321` | `users.update_my_profile` | After Confirm: `User.phone = +491607654321` |
| E6-worker-boundary | worker | `cancel the shift for Anna Braun tomorrow` | none | No confirmation is offered: the tool is not in a worker's manifest |

Also covered by unit tests only, because they are refusals the model rarely produces on demand:
swap with no shift (refused before confirming), a plan naming an unknown person (nothing written),
an inspected room (refused), two requests on one day with no position (refused, listed),
withdrawing a past absence (refused).

## Why these criteria

- **R2 order.** Absences apply before shifts, so a sick day frees the day it covers. The data check
  would fail on the one-active-assignment-per-day rule if the order were reversed.
- **E3 "today only".** Room reads span the target day and the day before (night shifts). A count
  that includes yesterday is the double-count found in `reports.work_summary` on 2026-09-15.
- **E1 warning.** Marking a sick day cancels that day's shift; withdrawing it does not restore it.
  A manager who assumed otherwise would find out the morning nobody came.
- **E6.** The boundary is the manifest itself: a worker's model is never shown manager tools.

## Knowingly untested here

- Regional manager and admin sessions (unscoped hotel resolution) — worth a run with an RM login.
- Mobile History/Share and the web Copy/History UI in a browser (unit-tested only).
- `users.update_my_profile` language change end to end (it changes the language the rest of a run
  is answered in, so it is left out of an automated conversation).
