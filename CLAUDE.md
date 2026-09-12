# hotel-crm

A workforce CRM for hotel cleaning companies: who is scheduled where, who
actually turned up, what they cleaned, and what they get paid for it. Real
users are housekeepers on phones mid-shift, hotel managers at a front desk,
regional managers across a group, and admins.

It is in **production** at `deepcleaninghub.de`. Changes here reach people
doing a shift tomorrow morning.

## The engineering operating system comes first

`.claude/CLAUDE.md` is the bootloader — the constitution, workflows, review
gates and agent contracts. **Read it before any engineering activity.** This
file does not replace it; it carries the repository-level facts that the
bootloader keeps out of `.claude/` on purpose (see its Knowledge Separation
section).

Two mandatory entry points are declared there and are easy to miss:

- **Testing / QA anything** → read `docs/10-testing/e2e/README.md` first and
  run the numbered scenarios. Do not invent a test plan.
- **Any chatbot work at all** → read `docs/implementation/CHATBOT_HANDOFF.md`
  first, then `GD-19_CHATBOT_CHECKPOINT.md`.

## Layout

| Path | What it is |
| --- | --- |
| `backend/` | Express + TypeScript modular monolith, Prisma/Postgres. The only thing that touches the database. |
| `frontend/` | Next.js web app — admin, manager and regional-manager surfaces. |
| `mobile/worker-app/` | Expo app for housekeepers. |
| `mobile/checker-app/` | Expo app for quality checkers. |
| `daiwi/` | App-distribution portal on :3002. Uploading never publishes. |
| `docs/` | Specifications, ADRs, E2E scenarios, implementation handoffs. |
| `.claude/` | Reusable engineering framework. `knowledge/` inside it holds repo facts. |

Each of those directories has its own `CLAUDE.md` with the things that have
actually cost time there. Read the one for the code you are touching.

## Gates — all four, before pushing

CI fails on any of these, and a push costs Actions minutes either way:

```bash
cd backend   && npx tsc --noEmit && npm run lint && npx jest --runInBand --forceExit --ci
cd frontend  && npx tsc --noEmit && npm run lint && npx jest --ci && npx next build
cd mobile/worker-app  && npm run typecheck && npx expo lint && npx jest --forceExit
cd mobile/checker-app && npm run typecheck && npx expo lint && npx jest --forceExit
```

**Lint is the one that gets skipped and the one that fails CI.** `tsc` and
`jest` passing is not evidence the build is green; that mistake has been made
here more than once.

**The two mobile apps are kept in lockstep by a test.** `locales.test.ts`
asserts each app's catalogue deep-equals the frontend's, so a string added to
one app alone fails CI in a branch that never touched mobile. Add a key to all
three, or to none.

## Working agreements

These are standing instructions from the repository owner, not preferences:

- **One PR at a time.** Never open several. Never stack a PR on another PR's
  branch — always branch fresh off `main`.
- **Never merge a PR.** The owner merges.
- **Batch commits.** Commit locally as work completes and push once; every
  push is a full CI run.
- **Never send a real email to verify something in production.** It costs
  money per send.
- **Never enable enhancement rating.** Same reason.
- **Ask before changing anything in Hostinger or Resend.**
- `.env` on EC2 is an untracked production copy, edited by hand on the host. A
  config bug there cannot be fixed by a PR.
- EC2 deploy and restart are pre-authorised; do not pause to confirm them.

## Things that are true and non-obvious

- **Authorization is re-derived server-side, never accepted as input.** This
  is enforced at compile time, at registration, and by static tests in the
  chatbot's tool layer. Do not weaken any of the three.
- **Check permissions against the real `ROLE_PERMISSIONS`** in
  `backend/src/config/constants.ts`. A tool once required a token `WORKER` does
  not hold and would have denied every worker in production, while 100+ tests
  passed because they fabricated the permission.
- **`regional_manager` breaks silently.** Role gates are exact-match strings,
  so a check written for `manager` alone omits RM at roughly forty sites with
  no error anywhere. Grep for both together.
- **A 200 means nothing.** Verify writes at the data layer. This suite has
  repeatedly returned success having written nothing, or the wrong thing.
- **Never substitute a direct DB write for the path under test.** If the real
  path cannot run, that is a gap to report, never a pass.
- The live stack is `deepcleaninghub.de` + Vercel + RDS. The `hotelcrm.app`
  nginx config in this repo was never deployed.
- Times are `Europe/Berlin` (`CALENDAR_TIMEZONE`). A UTC "today" gives a
  night-shift manager yesterday.

## Comments

This codebase explains *why*, at length, at the point where someone would
otherwise repeat a mistake — including dates, the symptom as reported, and
what was ruled out. Match that. A comment restating what the line does is
noise; a comment recording what it cost to learn is the point.
