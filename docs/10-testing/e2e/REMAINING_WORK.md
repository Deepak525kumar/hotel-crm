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

*(nothing closed yet — this file was just created)*
