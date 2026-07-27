# Module Specification: `geo` (backend-geo)

> Specification of ONE bounded backend capability — **Geolocation / Geofencing** — for the module
> id `backend-geo`. Unlike `attendance` or `consent`, this module has **NO current-state
> footprint to reverse-specify**: `backend/src/modules/geo/` contains only a `.placeholder` file,
> is not imported, not mounted, and carries zero business logic
> (`MODULE_REGISTRY.yaml:214-224`; `DEPENDENCY_GRAPH.yaml:51,339-340,544`; `BOUNDARY_INDEX.yaml:118`;
> `SPECIFICATION_INDEX.yaml:87-89`). This document is therefore almost entirely `[TARGET STATE]`,
> derived from confirmed authorities, plus an explicit disclosure of the absent current state. It
> records behavior and confirmed contract; it does not create product policy and does not resolve
> any open decision. Nothing here is frozen: G2 freeze is reserved human authority.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-GEO-001 / 0.1.2` |
| Status | `FROZEN` |
| Owner | `unassigned (SYNC-001, human authority required)`. `MODULE_REGISTRY.yaml:217` records `owner: unassigned`; no CODEOWNERS entry exists. Owner assignment is reserved human authority and is NOT invented here (same precedent as `docs/03-modules/attendance/MODULE_SPEC.md`, `docs/03-modules/consent/MODULE_SPEC.md`) — non-freeze-blocking, per the `SPEC-AUTH-001`/`SPEC-ATT-001`/`SPEC-USERS-001`/`SPEC-DOCUMENTS-001` precedent. |
| Authors / reviewers | Author: Module Author agent. Reviewers (G4, v0.1.1): Architecture (PASS_WITH_ACTIONS), Dependency (PASS_WITH_ACTIONS), Consistency (PASS), Security (PASS_WITH_ACTIONS — correction applied), Performance (PASS). Zero Critical/High findings across all five dimensions. |
| Repository revision | `0d84fa54231a9912d9f7688c308b837bcae3791a` (HEAD at v0.1.1 authoring time). `backend/src/modules/geo/` contained only `.placeholder` at that revision — verified directly; not yet built as of this freeze. |
| Approved by / at | **FROZEN at G2 Specification Freeze (2026-07-27) following `GD-14` ratification.** This decision resolves the governance blockers preventing freeze (`OD-GEO-001/002/003/004/005/007`); G4 review remains valid with zero Critical/High findings. Remaining open items (`OD-GEO-006`, `OD-GEO-009`) are non-freeze-blocking and explicitly deferred. Full decision record: `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` GD-14. |
| Supersedes | v0.1.1 (Correction — decision recorded, no requirement text re-derived or reinterpreted; see Review and Change Log). First specification for `backend-geo` (registry `specification: UNKNOWN` prior, `MODULE_REGISTRY.yaml:220`; `SPECIFICATION_INDEX.yaml:88`). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel's geolocation/geofencing capability — the
confirmed-but-unbuilt distance/geofence-radius service that gates the Attendance module's
Start/Close clock actions, plus the hotel-coordinate storage and coordinate-retention concerns
that Attendance's own spec explicitly declines to claim sole ownership of.

- `[CURRENT STATE]`: **NONE.** `backend/src/modules/geo/` holds only `.placeholder`
  (`MODULE_REGISTRY.yaml:217-224`: `implementation_status: unimplemented-stub`,
  `dependencies: []`, `published_events: none-observed`, `consumed_events: none-observed`,
  `specification: UNKNOWN`). `DEPENDENCY_GRAPH.yaml:51` classifies it `lifecycle:
  placeholder-unregistered` and states "not imported or mounted anywhere. No relationships exist."
  `DEPENDENCY_GRAPH.yaml:339-340` lists it as an orphan module for the identical reason.
  `BOUNDARY_INDEX.yaml:118`: "placeholder-unregistered stub; no footprint." ADR-003
  (`docs/14-governance/architecture-decisions/ADR-003-modular-monolith-architecture.md:27,37`)
  independently confirms: "Two module directories exist but are empty stubs ... and are NOT
  registered in the router: `backend/src/modules/chatbot/` and `backend/src/modules/geo/`" and
  records both as "declared-but-unimplemented stubs ... recorded as deferred Phase 2+ scope, not as
  current modules." `PIVOT_DESIGN_DOCUMENT.md` §2.2 line 44 lists `geo (placeholder)` among current
  modules, consistent with the above. There is nothing to reverse-specify.
- `[TARGET STATE]` (confirmed, entirely unbuilt — CONFIRMED §17, §25; PIVOT §4.7, §7.4, §8.3, §9.1,
  §12 M3): a **geofence distance-check service** (100 m radius from the hotel) that Attendance's
  Start/Close consumes; a **hotel-coordinate storage** concern (source of truth for hotel
  latitude/longitude, currently absent from the schema — see Evidence below); and a **6-month
  coordinate retention/hard-deletion** concern for captured clock-event coordinates (CONFIRMED §17,
  §25 Tier 1). The precise ownership split of the latter two concerns between `backend-geo` and
  `backend-attendance` is NOT settled by any existing authority (see Open Decisions OD-GEO-001,
  OD-GEO-002 below) — `docs/03-modules/attendance/MODULE_SPEC.md` (line ~238-240) states Attendance
  "will own the geofence check, coordinate storage, and the 6-month retention job (possibly in
  concert with the geo module, CONFIRMED §37 [corrected below: CONFIRMED §34]); it does NOT own the
  hotel-coordinate source of truth" — i.e. Attendance anticipates but does not claim exclusive
  ownership, and explicitly disclaims the hotel-coordinate source of truth. This spec defines what
  `backend-geo` MAY own within that gap; it does not resolve the split unilaterally.

**In scope:**
- `[TARGET]` A distance/geofence-radius calculation service: given a device coordinate pair and a
  hotel coordinate pair, compute distance and return an inside/outside-100m determination
  (CONFIRMED §17; PIVOT §7.4, §8.3).
- `[TARGET]` Candidate ownership of hotel-coordinate storage (the lat/long source of truth) —
  contingent on OD-GEO-001 (below); the current schema has no such field (see Evidence).
- `[TARGET]` Candidate ownership of the 6-month coordinate hard-deletion scheduled job — contingent
  on OD-GEO-002 (below); alternatively this job may live entirely inside `backend-attendance`
  against its own coordinate columns, consuming only a distance-check service from `backend-geo`.

**Out of scope:**
- The Start/Close button semantics, the Attendance state record, the check-in/check-out lifecycle,
  and the EXPECTED->PRESENT/LATE/ABSENT transitions — all owned by `backend-attendance`
  (`docs/03-modules/attendance/MODULE_SPEC.md`). This module does not implement or gate the
  Attendance record itself; it supplies a consumed distance/geofence service.
- Notification delivery mechanics (`backend-notifications`).
- The Hotel entity's non-geo fields (name, city, address, contact info, timezone) — owned by
  `backend-crm` per the existing `state-hotel` domain (`DEPENDENCY_GRAPH.yaml:73`:
  `authoritative_writer: backend-crm`). Whether hotel latitude/longitude becomes new columns on
  the existing `Hotel` model (extending `state-hotel`, still `backend-crm`-authoritative) or a new,
  `backend-geo`-owned state domain keyed to `hotel_id` is UNKNOWN and NOT resolved here
  (OD-GEO-001).
- Any conceptual "hotels" module: `docs/03-modules/hotels/` contains only `README.md`/`.gitkeep`; no
  `MODULE_SPEC.md` exists and no `backend-hotels` module id is registered. `state-hotel`
  (`schema.prisma:192` model `Hotel`) is owned by `backend-crm`, not a distinct hotels module. This
  spec does not invent a `hotels` module contract.

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent
review, or resolving any open decision below — in particular, this spec does NOT decide whether
`backend-geo` or `backend-attendance` runs the retention job, and does NOT decide whether hotel
coordinates live on the `Hotel` model or a new `backend-geo`-owned model.

## Evidence and Traceability

`[CURRENT STATE]` — zero footprint (verified directly against the repository):

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `backend/src/modules/geo/` contains only `.placeholder`; no `.ts` files | `backend/src/modules/geo/.placeholder` @HEAD | Code (direct inspection) | Observed (High) |
| Not imported, not mounted at any route; `implementation_status: unimplemented-stub`, `dependencies: []`, `specification: UNKNOWN` | `MODULE_REGISTRY.yaml:214-224` | Registry | Observed (High) |
| `lifecycle: placeholder-unregistered`; "not imported or mounted anywhere. No relationships exist." | `DEPENDENCY_GRAPH.yaml:51` | Graph | Observed (High) |
| Listed as `orphan_modules` entry: "placeholder-unregistered; only .placeholder file; no imports, no mount, no client." | `DEPENDENCY_GRAPH.yaml:339-340` | Graph | Observed (High) |
| "placeholder-unregistered stub; no footprint" | `BOUNDARY_INDEX.yaml:118` | Boundary index | Observed (High) |
| `spec: none`, `status: UNKNOWN # placeholder-unregistered stub` | `SPECIFICATION_INDEX.yaml:87-89` | Spec index | Observed (High) |
| Declared-but-unimplemented Phase 2+ stub, not route-registered | ADR-003 (`docs/14-governance/architecture-decisions/ADR-003-modular-monolith-architecture.md:27,37`) | Architecture decision | Confirmed |
| `Hotel` Prisma model has no latitude/longitude field (fields: `id, name, city, country, address, timezone, contact_email, contact_phone, is_active, deleted_at, created_at, updated_at`) | `backend/prisma/schema.prisma:192-215` @HEAD (verified directly) | Code (direct inspection) | Observed (High) — current-state gap |
| `geo (placeholder)` listed among current modules | `PIVOT_DESIGN_DOCUMENT.md` §2.2 line 44 | Pivot doc | Confirmed |

