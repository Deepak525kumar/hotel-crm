# ADR-071: Device Push Tokens Stay in PostgreSQL — Firebase Is a Delivery Transport, Not a Datastore

- **Status:** Accepted. Ratified directly by the project owner (human decision, recorded 2026-08-25) — Constitution §6/§7/§20 human/product + architecture authority.
- **Date:** 2026-08-25
- **Scope:** Data-ownership decision for one table. Fixes *where* device push tokens are persisted. Does not touch how notifications are delivered, retried, or scheduled — `ADR-029` remains the authority for all of that.
- **Builds on:** `ADR-003` (modular monolith), `ADR-004` (Prisma ORM), `ADR-005` (PostgreSQL as the datastore), `ADR-029` (transactional outbox + Platform Worker).
- **Supersedes:** No prior ADR. **Resolves a divergence from `ADR-029`** introduced by PR #526 and recorded as `SIR-NOTIF-012`: `ADR-029`'s Consequences named "a `PushToken` model for PUSH", and #526 made the store pluggable with a Firestore implementation. This record restores conformance rather than amending `ADR-029`, whose original text is reaffirmed unchanged.
- **Change class:** Material data-model decision requiring a Decision Record per Constitution §6/§7. Reverses a previously-merged implementation choice; no migration and no data movement (see Consequences).

## Problem

Device push tokens — one row per phone, so the Platform Worker knows where to send a notification — were moved out of PostgreSQL into Firestore by PR #526, behind an abstraction with two implementations. PR #534 then made the selection an explicit opt-in (`FEATURE_PUSH_TOKEN_STORE_FIRESTORE`, default off) after review found that the Firebase *credentials* alone had been selecting the store, so an operator enabling FCM sends would have silently migrated it.

That left the repository carrying a second datastore for a single small table, switched off, used by no deployment. The question this record settles is whether that option should exist at all.

## Decision

**Device push tokens live in PostgreSQL, in the `PushToken` table, and nowhere else.** The Firestore implementation, its feature flag, the `firebase-admin` dependency, and `firestore.rules` are removed.

**Firebase keeps exactly one role in this system: a delivery transport.** `FcmProviderClient` (`ADR-029` §4) speaks FCM HTTP v1 to reach Android devices, authenticating with `FIREBASE_PROJECT_ID` + `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64`. Those two variables are unchanged and still required. Firebase is not a datastore here, and no Firebase client library is a backend dependency.

### Why the original rationale no longer held

Firestore was chosen when the *device* was to write its own token directly, during a short-lived attempt to move authentication to Firebase Auth. That attempt was reverted — the mobile apps authenticate against the backend's own JWTs, and the project owner confirmed authentication stays with this system.

Once the **backend** owns the write (via the authenticated `POST /notifications/push-tokens`), Firestore's advantage disappears entirely: the writer already holds a PostgreSQL connection, inside the same request, in the same transaction scope as everything else it does. What remained was cost without benefit:

1. **A second datastore for one table**, against `ADR-005`.
2. **No referential integrity.** `PushToken.user_id` has `onDelete: Cascade`; deleting a user removes their device tokens for free. Firestore has no foreign key, so a deleted user's tokens persist until each device is independently invalidated by its provider — a GDPR-relevant residue that every future hard-delete path would have had to remember to clean up by hand.
3. **Security rules as a separate deployment step.** The store is only safe once deny-all `firestore.rules` are deployed to the right project; an undeployed or test-mode ruleset exposes device tokens to anyone holding the client-embedded web API key. Nothing in CI enforced that ordering.
4. **A schemaless store needing defensive parsing.** The Firestore implementation had to skip malformed documents, because a hand-edited or future-client document could otherwise route an Android token to APNs and get it permanently invalidated. A typed column cannot express that failure.
5. **Cross-user uniqueness by hand.** `PushToken.token` is `UNIQUE`, so re-registering a device under a new user *moves* it — the previous owner stops receiving notifications on a phone that is no longer theirs. Firestore's per-user subcollections have no such constraint, so the implementation carried a `pushTokenOwners/{digest}` reverse index and a transaction to reproduce it. That is a security-relevant invariant re-implemented in application code, where the database already enforced it.

## Constraints (codified by this decision)

- No Firebase or Google client SDK may be added as a backend dependency for persistence. `firebase-admin` specifically must not return for this purpose.
- Device push tokens are read and written only through Prisma, against `PushToken`.
- Adding a non-PostgreSQL datastore for any module requires its own Decision Record, per `ADR-005`.
- Firebase credentials remain scoped to FCM delivery. Re-purposing them to reach any Firebase product other than Cloud Messaging is out of scope for this record.

## Grounding facts (verified against the repository before ratification)

- `PushToken` (`backend/prisma/schema.prisma`) predates this record: `token` `UNIQUE`, `platform`, `app`, `user_id` with `onDelete: Cascade`, `@@index([user_id])`. Migrations `20260724120000_add_push_token` and `20260724220000_add_push_app` are untouched by this decision.
- **No data exists to migrate.** The `PushToken` table held zero rows at ratification, and no device had ever registered a token: the Android build wiring (`expo.android.googleServicesFile`) only landed in PR #527, so no shipped build could obtain an FCM token. The Firestore path was never enabled in any environment.
- `FEATURE_PUSH_TOKEN_STORE_FIRESTORE` defaulted to off (PR #534), so removing it changes no deployment's behaviour.
- APNs delivery is unaffected and was never routed through Firebase: `ApnsProviderClient` talks to Apple directly over HTTP/2 (`ADR-029` §4).

## Compatibility

- **API contract unchanged.** `POST /notifications/push-tokens` keeps its request schema and its response shape, `user_id` included.
- **`ADR-029` unchanged and reaffirmed**, including its Consequences naming a `PushToken` model for PUSH.
- **No migration.** The table, its columns, and its migration history are exactly as `ADR-029` established.
- **Mobile unchanged.** Both apps already register through the authenticated backend endpoint.

## Consequences

- One datastore for the push path; user deletion cleans up device tokens via the existing cascade.
- `firestore.rules` and `firebase.json` are removed with the store they existed for. `.firebaserc` is kept: it names the Firebase project this repository targets, which is still true for FCM.
- The ownership-reassignment invariant is enforced by the `UNIQUE` constraint again, not by application code.
- Code that existed for the Firestore path is deleted rather than left dormant: `backend/src/lib/firebase-admin.ts`, `backend/src/modules/notifications/push-token-store.ts`, and their tests. Recoverable from git history (PRs #526, #534) should this decision ever be revisited.
- `SIR-NOTIF-012` closes as RESOLVED — the divergence is removed, not ratified.
- **Trade-off accepted:** device push tokens are not visible in the Firebase console alongside the rest of the push configuration. Reading them requires a database query. The project owner accepted this in exchange for a single datastore.
