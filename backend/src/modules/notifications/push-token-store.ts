import crypto from 'node:crypto';
import { PushApp, PushPlatform, type PrismaClient } from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreClient } from '../../lib/firebase-admin.js';
import { logger } from '../../lib/logger.js';

/**
 * Device push-token storage, behind one contract so the PUSH transport and
 * the registration endpoint always agree on where tokens live.
 *
 * Two implementations, selected per deployment by resolvePushTokenStore():
 *  - FirestorePushTokenStore, when Firebase is configured. Tokens live at
 *    `users/{userId}/pushTokens/{digest}`, readable from the Firebase console
 *    alongside the rest of the project's push configuration.
 *  - PrismaPushTokenStore, otherwise — the original `PushToken` table. Local
 *    development and the test suite run without a Firebase project, so the
 *    push path must not require one.
 *
 * Both stores are keyed the same way (one document/row per device token), so
 * neither is a superset of the other and a deployment reads from exactly the
 * store it wrote to. There is deliberately no dual-write: two sources of
 * truth for the same token would drift the moment one write failed, and the
 * invalid-token prune (which must remove the token from wherever the
 * transport found it) would have to guess which copy is authoritative.
 *
 * Migration note: a deployment that switches from Prisma to Firestore starts
 * with an empty Firestore collection, so its users re-register on next app
 * launch (registerForPushNotificationsAsync runs on every signed-in start).
 * Until then they receive no push. No data is destroyed — the `PushToken`
 * table is left in place and simply stops being read.
 *
 * One property does NOT carry over: `PushToken.user_id` has
 * `onDelete: Cascade`, so deleting a User removed their device tokens for
 * free. Firestore has no foreign key, so a Firestore deployment keeps a
 * deleted user's tokens until each device is invalidated by its provider.
 * That is currently unreachable — the only `prisma.user.delete` call is the
 * compensating rollback for a user whose employment record failed to create,
 * moments after creation and long before any device could register. Any
 * future hard-delete or GDPR-erasure path must delete
 * `users/{userId}/pushTokens` explicitly; a cascade will not do it.
 */

export interface StoredPushToken {
  /** Stable identity within the store — a Firestore document id, or a `PushToken.id`. */
  id: string;
  token: string;
  platform: PushPlatform;
  app: PushApp;
}

export interface PushTokenStore {
  /**
   * Registers a device token for a user, replacing any prior registration of
   * the same token. A token that moves between users (shared device, account
   * switch) must end up owned by the most recent registrant only — otherwise
   * the previous user's notifications keep reaching the new user's device.
   */
  upsert(
    userId: string,
    token: string,
    platform: PushPlatform,
    app: PushApp
  ): Promise<StoredPushToken>;

  /** Every device registered to this user. Empty when the user has none. */
  listForUser(userId: string): Promise<StoredPushToken[]>;

  /**
   * Removes one device token. Callers treat pruning as best-effort (the
   * transport already catches): the Firestore store is idempotent, but the
   * Prisma store rejects a row that a concurrent request already removed.
   */
  delete(userId: string, id: string): Promise<void>;
}

/**
 * Firestore document id for a device token.
 *
 * A digest rather than the raw token: Firestore document ids may not contain
 * `/`, may not exceed 1500 bytes, and may not be `.`/`..` — none of which a
 * provider guarantees about a device token's alphabet or length. Hashing
 * removes the whole class of "this particular token cannot be stored" bugs,
 * which would otherwise surface only for the unlucky device. The token itself
 * is stored in the document, so nothing is lost.
 */