`[TARGET STATE]` requirements (TREQ-GEO-001..006) — confirmed authorities, entirely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-GEO-001` Start/Close function only when device is within 100 m of the hotel; radius is a Zirove default, per-hotel configurable later | CONFIRMED §17 (line 264); PIVOT §4.7, §7.4, §8.3 | Confirmed authority | Target; unbuilt |
| `TREQ-GEO-002` location sampled only at Start/Close press, never continuous | CONFIRMED §17; PIVOT §4.7 | Confirmed authority | Target; unbuilt |
| `TREQ-GEO-003` worker shown distance only; exact hotel coordinates never revealed | CONFIRMED §17 | Confirmed authority | Target; unbuilt |
| `TREQ-GEO-004` actual device coordinates captured and stored at each clock-in/out | CONFIRMED §17; PIVOT §7.4, §9.1 | Confirmed authority | Target; unbuilt |
| `TREQ-GEO-005` stored coordinates hard-deleted exactly 6 months after capture, by an automatic scheduled job (GDPR Tier 1) | CONFIRMED §17, §25 (Tier 1, line 333); PIVOT §4.7, §9.1 | Confirmed authority | Target; unbuilt |
| `TREQ-GEO-006` outside the radius, the button is disabled — no clock event, no coordinate write | PIVOT §7.4, §8.3 (sequence diagram) | Confirmed authority | Target; unbuilt |
| Geofenced Start/Close recorded as "new, being created (geo module was a placeholder)" | CONFIRMED §34 (line 398; NOTE: this is the corrected section number — the caller-supplied "§37" in the task brief does not match; verified directly: §34 is "ARCHITECTURE PIVOT DECISIONS", §37 in this document is a different, unrelated section, so the earlier "CONFIRMED §37" citation propagated by `docs/03-modules/attendance/MODULE_SPEC.md` line ~239 is itself imprecise and is corrected here to §34) | Confirmed authority | Confirmed |
| M3 milestone: "Geofence clock-in, coord storage" gated on M2 | PIVOT §12 (line 454, Build Sequence table) | Confirmed authority | Target; unbuilt |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Geofence | A 100 m radius around a hotel's coordinates within which the Start/Close clock buttons are enabled. `[TARGET]` No canonical entry exists yet in `TERMINOLOGY.md` — proposed below. | CONFIRMED §17; PIVOT §7.4 |
| Distance-check service `[TARGET]` | A stateless computation consumed by Attendance's Start/Close: given device coordinates and hotel coordinates, returns distance and an inside/outside-100m boolean. Candidate ownership of `backend-geo`. | PIVOT §7.4, §8.3 (proposed identification, not yet a named contract in any registry) |
| Hotel-coordinate source of truth `[TARGET]` | The authoritative store of each hotel's latitude/longitude. Does NOT exist today (no such Prisma field). Ownership (extend `state-hotel`/`backend-crm`, or a new `backend-geo`-owned domain) is UNSETTLED (OD-GEO-001). | `backend/prisma/schema.prisma:192-215`; `docs/03-modules/attendance/MODULE_SPEC.md` line ~240 |
| Stored clock-event coordinates `[TARGET]` | Device latitude/longitude captured at each Start/Close press; personal location data; 6-month hard-delete TTL. Distinct from hotel-coordinate storage above — this is Attendance's per-event data, not a geo-owned entity, unless OD-GEO-002 resolves otherwise. | CONFIRMED §17, §25; `docs/03-modules/attendance/MODULE_SPEC.md` TRULE-002 |
| `backend-hotels` (NOT a registered module) | No such module id exists in `MODULE_REGISTRY.yaml`/`DEPENDENCY_GRAPH.yaml`. `docs/03-modules/hotels/` holds only `README.md`; the `Hotel` Prisma model is owned by `backend-crm` as `state-hotel`. Referenced here only to disclaim inventing a hotels-module contract. | `DEPENDENCY_GRAPH.yaml:73`; `docs/03-modules/hotels/README.md` |

## Requirements and Acceptance Criteria

`[CURRENT STATE]`: none — no requirements to state; the module has no code.

`[TARGET STATE]` requirements (confirmed authority; unbuilt):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-GEO-001 | Start/Close only function when the device is within 100 m of the hotel. | Must | Distance-check computes device-to-hotel distance; inside 100 m -> proceed; outside -> no clock event. | TRULE-GEO-001 |
| TREQ-GEO-002 | Location is sampled only at Start/Close press, never continuously. | Must | No background/continuous location sampling exists anywhere in the geo service's contract. | TRULE-GEO-002 |
| TREQ-GEO-003 | The worker is shown a distance but never the exact hotel coordinates. | Must | Any API response surfacing geofence status returns distance only, never raw hotel lat/long. | TRULE-GEO-003 |
| TREQ-GEO-004 | Actual device coordinates are captured and stored at each clock-in/out. | Must | Each clock event persists device lat/long (owner UNSETTLED — OD-GEO-002). | TRULE-GEO-004 |
| TREQ-GEO-005 | Stored coordinates are hard-deleted exactly 6 months after capture, by an automatic scheduled job. | Must | A scheduled job removes coordinates older than 6 months; deletion is hard, not soft (owner UNSETTLED — OD-GEO-002). | TRULE-GEO-004 |
| TREQ-GEO-006 | Outside the radius, no clock event or coordinate write occurs. | Must | Out-of-range Start/Close attempt produces neither an Attendance status change nor a stored coordinate. | TRULE-GEO-001 |

## Business Rules

`[CURRENT STATE]`: none.

`[TARGET STATE]` rules (TRULE-GEO-001..004) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-GEO-001 | Distance-check invocation (from Attendance Start/Close) | Succeeds only if computed distance <= 100 m; radius is a Zirove default, per-hotel configurable later (not yet a schema field). | Outside radius -> inside/outside=false; no clock event, no coordinate write. | CONFIRMED §17; PIVOT §4.7, §7.4, §8.3 |
| TRULE-GEO-002 | Any location sampling | Sampled only at the moment of Start/Close press; never continuous or background. | — | CONFIRMED §17; PIVOT §4.7 |
| TRULE-GEO-003 | Presenting geofence status to the worker | Show distance-to-hotel only; never the hotel's exact coordinates. | — | CONFIRMED §17 |
| TRULE-GEO-004 | A successful clock-in/out coordinate capture | Coordinates persist and are hard-deleted exactly 6 months later by an automatic scheduled job. Which module runs this job and holds the columns is UNSETTLED (OD-GEO-002). | Hard delete, not soft; GDPR Tier 1 (CONFIRMED §25). | CONFIRMED §17, §25; PIVOT §9.1 |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. `MODULE_REGISTRY.yaml:217`
records `owner: unassigned`; no CODEOWNERS entry exists. Owner assignment is reserved human
authority and is NOT invented here.

**Owned state:**
- `[TARGET, contingent on OD-GEO-001]` A candidate new state domain for hotel-coordinate storage
  (lat/long keyed to `hotel_id`) IF the resolution is a separate `backend-geo`-owned model rather
  than new columns on the existing `backend-crm`-owned `Hotel` model. NOT decided here.
- `[CURRENT]` None. No Prisma model, no code, no registered state domain exists for `backend-geo`
  today.

**Consumed state:**
- `[TARGET]` `state-hotel` (owner `backend-crm`, `DEPENDENCY_GRAPH.yaml:73`) — read, for hotel
  identity/location, IF hotel coordinates are added to the existing `Hotel` model rather than a new
  geo-owned model (OD-GEO-001 unresolved).
- `[TARGET]` Attendance's clock-event trigger (Start/Close button press) — `backend-geo` is
  consumed BY `backend-attendance`'s Start/Close flow as a distance-check service; it does not
  itself consume or own the Attendance state record. `backend-attendance`'s own spec states it
  will own "the geofence check, coordinate storage, and the 6-month retention job (possibly in
  concert with the geo module ...)" (`docs/03-modules/attendance/MODULE_SPEC.md` line ~238-239) —
  i.e. the trigger originates in Attendance; geo supplies a computation Attendance calls into, not
  the reverse.

**Permitted writes:** `[CURRENT]` none — no code exists. `[TARGET, contingent on OD-GEO-001]` IF
`backend-geo` owns hotel-coordinate storage as a new state domain, it would be the sole writer of
that domain. `backend-geo` does NOT write `state-attendance` (owned by `backend-attendance`) and
does NOT write the non-geo fields of `state-hotel` (owned by `backend-crm`).

**Boundary/non-responsibilities:** This module does NOT own: the Start/Close button semantics or
the Attendance state record (`backend-attendance`); the Hotel entity's non-geo fields — name, city,
address, contact info, timezone (`backend-crm`'s `state-hotel`); notification delivery mechanics
(`backend-notifications`); assignment lifecycle (`backend-assignments`); or any conceptual
"hotels" module (none is registered; see Purpose and Scope). `[OPEN DECISION]` OD-GEO-001: whether
hotel-coordinate storage is (a) new lat/long columns on the existing `Hotel` model (keeping
`state-hotel` under `backend-crm`'s authoritative-write, with `backend-geo` only reading it), or
(b) a new, separate state domain owned by `backend-geo` keyed to `hotel_id`. Repository evidence
does not settle this — it is a schema/ownership design choice reserved to architecture/human
authority. `[OPEN DECISION]` OD-GEO-002: whether the 6-month coordinate retention/hard-deletion
scheduled job (and the coordinate columns themselves) is owned by `backend-attendance` (on its own
`Attendance` record) with `backend-geo` supplying only the stateless distance-check, OR by
`backend-geo` as a first-class owned concern. `docs/03-modules/attendance/MODULE_SPEC.md` line
~238-240 explicitly hedges this as "possibly in concert with the geo module" without resolving it,
and this spec does not resolve it either — both readings remain open pending architecture decision.

## Interfaces and Contracts

`[CURRENT STATE]`: none — no routes, no controller, no service exist.

`[TARGET STATE]` interfaces (unbuilt; shapes NOT yet authored, contingent on OD-GEO-001/002):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `IF-GEO-DISTANCE-CHECK` (proposed, unversioned, not yet authored) | inbound (consumed by `backend-attendance`'s Start/Close) | device lat/long, hotel_id (or hotel lat/long directly) | distance (meters), inside_radius (boolean) | validation error on malformed coordinates; not-found if hotel coordinates absent | internal, service-to-service (exact mechanism — in-process function call vs. HTTP — UNKNOWN under modular-monolith ADR-003; likely in-process given no other backend-to-backend HTTP calls are observed anywhere in `DEPENDENCY_GRAPH.yaml`) | baseline/UNKNOWN — not yet authored |

No further contract shapes are specified: DTOs, versioning, and exact transport (in-process import
vs. a new internal API) are UNKNOWN and reserved to planning/implementation once OD-GEO-001/002
resolve. This mirrors `docs/03-modules/attendance/MODULE_SPEC.md`'s own treatment of its
`[TARGET STATE]` interfaces (line ~269-272): "not specified beyond the confirmed behavior above."

## Events

`[CURRENT STATE]`: none — `published_events: none-observed`, `consumed_events: none-observed`
(`MODULE_REGISTRY.yaml:221-222`). No event bus exists anywhere in the backend
(`docs/03-modules/attendance/MODULE_SPEC.md` line ~276, confirmed independently true repository-wide).

`[TARGET STATE]`: no event is settled by the confirmed authorities for geo specifically. Any
geofence-failure notification (e.g. push alert on repeated out-of-range attempts) is UNKNOWN and
NOT invented here.

## Dependencies

`[CURRENT STATE]`: `dependencies: []` (`MODULE_REGISTRY.yaml:218`); no DEPENDENCY_GRAPH edges exist
for `backend-geo` — it is listed only as a bare node (`DEPENDENCY_GRAPH.yaml:51`) and as an orphan
(`DEPENDENCY_GRAPH.yaml:339-340`).

`[TARGET STATE]` new dependencies (unbuilt, proposed — not applied to `DEPENDENCY_GRAPH.yaml` by
this spec):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-attendance-consumes-geo-distance-check` (proposed) | Attendance's Start/Close calls the geo distance-check to gate clock events | `IF-GEO-DISTANCE-CHECK` (proposed, unauthored) | baseline/UNKNOWN | Distance-check failure/unavailability -> button disabled / no clock event (fail-closed per TRULE-GEO-001's outside-radius behavior; explicit fail-open vs fail-closed on service error is UNKNOWN, OD-GEO-003 below) |
| `edge-geo-reads-hotel` (proposed, contingent on OD-GEO-001 resolving to option (a)) | Read hotel coordinates from `state-hotel` if stored there | Prisma read `state-hotel` (owner `backend-crm`) | baseline/UNKNOWN | Missing hotel coordinates -> distance-check cannot resolve; behavior UNKNOWN |
| `edge-geo-owns-hotel-coordinates` (proposed, contingent on OD-GEO-001 resolving to option (b)) | New `backend-geo`-owned state domain for hotel lat/long | New Prisma model (unauthored) | baseline/UNKNOWN | N/A — module would be sole writer |

