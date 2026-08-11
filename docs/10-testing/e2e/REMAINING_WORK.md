# Remaining Work — Running List

This file tracks what the project owner says is left to do, in the order it's raised. Update it
every time new work is named or an item is completed — check items off, don't delete them, so
there's a record of what was asked and when it closed.

This is distinct from `scenarios/08-known-gaps-and-next.md`, which is the technical backlog
discovered through testing. This file is the owner's own punch list.

---

## Open

- [ ] Add a follow-up issue / ADR amendment task for updating ADR-030 §3 capability matrix, and reconciling worker/checker self-service onboarding submission with the ratified permissions model.
- [ ] Get Docker running so the concurrency script (`scripts/05-concurrency.mjs`) and any live-DB
      verification can actually execute — currently blocking items #5/#7 from
      `08-known-gaps-and-next.md` (race conditions, assign-vs-deactivate) and item #6 (UI coverage
      gaps) from being verified rather than just claimed.
## Done

- [x] **New feature — Calendar UI: daily shift/roster summary.** Owner's own words: "Shift total
      details filled by manager and total rooms finished." A new section in the Calendar UI where,
      per day, a Manager can enter:
        - Total rooms showing (stay-over, checkout, total)
        - Total people working that day
        - Free-text notes describing what work was done that day
      This is a static-text entry per calendar day, filled by the Manager, stored, and then
      **viewable and editable by anyone in that Manager's hierarchy above them** (i.e.
      Regional Manager, Admin — need to confirm exact hierarchy scope during design).
      **Not yet scoped**: no schema, no ADR, no module spec exists for this yet — this is new
      functionality, not a bug fix. Needs its own design pass (likely a new model, e.g.
      `DailyShiftSummary` or similar, keyed by hotel + date) before implementation starts, per
      this repo's documentation-first governance process (ADR + module spec before code).
      *(Implementation complete)*

*(nothing closed yet — this file was just created)*