function documentIdFor(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseEnum<T extends Record<string, string>>(
  enumObject: T,
  value: unknown
): T[keyof T] | undefined {
  return typeof value === 'string' && Object.values(enumObject).includes(value)
    ? (value as T[keyof T])
    : undefined;
}

export class FirestorePushTokenStore implements PushTokenStore {
  constructor(private readonly firestore: Firestore) {}

  private collection(userId: string) {
    return this.firestore.collection('users').doc(userId).collection('pushTokens');
  }

  /**
   * Reverse index, token digest -> current owner, maintained alongside the
   * per-user documents.
   *
   * It exists solely to make re-registration reassign ownership. The Prisma
   * store gets that for free: `PushToken.token` is UNIQUE, so upserting an
   * existing token moves the single row to the new user. Firestore's
   * per-user subcollections have no such cross-user constraint — writing
   * `users/{new}/pushTokens/{id}` leaves `users/{old}/pushTokens/{id}`
   * untouched, and the previous owner's notifications would keep arriving on
   * a device that now belongs to someone else. That is the shared-device and
   * account-switch case, not a hypothetical.
   *
   * A collection-group query on `token` would avoid the second collection,
   * but requires a deployed composite/collection-group index — a silent
   * runtime failure in any project where that index was never created.
   * A document-id lookup needs no index at all.
   *
   * The index only knows about tokens this store wrote. A document placed
   * under `users/{userId}/pushTokens` by anything else (a console edit, a
   * client writing directly) has no owner entry and so would not be
   * reassigned away. firestore.rules denies all client access precisely so
   * this store stays the only writer.
   */
  private ownerRef(id: string) {
    return this.firestore.collection('pushTokenOwners').doc(id);
  }

  async upsert(
    userId: string,
    token: string,
    platform: PushPlatform,
    app: PushApp
  ): Promise<StoredPushToken> {
    const id = documentIdFor(token);
    const tokenRef = this.collection(userId).doc(id);
    const ownerRef = this.ownerRef(id);

    // One transaction, not three writes: a device that switches accounts must
    // never be readable as belonging to both users, not even briefly — that
    // window is exactly when the previous owner's push would leak to the new
    // owner's device. Firestore also retries the transaction on contention,
    // which settles two concurrent registrations of the same token
    // deterministically rather than by write order.
    await this.firestore.runTransaction(async (tx) => {
      // All reads must precede all writes in a Firestore transaction.
      const ownerSnapshot = await tx.get(ownerRef);
      const previousOwner = ownerSnapshot.exists
        ? (ownerSnapshot.data()?.user_id as unknown)
        : undefined;

      if (typeof previousOwner === 'string' && previousOwner && previousOwner !== userId) {
        tx.delete(this.collection(previousOwner).doc(id));
      }

      tx.set(ownerRef, { user_id: userId, updated_at: new Date().toISOString() });
      tx.set(
        tokenRef,
        { token, platform, app, updated_at: new Date().toISOString() },
        // merge: preserves any field a future writer adds without this code
        // having to know about it; the four fields here are always rewritten.
        { merge: true }
      );
    });

    return { id, token, platform, app };
  }

  async listForUser(userId: string): Promise<StoredPushToken[]> {
    const snapshot = await this.collection(userId).get();

    const tokens: StoredPushToken[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const token = data.token;
      const platform = parseEnum(PushPlatform, data.platform);
      const app = parseEnum(PushApp, data.app);

      // A document written by something other than upsert() above (a manual
      // console edit, a future client) can carry any shape at all — Firestore
      // enforces no schema. Skipping is the only safe response: a malformed
      // row must not fail delivery to the user's other, valid devices, and
      // must not be coerced into a wrong platform (which would send an
      // Android token to APNs and get it permanently invalidated).
      if (typeof token !== 'string' || !token || !platform || !app) {
        logger.warn('FirestorePushTokenStore: skipping malformed push-token document', {
          user_id: userId,
          push_token_id: doc.id,
        });
        continue;
      }

      tokens.push({ id: doc.id, token, platform, app });
    }
    return tokens;
  }

  async delete(userId: string, id: string): Promise<void> {
    // Both documents in one atomic batch, so the reverse index cannot outlive
    // the token it points at. Firestore's delete is idempotent, so a document
    // already removed by a concurrent prune is not an error.
    //
    // A stale index entry would in fact be harmless (the subsequent
    // tx.delete in upsert() tolerates a missing document), but leaving one
    // behind per invalidated device makes pushTokenOwners grow without bound.
    const batch = this.firestore.batch();
    batch.delete(this.collection(userId).doc(id));
    batch.delete(this.ownerRef(id));
    await batch.commit();
  }
}

export class PrismaPushTokenStore implements PushTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    userId: string,
    token: string,
    platform: PushPlatform,
    app: PushApp
  ): Promise<StoredPushToken> {
    const row = await this.prisma.pushToken.upsert({
      where: { token },
      update: { user_id: userId, platform, app },
      create: { token, platform, app, user_id: userId },
    });
    return { id: row.id, token: row.token, platform: row.platform, app: row.app };
  }

  async listForUser(userId: string): Promise<StoredPushToken[]> {
    const rows = await this.prisma.pushToken.findMany({ where: { user_id: userId } });
    return rows.map((row) => ({
      id: row.id,
      token: row.token,
      platform: row.platform,
      app: row.app,
    }));
  }

  async delete(_userId: string, id: string): Promise<void> {
    await this.prisma.pushToken.delete({ where: { id } });
  }
}

export interface PushTokenStoreConfig {
  firebaseProjectId?: string;
  firebaseServiceAccountKeyBase64?: string;
}

/**
 * The store this deployment uses. Both the registration endpoint and the PUSH
 * transport call this, so they cannot disagree about where tokens live.
 */
export function resolvePushTokenStore(
  prisma: PrismaClient,
  config: PushTokenStoreConfig
): PushTokenStore {
  const firestore = getFirestoreClient({
    projectId: config.firebaseProjectId,
    serviceAccountKeyBase64: config.firebaseServiceAccountKeyBase64,
  });

  if (!firestore) {
    return new PrismaPushTokenStore(prisma);
  }

  return new FirestorePushTokenStore(firestore);
}