Architecture anchors: modular-monolith (ADR-003) and Prisma-over-PostgreSQL (ADR-004, referenced by
`docs/03-modules/attendance/MODULE_SPEC.md`) apply to any future geo implementation; no repository
evidence suggests otherwise.

## State and Lifecycle

`[CURRENT STATE]`: no state exists — no Prisma model, no lifecycle, nothing to document.

`[TARGET STATE]` (contingent on OD-GEO-001/002): IF `backend-geo` owns hotel-coordinate storage, its
lifecycle would be: hotel coordinates set (by whom — manager during hotel creation? — UNKNOWN,
OD-GEO-004) -> read on every distance-check invocation -> updated only via an explicit
administrative action (mechanism UNKNOWN). IF `backend-geo` owns the retention job, its lifecycle
per stored coordinate would be: captured at clock-in/out -> retained -> hard-deleted at exactly 6
months by an automatic scheduled job (CONFIRMED §17, §25 Tier 1; TRULE-GEO-004). No invariants,
concurrency behavior, or migration order are settled beyond this — both are contingent on the open
ownership decisions above.

**Retention:** `[TARGET]` GDPR Tier 1 (CONFIRMED §25, line 333): shift clock-in/out coordinates
retained 6 months, then hard-deleted, automatically. This is the only retention rule any
confirmed authority attaches to geo-adjacent data; hotel-coordinate retention (if `backend-geo`
owns that storage) is not itself a personal-data retention concern and no TTL is confirmed for it.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` N/A — no code. `[TARGET]` If the distance-check service is
unavailable or a hotel has no coordinates on file, whether Start/Close fails closed (button stays
disabled, matching the outside-radius behavior) or fails open is UNKNOWN and NOT decided here
(`[OPEN DECISION]` OD-GEO-003). GPS drift near large buildings is the confirmed rationale for the
100 m (rather than a tighter) radius (CONFIRMED §17 line 264; PIVOT §7.4 failure-modes note).
Client-supplied device coordinates are inherently spoofable (mock-location tooling, GPS
spoofing apps); no confirmed authority states a server-side countermeasure (e.g. mock-location
detection, velocity/plausibility checks), so this is disclosed as an accepted, unresolved abuse
vector rather than silently assumed away (`[OPEN DECISION]` OD-GEO-009).

**Trust boundaries/authorization:** `[TARGET]` No confirmed authority states which roles may read
raw device coordinates vs. only the computed distance. TREQ-GEO-003/TRULE-GEO-003 confirm the
WORKER is shown distance only, never the hotel's exact coordinates. Whether admin/manager roles may
view stored worker coordinates (e.g. for dispute investigation) is UNKNOWN and NOT decided here
(`[OPEN DECISION]` OD-GEO-005) — this mirrors the class of cross-tenant/role-scoping open questions
`docs/03-modules/attendance/MODULE_SPEC.md` raises as OQ-01/OQ-02, but is a distinct, geo-specific
question not covered by those.

**Data classification/retention:** Device coordinates captured at clock events are **personal
location data** (GDPR-relevant, special sensitivity given precision). Confirmed control: automatic
6-month hard-delete (CONFIRMED §17, §25 Tier 1; PIVOT §9.1). Hotel coordinates (if geo-owned) are
NOT personal data and carry no confirmed retention obligation of their own. This is the same
privacy framing `docs/03-modules/attendance/MODULE_SPEC.md` gives its own (largely overlapping)
target-state coordinate concern; the two specs must not double-count the same 6-month retention
obligation as belonging to both modules once OD-GEO-002 resolves.

**Performance budgets/workload:** No explicit budgets or SLOs are defined by any authority
(`[OPEN DECISION]` OD-GEO-006, blocked on ownership SYNC-001 — mirrors `docs/03-modules/attendance/
MODULE_SPEC.md` OQ-10's identical framing). A per-clock distance computation is lightweight
(haversine or similar); a periodic retention sweep's volume depends on clock-event rate (UNKNOWN).
Single-tenant-per-client deployment (PIVOT §5.1, referenced by the attendance spec) suggests modest
scale; no figures confirmed.

**Observability/audit:** `[CURRENT]` N/A — no code. `[TARGET]` No confirmed authority specifies
audit-log requirements for geofence checks or coordinate access specifically; `backend-attendance`'s
existing `BaseService.logAudit` pattern (`CHECK_IN`/`UPDATE_ATTENDANCE`) is the closest analog but
whether geofence pass/fail events themselves are audited is UNKNOWN (`[OPEN DECISION]` OD-GEO-007).

## Rollout and Compatibility

No current-state code exists to migrate away from. `[TARGET]` This capability is gated behind
Milestone M3 "Field ops" (PIVOT §12, line 454: "Geofence clock-in, coord storage, rework 20m timer,
warnings", dependency `M2`). No feature-flag, migration-order, or rollback mechanism is confirmed by
any authority; these are planning/implementation concerns reserved to a future planning workflow,
not invented here. Removal criteria: N/A (nothing exists to remove).

## Validation Plan

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| TREQ-GEO-001/TRULE-GEO-001 (100 m gate) | Unit + integration | Test hotel with known coordinates; device coordinates at varying distances (inside/outside 100 m, boundary case) | Distance computation correctness; button/clock-event gating verified end-to-end with `backend-attendance` once both are built |
| TREQ-GEO-002 (sample-at-press-only) | Code review / static check | N/A (absence-of-continuous-tracking check) | No background location API usage in the implemented contract |
| TREQ-GEO-003 (distance-only exposure) | API contract test | Sample geofence-status response | Response payload contains distance field only, no raw hotel lat/long |
| TREQ-GEO-004/TREQ-GEO-005 (capture + 6-month hard delete) | Integration + scheduled-job test | Seeded coordinates aged past/before the 6-month boundary | Job deletes only records older than exactly 6 months; deletion is hard (row removed, not soft-flagged) |
| Ownership split (OD-GEO-001/002) | N/A — blocked | N/A | Cannot be validated until resolved by architecture/human decision |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OD-GEO-001 | decision-required | Where does hotel-coordinate storage (the lat/long source of truth) live: new columns on the existing `Hotel` model (`state-hotel`, `backend-crm`-owned), or a new separate state domain owned by `backend-geo`? No authority settles this; `backend/prisma/schema.prisma:192-215` has no lat/long field today. **RESOLVED 2026-07-27 by `GD-14`:** option (a) — new columns on `Hotel` (`state-hotel`, `backend-crm`-owned). No separate geo-owned hotel-coordinate domain. | `schema.prisma:192-215`; `DEPENDENCY_GRAPH.yaml:73`; `docs/03-modules/attendance/MODULE_SPEC.md` line ~240 | human/architecture | **Resolved** (`GD-14`, 2026-07-27) |
| OD-GEO-002 | decision-required | Who owns the 6-month coordinate retention/hard-deletion scheduled job and the coordinate columns themselves: `backend-attendance` (on its own `Attendance` record, consuming only a `backend-geo` distance-check — this document's own baseline framing, e.g. line ~67/~127), or `backend-geo` as a first-class owned concern (a new, stateful `backend-geo` state domain)? `docs/03-modules/attendance/MODULE_SPEC.md` line ~238-240 explicitly leaves this open ("possibly in concert with the geo module"). **RESOLVED 2026-07-27 by `GD-14`, deliberately choosing the second, stateful option over this document's own stateless-default framing:** `backend-geo` owns the worker-coordinate columns (a new `backend-geo`-owned table, keyed to worker + timestamp) and the 6-month hard-delete retention sweep job (Tier 1, `GD-09`'s tier framework) — not `backend-attendance`. This is a considered architecture choice, not the path of least resistance: it introduces a second storage owner alongside `OD-GEO-001`'s CRM-owned `Hotel` coordinates (`backend-crm` owns hotel coordinates; `backend-geo` owns worker coordinates), rather than keeping `backend-geo` a purely stateless distance-check service. Rationale: the coordinate-retention concern (6-month sweep, GDPR Tier 1) is conceptually a geo/location responsibility, not an attendance-event responsibility, and keeping it in `backend-geo` avoids `backend-attendance` growing a second, unrelated data-retention job alongside its own attendance-record lifecycle. | CONFIRMED §17, §25; PIVOT §9.1; `docs/03-modules/attendance/MODULE_SPEC.md` line ~238-240 | human/architecture | **Resolved** (`GD-14`, 2026-07-27) |
| OD-GEO-003 | decision-required | On distance-check service failure or missing hotel coordinates, does Start/Close fail closed (button stays disabled) or fail open? No authority states this. **RESOLVED 2026-07-27 by `GD-14`:** fail-closed — the clock action is disabled, never silently allowed, on missing hotel coordinates or a distance-check service failure. | PIVOT §7.4 (failure-modes note covers GPS drift only, not service failure) | human/architecture | **Resolved** (`GD-14`, 2026-07-27) |
| OD-GEO-004 | decision-required | Who sets/edits a hotel's coordinates, and by what mechanism (admin UI field, geocoding from address, manual entry)? No authority settles this. **RESOLVED 2026-07-27 by `GD-14`:** admin-only manual entry, via the same `HotelWriteGate` MASTER-data surface every other `Hotel` field uses (`frontend/components/auth/RoleGate.tsx`, PR #251). No geocoding-from-address service. | `schema.prisma:192-215` (no field exists); no confirmed workflow | human | **Resolved** (`GD-14`, 2026-07-27) |
| OD-GEO-005 | decision-required | May admin/manager roles view raw stored worker coordinates (e.g., for dispute investigation), or only computed distance? No authority settles this; distinct from Attendance's own OQ-01/OQ-02 role-scoping questions. **RESOLVED 2026-07-27 by `GD-14`:** computed distance/pass-fail result only — admin/manager never see a worker's raw stored latitude/longitude. | CONFIRMED §17 (worker-facing distance-only rule only) | human/architecture | **Resolved** (`GD-14`, 2026-07-27) |
| OD-GEO-006 | assumption/risk | No performance budgets/SLOs are defined for distance-check latency or retention-sweep volume/cadence. Blocked on ownership assignment (SYNC-001), mirroring `docs/03-modules/attendance/MODULE_SPEC.md` OQ-10. | No authority states figures | human | Open — non-freeze-blocking, G8 release prerequisite (`GD-14`, 2026-07-27, explicitly left open, same precedent as `SPEC-DOCUMENTS-001`) |
| OD-GEO-007 | decision-required | Are geofence pass/fail events themselves audit-logged (distinct from the Attendance `CHECK_IN`/`UPDATE_ATTENDANCE` audit rows)? No authority settles this. **RESOLVED 2026-07-27 by `GD-14`:** yes — every distance-check result (pass or fail) is recorded via the existing `BaseService.logAudit()` mechanism, distinct from Attendance's own audit rows. | No confirmed authority | human/architecture | **Resolved** (`GD-14`, 2026-07-27) |
| OD-GEO-008 | correction | The task brief's supplied citation "CONFIRMED §37" (echoing `docs/03-modules/attendance/MODULE_SPEC.md` line ~239's own citation) does not match this document's actual section numbering: the "geo module was a placeholder" quote is at §34 ("ARCHITECTURE PIVOT DECISIONS", line 398), not §37. Recorded here as a citation correction, not a new requirement; the underlying content is unaffected. Attendance's own spec (line ~239) carries the same imprecise citation and may warrant a matching correction there — flagged, not applied (out of this spec's scope to edit another module's file). | `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md:390-398` (verified directly) | human/documentation | OPEN — flagged for cross-spec correction (unaffected by `GD-14`; not a decision item) |
| OD-GEO-009 | security, decision-required | Client-supplied device coordinates are an inherently spoofable input (mock-location tooling); no confirmed authority specifies a server-side countermeasure (mock-location detection, plausibility/velocity checks). Raised by this session's security-dimension review (G4) as a disclosed, unresolved abuse vector rather than a silently-assumed-safe input. **`GD-14` (2026-07-27) explicitly declines to add a countermeasure for this MVP slice** — recorded as a deliberate, disclosed, accepted risk, not silently omitted; revisit post-MVP if abuse is observed. | No confirmed authority; PIVOT §7.4/§8.3 describe only the happy-path geofence flow | human/architecture | Open — deliberately deferred, not resolved (`GD-14`, 2026-07-27) |

## Proposed Knowledge Deltas

None of the following are applied by this spec — they are proposals for the Lead Architect to
synchronize after G4/G6 pass, per Repository Rules and `docs/03-modules/attendance/MODULE_SPEC.md`'s
identical deferral pattern:

- **`MODULE_REGISTRY.yaml`** (`backend-geo` entry, currently lines 214-224): update
  `specification:` from `UNKNOWN` to `SPEC-GEO-001@0.1.0 (REVIEW)`. Do NOT change `owner:
  unassigned`, `implementation_status: unimplemented-stub`, or `lifecycle: declared` — no code
  exists yet (mirrors `SPEC-CHATBOT-001`'s identical zero-code deferral pattern,
  `MODULE_REGISTRY.yaml:212`).
- **`SPECIFICATION_INDEX.yaml`** (`backend-geo` entry, lines 87-89): update `spec: none` -> `spec:
  SPEC-GEO-001@0.1.0`; `status: UNKNOWN` -> `status: REVIEW`.
- **`DEPENDENCY_GRAPH.yaml`**: no edges are added yet — this graph "records only
  repository-observed relationships, never speculative ones for an unbuilt module" (per its own
  comment at line ~44-50 governing the identical `backend-chatbot` deferral). Proposed once code
  exists: `edge-attendance-consumes-geo-distance-check`; contingent on OD-GEO-001, either
  `edge-geo-reads-hotel` or a new `state-domain` node plus writer/reader edges for
  hotel-coordinate storage.
- **`BOUNDARY_INDEX.yaml`**: update the `backend-geo` row (currently line 118, "placeholder-
  unregistered stub; no footprint") to note `SPEC-GEO-001@0.1.0 (REVIEW)` exists, mirroring the
  `backend-chatbot` row's format (line 117) — but do not add module/state-domain entries until
  code exists.
- **`TERMINOLOGY.md`**: propose first canonical entries for "Geofence", "Distance-check service",
  and "Hotel-coordinate source of truth" (definitions as given in Actors and Terminology above). No
  entries for these terms exist today (verified: `grep -i geo` against `TERMINOLOGY.md` and
  `DECISION_INDEX.md` returns no matches) — this spec introduces the first canonical definitions,
  proposed only, not silently applied.
- **`DECISION_INDEX.md`**: propose a "Pending Decision Records (Geo / Attendance boundary)" section
  analogous to the existing "Pending Decision Records (Chatbot / Onboarding boundary)" precedent
  (`BOUNDARY_INDEX.yaml` reference at line 121), tracking OD-GEO-001 and OD-GEO-002 as candidate
  future ADRs once architecture authority resolves them.
- **`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`**: propose new rows `SIR-GEO-001`
  (OD-GEO-001, hotel-coordinate storage ownership), `SIR-GEO-002` (OD-GEO-002, retention-job
  ownership split), `SIR-GEO-003` (OD-GEO-003, fail-open/fail-closed), `SIR-GEO-004` (OD-GEO-004,
  coordinate-entry mechanism), `SIR-GEO-005` (OD-GEO-005, coordinate read-access RBAC),
  `SIR-GEO-006` (OD-GEO-006, performance budgets), `SIR-GEO-007` (OD-GEO-007, geofence audit
  logging), `SIR-GEO-008` (OD-GEO-008, citation correction), `SIR-GEO-009` (OD-GEO-009,
  GPS-spoofing abuse vector, added at G4 security review). Verified: no `SIR-GEO-*` or geo-related
  `SIR-GLOB-*` rows exist yet (`grep -i geo .claude/governance/SPECIFICATION_ISSUES_REGISTER.md`
  returns no matches at authoring time) — these would be new rows, not duplicates.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-13 | Initial authoring. Zero current-state footprint confirmed directly against the repository; all requirements derived as `[TARGET STATE]` from CONFIRMED §17/§25/§34 and PIVOT §4.7/§7.4/§8.3/§9.1/§12. Ownership split with `backend-attendance` left as explicit open decisions (OD-GEO-001, OD-GEO-002) rather than invented. Not yet reviewed (first candidate). | — | Not approved; G2 reserved to human |
| 0.1.1 | 2026-07-13 | G4 Independent Review round (Architecture, Dependency, Consistency, Security, Performance): Architecture=`PASS_WITH_ACTIONS` (boundary coherent; OD-GEO-001/002 acceptable as open at REVIEW status, must resolve before FROZEN), Dependency=`PASS_WITH_ACTIONS` (proposed edges correct; deferred-graph-application pattern consistent with `backend-chatbot` precedent), Consistency=`PASS` (all quoted attendance lines and the OD-GEO-008 §37→§34 citation correction verified accurate against the repository), Security=`PASS_WITH_ACTIONS` (retention/access-scoping disclosure adequate; added new `OD-GEO-009` disclosing GPS-spoofing as an unresolved abuse vector, previously unflagged), Performance=`PASS` (OD-GEO-006 budget gap already adequately flagged). Correction applied: added GPS-spoofing disclosure to Failure/Security section and `OD-GEO-009` row. Zero Critical/High findings; all actions are disclosure additions, not scope changes. Status remains `REVIEW` — G2 freeze still reserved to human, all 9 Open Decisions remain OPEN. | FIND-SEC-GEO-01 (spoofing disclosure) | Not approved; G2 reserved to human |
| 0.1.2 | 2026-07-27 | **Correction — decision recorded, no requirement text re-derived or reinterpreted.** `GD-14` (Decided, 2026-07-27, by the commissioning human): resolves `OD-GEO-001` (hotel coordinates as `Hotel` columns, option (a)), `OD-GEO-002` (`backend-geo` owns worker-coordinate columns + the 6-month retention sweep), `OD-GEO-003` (fail-closed), `OD-GEO-004` (admin-only manual coordinate entry via the existing `HotelWriteGate` MASTER-data surface), `OD-GEO-005` (admin/manager see computed distance/pass-fail only, never raw coordinates), `OD-GEO-007` (geofence pass/fail is audit-logged via `BaseService.logAudit()`). `OD-GEO-006` (performance budgets) and `OD-GEO-009` (GPS-spoofing countermeasure) remain explicitly OPEN/deferred, not silently resolved — see each row's own disposition above and `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` GD-14 for the full record. `OD-GEO-008` (citation correction) is unaffected. All five G4 dimensions from v0.1.1 remain valid (zero Critical/High, no requirement text changed by this pass) — this Correction resolves the human-authority blocker Architecture's own v0.1.1 finding named, per the same `SPEC-DOCUMENTS-001`/`GD-16` precedent for a decision-only Correction that freezes without re-running G4. Status: `REVIEW` → `FROZEN`. | — (decision recorded; no new finding) | **FROZEN** — approved by the commissioning human, `GD-14`, 2026-07-27 |
