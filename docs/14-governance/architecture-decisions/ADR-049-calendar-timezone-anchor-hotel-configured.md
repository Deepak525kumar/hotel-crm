# ADR-049: Calendar "Today" Anchor — the Hotel's Configured Timezone, Not a Hardcoded Constant

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-CAL-04`, the first sub-decision of `GD-18` (Calendar module scope, M2). Authored by the Lead Architect from `SPEC-CALENDAR-001`'s own `OD-CAL-04` entry and the commissioning human's explicit approval of Option (a), refined to anchor on the hotel's configured timezone field rather than a hardcoded constant.
- **Date:** 2026-07-28
- **Scope:** `SPEC-CALENDAR-001`. Resolves `OD-CAL-04`; informs `REQ-CAL-T03` and `REQ-CAL-T06`, both of which depend on a settled "today" boundary.
- **Supersedes:** none (additive — ratifies the already-applied narrow-slice default as permanent, with a precise framing correction).
- **Change class:** Product/architecture decision per Constitution §6/§7.

## Problem

CRR/PDD do not define the timezone anchoring "today" or the current/future cutoff for Calendar's sick/vacation marking and availability logic. The 2026-07-27 narrow slice applied `Europe/Berlin` as an implementation-time default (matching `Hotel.timezone`'s own default), but this was explicitly disclosed as a stand-in, not a formal resolution — leaving `REQ-CAL-T03` (self-mark sick/vacation) and `REQ-CAL-T06` (today-only availability read-model) without a ratified anchor.

## Decision

1. **"Today" is anchored to the assigning hotel's own configured `Hotel.timezone` field** — not a hardcoded `Europe/Berlin` constant. Every hotel currently has `Europe/Berlin` as its `Hotel.timezone` value (the platform is confirmed Germany-only today), so the *effective* behavior is identical to the narrow slice's default, but the *mechanism* is the field, not a literal.

2. **This is ratified as permanent**, not an implementation-time stand-in. No further decision is needed to treat the narrow slice's timezone handling as settled.

3. **A worker-local timezone model was considered and rejected.** No confirmed requirement calls for per-worker timezone anchoring, and inventing one would be speculative architecture for a problem the platform doesn't have (Constitution §6).

## Rationale

- **Anchoring on `Hotel.timezone` rather than a hardcoded constant costs nothing today and preserves a clean migration path.** If the product ever supports hotels outside `Europe/Berlin`, no schema change and no Calendar-module code change is needed — only new `Hotel.timezone` values on the affected hotel records. A hardcoded constant would require a code change and a full re-decision at that point; anchoring on the existing field avoids that entirely.
- **The platform's own confirmed Germany-only scope makes a worker-local model unnecessary today**, but committing to the field-based mechanism rather than a literal value is a low-cost hedge against that scope changing later, without speculatively building anything not yet needed.

## Consequences

- `SPEC-CALENDAR-001`'s `OD-CAL-04` is resolved: "today" is anchored to `Hotel.timezone`, currently `Europe/Berlin` for every deployment. `REQ-CAL-T03` and `REQ-CAL-T06` may now cite this ADR for their timezone-boundary behavior.
- No code change is required beyond what the narrow slice already applied — the existing `Hotel.timezone`-default-based implementation already matches this decision's mechanism.
- This is the first of `GD-18`'s remaining sub-decisions; `OD-CAL-07`, `OD-CAL-10`, `OD-CAL-11` remain open, tracked under their own rows.

## Compatibility

No runtime behavior changes — the narrow slice's existing `Europe/Berlin`-default behavior already matches this decision (since every current `Hotel.timezone` value is `Europe/Berlin`). No migration, no rollback concern.

## Scope note

This settles the timezone-anchor mechanism only. It does not resolve any other `GD-18` sub-decision.
