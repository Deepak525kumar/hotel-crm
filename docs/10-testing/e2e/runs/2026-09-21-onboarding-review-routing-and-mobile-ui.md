# E2E Run — 2026-09-21 — onboarding review routing, and four mobile/web UI defects

- **Commit under test:** branch `feat/app-store-distribution-and-onboarding-fixes`, off `main` at `6cba9f90`.
- **Environment:** the project owner's own test environment, exercised by hand through the real
  admin UI and the real apps on a physical iPhone. **Findings were then verified against the
  production database** (`hotel-crm-postgres`, `eu-central-1`) over SSM, read-only.
- **Executed by:** project owner (manual, exploratory), with the agent (Claude Code) diagnosing,
  verifying at the data layer, and fixing.
- **Scope:** building a complete test population — hotel, hotel group, worker, checker, manager,
  regional manager — through the admin account, then onboarding each. NOT a run of the numbered
  scenarios.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–20 | NOT RUN | Out of scope for this pass |
| — (ad-hoc) Manager onboarding → admin review queue | **NOT A DEFECT** | Working as designed; see below |
| — (ad-hoc) Manager opens Review Queue tab | **DEFECT FOUND, FIXED** | Told to retry an unretryable 403 |
| — (ad-hoc) Checker app, Zelle screen | **DEFECT FOUND, FIXED** | Duplicate navigation header |
| — (ad-hoc) Checker app, Leaderboard screen | **DEFECT FOUND, FIXED** | Title under the status bar |
| — (ad-hoc) Zelle earlier-conversations list | **DEFECT FOUND, FIXED** | Chip turns stored no user message |

## NOT A DEFECT — "the manager's request never reached the review queue"

**Reported:** an admin created a Regional Manager and a Manager. The RM's application appeared in
the admin's review queue. The Manager's did not, although the Manager's profile showed the
application submitted with every document uploaded.

**First diagnosis, which was WRONG.** It was read from source as a routing hole: a Manager routes
to the RM of their target group, and `resolveReviewerRecipients` read
`HotelGroup.regional_manager_user_id` without checking that person could act — so a PENDING RM
would absorb the record and `admins()` would never be reached. Plausible, internally consistent,
and untrue of what actually happened. **The production data settles it:**

```
 email                   | from_status | to_status | actor              | created_at
 test_regional@gmail.com | PENDING     | ACTIVE    | admin@hotelcrm.com | 14:02:50.152
 test_manager@gmail.com  | PENDING     | ACTIVE    | admin@hotelcrm.com | 14:07:36.562
```

The Manager submitted at **14:03:48.761** — fifty-eight seconds *after* the RM was approved. The
RM was `ACTIVE`, correctly assigned to "test group", and correctly the reviewer. There was no
window in which an unapproved reviewer held the record.

**What actually happened is the intended design.** Routing is by who the applicant is:

- Regional Manager applicant → **Admin**
- Manager applicant → **the RM of their target group**
- Worker/Checker applicant → the manager of their target hotel, else that group's RM, else Admin

Admin is the reviewer of *last resort*, deliberately — the routing exists to answer the earlier
complaint *"why is admin seeing all the review requests"*. So the RM's application appearing for
admin and the Manager's not appearing is exactly correct. The same explains the checker: it routed
to the hotel's manager.

**The PENDING-reviewer state is also unreachable**, which was missed on the first pass:
`users/service.ts#updateUserRole` already refuses to assign a hotel or group to an account whose
application is not `ACTIVE` (ADR-065 Decision 2), with a comment recording that the hole was
verified reproducible before that guard existed. A speculative `canReview()` gate written against
this non-existent state was **removed from the branch** rather than shipped.

**The real gap is a product question, not a bug:** an admin has no surface showing applications
routed to somebody else. The owner expected the review queue to be that surface. Raising it here
rather than inventing an answer.

## Defect 1 — "Please try again" on a permission state

A newly-created Manager opening the Review Queue tab saw *"Failed to load the review queue. Please
try again."* The backend was right: at 14:03–14:07 that Manager was still `PENDING`, so held no
hotel scope, so `getReviewQueue` refused with an explicit 403 — a refusal added on 2026-09-02
precisely so a Manager is told why their queue is empty instead of getting a silent `200 []`. The
web client discarded that and rendered a retry prompt, asking the person to repeat an action that
can never succeed. `ReviewQueueTable.tsx` now distinguishes a 403 and explains the state.

## Defect 2 — two headers on the Zelle screen (checker app only)

The checker app rendered a second navigation bar, titled `assistant`, above the screen's own
header. Both apps' `assistant.tsx` files are **byte-identical**; the navigator differs. `worker-app`
sets `headerShown: false` once in `screenOptions`, so an unregistered route inherits it.
`checker-app` registers routes individually, so an unregistered route gets the default bar — and
`assistant` was never listed. The comment describing that very setting had been left in the file
without the line it described.

## Defect 3 — Leaderboard title under the status bar (checker app only)

`leaderboard.tsx` laid its header out in a bare `View` with `paddingTop: 4`. It was the only screen
in `(app)/` not wrapped in `SafeAreaView`. The clock rendered through the word "Leaderboard" and
the first letter sat against the screen edge. A fixed pixel value cannot stand in for an inset
whose size is the device's.

## Defect 4 — earlier conversations had no name

Every row in Zelle's history list rendered as a bare `…`, the UI's fallback for `opening === null`.

**Ruled out first, at the data layer:** the transcripts are fine. Six sampled production rows
decrypted cleanly with the configured `CHATBOT_TRANSCRIPT_KEY` (32 bytes, `ok=6 fail=0`), so the
"key rotated on the host" theory — the first suspicion — was wrong.

**The actual cause.** Of 20 stored conversations, exactly one had `user_msgs = 0,
assistant_msgs = 1`: the one begun on 2026-09-21 at 14:15, right after the test checker was
approved. A **tapped chip sends `command_id` and never the label** — deliberately, so the label can
be translated client-side while the backend matches on a stable id. `runTurn` then passed
`userText: params.text`, which is `undefined` for every chip turn, so `recordTurn` stored the
assistant's reply and no user message at all. `listRecentConversations()` names a conversation
after the person's first message, and there was none.

**Fix.** `runTurn` now resolves the command's label server-side (`resolveCommandId`) and records it
as the user's message. This also repairs replay: `replayableHistory()` feeds prior USER messages
into the prompt, so a conversation conducted entirely through chips previously replayed as a
series of answers to questions that were not there. The mobile fallback name is kept for the
historical rows that already have no user message.

## Gaps — what this run does NOT prove

- Defects 2 and 3 are laid out from source and from the owner's screenshots; neither was rendered
  on a device by the agent.
- Defect 4's fix is covered by unit tests at the `runTurn`→`recordTurn` boundary. The existing 20
  production conversations are unchanged — the one nameless row stays nameless, and is why the
  client keeps a fallback.
- The numbered scenarios were not run in this pass.
- **Process note worth keeping:** the first diagnosis of the headline report was confident, backed
  by a passing regression test, and wrong. The test passed because it asserted the behaviour of a
  mocked Prisma client, which is the exact failure shape this project has hit before. It was the
  production read that corrected it. Reading the database first would have saved the whole detour.
