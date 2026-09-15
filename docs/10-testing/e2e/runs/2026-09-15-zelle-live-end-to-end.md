# E2E Run — 2026-09-15 — Zelle, live end to end (scenarios 21 and 22)

- **Commit under test:** branch `fix/zelle-field-conversations` (PR #682), uncommitted fixes at run time
- **Environment:** local dev. The real app (`createApp()`) listened on a local port, backed by
  PostgreSQL 16 in Docker. Model: Bedrock mantle `qwen.qwen3-235b-a22b-2507` in `eu-central-1`,
  with live AWS credentials.
- **Executed by:** Claude Code (agent), on the owner's instruction to test everything built, end to end.
- **Harness:** `backend/scripts/chatbot-e2e-conversations.ts` (committed; paid; not in CI)
- **Method:**
  - Real `POST /auth/login` and the real daily consent gate.
  - Chat turns over HTTP, choosing from the live permission-filtered manifest.
  - Confirmations answered by sending `confirm_token` back.
  - Every write read back from the database.
  - Only people, hotels and one finished shift were seeded.
  - The absence, staffing requests and placements were created through their real tools.

## Results

Four runs. The final run passed **19/19**:

| Scenario | Result | Evidence |
|---|---|---|
| S01 day summary ("90 rooms … 10 blibe") | PASS | `DailyShiftSummary` 90 / 10 |
| S02 "make id" → "create id for Mukesh kumar" | PASS | First turn names the missing first name. Second returns the form link. 0 users created |
| S03 "make me that chat copy" | PASS | Points at the Copy button |
| S05 schedule Harvir Singh | PASS | No confirmation; "Harvir Singh is a manager…"; 0 rows |
| S06 "manger not worker" | PASS | No confirmation. No write, and **no claim of one** |
| S07 cancel Parveen | PASS | Placed through chat, then `cancel_shift` proposed and confirmed; row `CANCELLED` |
| S08 "I want previous chats" | PASS | Points at History; `GET /chatbot/conversations` returned 2 |
| S09 "record data previews weeks" → "07.09.2026 data" | PASS | Two-week default range, then 2026-09-07 read day-first |
| S10–S11 plans → "ok make" | PASS | `place_many` confirmed; 3 `CONFIRMED` rows |
| S12 "add that another dates also" | PASS | Clarifying question; no write; no budget refusal |
| S13 "parveen didi today 10 rooms" | PASS | `RoomsCompletedEntry` 10 |
| R1 swap | PASS | Anna `CONFIRMED`, Parveen `REASSIGNED` |
| R2 plan | PASS | One confirmation: absence written, Tomasz 2 shifts |
| E1 withdraw absence | PASS | Absence 1 → 0 |
| E2 staffing requests | PASS | Create → list → cancel. The one request ends `CANCELLED` |
| E3 team rooms today | PASS | "Anna Braun 2" |
| E4 worker fixes a room | PASS | Log 214 → 241 |
| E5 worker's own phone | PASS | Stored as `+49160…` in E.164 |
| E6 worker asks to cancel a colleague's shift | PASS | No confirmation offered |

## New defects found (all fixed in this pass, with regression tests)

1. **A missing argument was answered "You do not have access to that."**
   - Run 2, S02: the model called `users.new_account_link` without a name.
   - The L2 path rendered `INVALID_ARGS` as an access denial.
   - Fix: it now names what is still needed (`orchestrator.ts`).
2. **The model reworded results people must read exactly.**
   - Run 2, S02 and S09: the account reply lost its form **link** and claimed the account "has been started".
   - The work summary's counts and dates came back in the model's own words.
   - Fix: reads marked `finalAnswer`, and every unconfirmed write, now answer with their own summary.
3. **The model claimed a change nothing made.**
   - Run 3, S06: "Harvir Singh has been placed on the schedule…" with 0 rows written.
   - Fix: a deterministic guard on the prose path. No write can run there, so a first-person or
     "has been put on the schedule" claim is replaced with "I have not changed anything…".
   - The guard does not fire when the previous turn really completed an action (`templates.ts`).
4. **"You want to new account link".** The "still need" sentence was ungrammatical for tools without
   a phrase. Read tools now have phrases, and unmapped tools get a neutral sentence.

## Harness defects found (fixed in the harness)

1. **Hoisted imports.** ES-module imports ran before `loadEnv()`, so run 1 never started. Fix: app
   modules are now imported dynamically.
2. **Rate limit.** Run 2 hit the chatbot's own 20-turns-a-minute limiter (429) on three scenarios.
   Fix: the harness waits out 429s.
3. **A false pass.** E1 in run 2 "passed" with nothing to withdraw, because R2 had been rate-limited.
   Fix: it now asserts the absence exists first.
4. **Scored a false claim as a pass.** S06 checked only the database, so run 3 passed a false claim.
   Fix: it now also fails on a claimed write.
5. **Reused data.** Run 3's E5 reused a phone number from run 2, and the unique constraint refused it
   (the product was correct). Fix: the number is now unique per run.

## Routing (the same model, `chatbot-routing-check.ts`)

- **Before the prompt change:** 93/98, with the full tool descriptions duplicated in the prompt.
- **After:** 99/100, with tool names only in the prompt. The only miss was "record data previews
  weeks"; `reports.work_summary` has defaulted to the last two weeks since.
- **One interrupted re-run** hit a network outage at 17:45–17:47: "fetch failed" on every call while
  the AWS session was valid. Not counted.
- **Final re-run:** see the addendum below.

## Production check

EC2 `i-00a27148d4660cb45`, read only, via SSM:
- The API runs `7fe3e400`, with `FEATURE_CHATBOT=true` and `CHATBOT_PROVIDER=mantle`.
- The transcript key is set.
- **No `CHATBOT_*_CAP` is pinned**, so the new 1M/day default takes effect on deploy with no host edit.

## Could not test

- Regional-manager and admin chat sessions. Unscoped hotel resolution needs its own run.
- Web Copy/History and mobile History/Share in a real browser or on a device (unit-tested).
- Changing the app language through chat end to end. It changes the language every later reply is
  in, so it is kept out of the automated run.

## Scenario files updated this run

- `scenarios/22-zelle-rota-and-everyday-tools.md`: created.
- `scenarios/21-zelle-field-conversations.md`: linked to the executable harness.
- `README.md`: index row 22, and harness instructions.

## Addendum — final routing re-check

After every fix in this log, `chatbot-routing-check.ts` scored **99/100** with 0 failed model calls.

- **The one miss** is still the owner's verbatim "give me record data previews weeks how much work we did".
  - In the single-shot routing check, the model answers in prose.
  - In both full end-to-end runs after the two-week default, the same sentence called
    `reports.work_summary` and passed.
  - This is recorded as inconsistent live-model behaviour, not as a pass.
- **If it matters in production:** the next lever is an L0 phrase for "how much work" questions,
  which costs no tokens. A prompt rule is not the lever, because prompt rules have measurably cost
  routing accuracy.
