# ADR-027: Notification Channel Enum Shape — `IN_APP` / `EMAIL` / `PUSH` / `SMS` / `WEBHOOK`

- **Status:** Accepted. Ratified directly by the project owner (human decision, recorded 2026-07-22, session `claude/epic-5-verification-next-u5tet9`) — Constitution §20 human/product authority.
- **Date:** 2026-07-22
- **Scope:** Data model / integration-architecture decision — resolves `SPEC-NOTIF-001` `OQ-NOTIF-01` (blocking `TREQ-002`/`TREQ-012` planning): the shape of the `NotificationChannel` enum, and specifically whether provider-specific delivery mechanisms (e.g. WhatsApp, Slack) are first-class enum members or a transport/provider detail underneath one of the enum's channels. Closes `SIR-NOTIF-001`.
- **Supersedes:** none (additive; settles enum membership, does not decide per-channel delivery/dispatch implementation, which remains future implementation work under `TREQ-002`/`TREQ-012`).
- **Change class:** Material data-model decision requiring a Decision Record per Constitution §6/§7, same class as `ADR-011`/`ADR-017`. `SPEC-NOTIF-001`'s FROZEN text is corrected at its next revision (Correction-class forward-note), not by this record.

## Problem

`SPEC-NOTIF-001`'s `OQ-NOTIF-01` (`SIR-NOTIF-001`) recorded the live `NotificationChannel` enum (`backend/prisma/schema.prisma:80-85`: `IN_APP`, `EMAIL`, `PUSH`, `SMS`) as unreconciled against two CONFIRMED/PIVOT statements in apparent tension — a push-only design note (CONFIRMED §18) versus a rework description of "in-app inbox AND push, both channels" (CONFIRMED §14) — leaving open whether `EMAIL`/`SMS` are dead enum values, and, separately, whether provider-specific channels (WhatsApp, Slack, etc.) belong in the enum at all. No Decision Record existed; `TREQ-002`/`TREQ-012` planning was blocked pending one.

## Decision

1. **The canonical `NotificationChannel` enum is exactly five members: `IN_APP`, `EMAIL`, `PUSH`, `SMS`, `WEBHOOK`.** `WEBHOOK` is added as a new member (schema currently has only the first four); the existing four are retained as-is — `EMAIL`/`SMS` are **not** dead values by this decision; per-trigger channel selection (which triggers use which channel(s)) is implementation detail left to `TREQ-002`/`TREQ-012`, not settled here.
2. **Provider-specific implementations are NOT enum members.** WhatsApp, Slack, and any other named third-party delivery provider are modeled as a *provider/transport detail* underneath one of the five channels above (e.g. a WhatsApp Business API integration is a `WEBHOOK`-channel provider, or a future dedicated provider/transport field on the notification/delivery record) — never as a new top-level `NotificationChannel` value. This keeps the enum a fixed, small classification of delivery *medium*, distinct from the open-ended set of vendors that might implement any one medium.
3. **This record does not resolve the push-only-vs-both-channels design tension (CONFIRMED §18 vs §14)** on its own terms — it resolves the enum-*shape* question `OQ-NOTIF-01` was scoped to. Which channel(s) a given trigger dispatches to remains `TREQ-002`/`TREQ-012` implementation scope, to be settled when those triggers are built, using this enum as the closed set of legal values.

## Grounding facts (verified against repository authority)

- `backend/prisma/schema.prisma:80-85`: `enum NotificationChannel { IN_APP EMAIL PUSH SMS }` — live, four members, no `WEBHOOK`.
- `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-NOTIF-001` (line 102): "A Decision Record is required, not optional, before any implementation planning for `TREQ-002`/`TREQ-012`."
- `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` §9 ledger, line 424: "NOTIF OQ-NOTIF-01 (channel enum shape) — Blocks TREQ-002/TREQ-012 — Decision Record" — this record is that Decision Record.
- `backend/src/modules/notifications/` (`service.ts`, `routes.ts`, `controller.ts`, `types.ts`): no channel-dispatch logic exists yet for any channel (module is a thin placeholder); no code beyond the schema enum currently references `NotificationChannel` members, so widening the enum is additive and non-breaking to existing code.

## Compatibility

| Authority | Effect |
|---|---|
| `SPEC-NOTIF-001` (FROZEN) | `OQ-NOTIF-01`'s enum-shape question resolves to "5 members, provider is a transport detail" at the spec's next revision — a Correction-class forward-note, not made by this record. |
| CONFIRMED §14/§18 tension | Not resolved by this record (see Decision item 3); remains open implementation scope for `TREQ-002`/`TREQ-012`, tracked separately, not reopened as a new blocking OQ by this ADR. |
| `IMPLEMENTATION_EXECUTION_PLAN.md` §3/§9 | `NOTIF OQ-NOTIF-01` row updated in this same governance pass from "Decision Record" (required) to "Resolved — `ADR-027`"; Epic 7's push/channel-dependent PRs (`TREQ-002`/`TREQ-012`) may now be planned against a settled enum, though their own design (which trigger uses which channel) is separate, unresolved implementation work. |

No blocking contradiction found against any other checked authority.

## Consequences

- `NotificationChannel` gains `WEBHOOK` (Prisma schema + migration), executed in this same implementation pass (see `IMPLEMENTATION_EXECUTION_PLAN.md` Epic 7 tracking and the accompanying migration).
- `SIR-NOTIF-001` is marked RESOLVED in the same governance pass that adds this ADR.
- `SPEC-NOTIF-001` gains, at its next revision, the resolved `OQ-NOTIF-01` enum-shape disposition.
- `DECISION_INDEX.md` gains this row (`ADR-027`, Accepted) in the same governance pass.
- No dispatch/delivery implementation for `WEBHOOK` (or any channel) is authorized or implied by this record; only the enum member and its schema/migration presence.
