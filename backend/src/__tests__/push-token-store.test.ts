import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'node:crypto';
import { PushApp, PushPlatform } from '@prisma/client';

/**
 * Firestore-backed device push-token store (push-token-store.ts).
 *
 * The behaviours covered here are the ones the PUSH transport and the
 * registration endpoint depend on and that no pre-existing test could catch,
 * because the store did not exist before. Most important is ownership
 * reassignment: the Prisma store gets it free from `PushToken.token` being
 * UNIQUE, and Firestore's per-user subcollections do not.
 *
 * Uses an in-memory Firestore rather than call-assertions, so each test states
 * the resulting document set — a store that "called delete" but under the
 * wrong path would pass a call-assertion and fail here.
 */

// The logger reads LOG_LEVEL at construction; this suite never loads a real
// environment (it exercises the store, not configuration).
jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test', LOG_LEVEL: 'error' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import {
  FirestorePushTokenStore,
  PrismaPushTokenStore,
  resolvePushTokenStore,
} from '../modules/notifications/push-token-store.js';
import { resetFirestoreClientForTests } from '../lib/firebase-admin.js';

/** Minimal in-memory Firestore: documents keyed by their full path. */
function makeFirestore() {
  const documents = new Map<string, any>();

  const docRef = (path: string): any => ({
    path,
    set: (data: any, options?: { merge?: boolean }) => {
      documents.set(path, options?.merge ? { ...(documents.get(path) ?? {}), ...data } : data);
      return Promise.resolve();
    },
    delete: () => {
      documents.delete(path);
      return Promise.resolve();
    },
    get: () =>
      Promise.resolve({ exists: documents.has(path), data: () => documents.get(path) }),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  });

  const collectionRef = (path: string): any => ({
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    // Direct children only, mirroring Firestore: a subcollection is not part
    // of its parent collection's query results.
    get: () =>
      Promise.resolve({
        docs: [...documents.keys()]
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .map((key) => ({ id: key.slice(path.length + 1), data: () => documents.get(key) })),
      }),
  });

  return {
    documents,
    collection: (name: string) => collectionRef(name),
    runTransaction: async (fn: (tx: any) => Promise<void>) =>
      fn({
        get: (ref: any) => ref.get(),
        set: (ref: any, data: any, options?: any) => ref.set(data, options),
        delete: (ref: any) => ref.delete(),
      }),
    batch: () => {
      const operations: Array<() => Promise<void>> = [];
      return {
        delete: (ref: any) => operations.push(() => ref.delete()),
        commit: async () => {
          for (const operation of operations) await operation();
        },
      };
    },
  } as any;
}

const TOKEN = 'device-token-abc';
const DIGEST = crypto.createHash('sha256').update(TOKEN).digest('hex');

describe('FirestorePushTokenStore', () => {
  let firestore: ReturnType<typeof makeFirestore>;
  let store: FirestorePushTokenStore;

  beforeEach(() => {
    firestore = makeFirestore();
    store = new FirestorePushTokenStore(firestore);
  });

  it('writes a token to users/{userId}/pushTokens/{sha256(token)}', async () => {
    const result = await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    expect(result).toEqual({ id: DIGEST, token: TOKEN, platform: 'IOS', app: 'WORKER' });
    expect(firestore.documents.get(`users/user1/pushTokens/${DIGEST}`)).toMatchObject({
      token: TOKEN,
      platform: 'IOS',
      app: 'WORKER',
    });
  });

  it('keys the document by a digest, so a token containing "/" is still storable', async () => {
    // Firestore rejects a document id containing "/". Using the raw token as
    // the id would make such a device permanently unregisterable.
    const result = await store.upsert('user1', 'aa/bb+cc', PushPlatform.ANDROID, PushApp.CHECKER);

    expect(result.id).toMatch(/^[0-9a-f]{64}$/);
    expect(firestore.documents.has(`users/user1/pushTokens/${result.id}`)).toBe(true);
  });

  // The security property the Prisma store gets from `PushToken.token` being
  // UNIQUE. Without it, a device handed to another employee (or an account
  // switch on a shared tablet) keeps receiving the previous user's
  // notifications indefinitely.
  it('reassigns ownership: re-registering a token under a new user removes the old owner’s copy', async () => {
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    await store.upsert('user2', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    expect(firestore.documents.has(`users/user1/pushTokens/${DIGEST}`)).toBe(false);
    expect(firestore.documents.has(`users/user2/pushTokens/${DIGEST}`)).toBe(true);
    expect(await store.listForUser('user1')).toEqual([]);
    expect(await store.listForUser('user2')).toHaveLength(1);
  });

  it('re-registering under the same user is idempotent and keeps the token', async () => {
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    // A device re-registers on every signed-in app launch; the common path
    // must not delete-then-write its own token.
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    expect(await store.listForUser('user1')).toEqual([
      { id: DIGEST, token: TOKEN, platform: PushPlatform.IOS, app: PushApp.WORKER },
    ]);
  });

  it('updates platform/app in place when a re-registration reports different values', async () => {
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    await store.upsert('user1', TOKEN, PushPlatform.ANDROID, PushApp.CHECKER);

    expect(await store.listForUser('user1')).toEqual([
      { id: DIGEST, token: TOKEN, platform: PushPlatform.ANDROID, app: PushApp.CHECKER },
    ]);
  });

  it('a user keeps their other devices when one of them is reassigned', async () => {
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);
    await store.upsert('user1', 'second-device', PushPlatform.ANDROID, PushApp.WORKER);

    await store.upsert('user2', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    const remaining = await store.listForUser('user1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].token).toBe('second-device');
  });

  it('returns every well-formed token for the user', async () => {
    await store.upsert('user1', 't1', PushPlatform.IOS, PushApp.WORKER);
    await store.upsert('user1', 't2', PushPlatform.ANDROID, PushApp.CHECKER);

    const tokens = await store.listForUser('user1');

    expect(tokens.map((t) => t.token).sort()).toEqual(['t1', 't2']);
    expect(tokens.every((t) => t.id.match(/^[0-9a-f]{64}$/))).toBe(true);
  });

  it('returns an empty list for a user who has never registered a device', async () => {
    expect(await store.listForUser('nobody')).toEqual([]);
  });

  it('skips malformed documents instead of failing the whole delivery', async () => {
    // Firestore enforces no schema, so a hand-edited or future-client document
    // can carry any shape. The user's other, valid device must still receive
    // the notification, and a bad `platform` must never be coerced — sending
    // an Android token to APNs gets it permanently invalidated.
    firestore.documents.set('users/user1/pushTokens/bad-platform', {
      token: 't1', platform: 'CARRIER_PIGEON', app: 'WORKER',
    });
    firestore.documents.set('users/user1/pushTokens/no-token', { platform: 'IOS', app: 'WORKER' });
    firestore.documents.set('users/user1/pushTokens/empty-token', {
      token: '', platform: 'IOS', app: 'WORKER',
    });
    firestore.documents.set('users/user1/pushTokens/bad-app', {
      token: 't2', platform: 'IOS', app: 'KIOSK',
    });
    firestore.documents.set('users/user1/pushTokens/non-string-token', {
      token: 12345, platform: 'IOS', app: 'WORKER',
    });
    firestore.documents.set('users/user1/pushTokens/good', {
      token: 't3', platform: 'ANDROID', app: 'CHECKER',
    });

    const tokens = await store.listForUser('user1');

    expect(tokens).toEqual([
      { id: 'good', token: 't3', platform: PushPlatform.ANDROID, app: PushApp.CHECKER },
    ]);
  });

  it('deletes the token and its owner index entry together', async () => {
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    await store.delete('user1', DIGEST);

    expect(await store.listForUser('user1')).toEqual([]);
    // The reverse index must not outlive the token: one orphaned entry per
    // invalidated device would grow pushTokenOwners without bound.
    expect(firestore.documents.has(`pushTokenOwners/${DIGEST}`)).toBe(false);
  });

  it('delete is idempotent — pruning an already-removed token does not throw', async () => {
    // The transport prunes best-effort and may race a concurrent
    // re-registration or a second failing delivery for the same device.
    await expect(store.delete('user1', DIGEST)).resolves.toBeUndefined();
  });

  it('a token deleted and later registered by a different user does not resurrect the old owner', async () => {
    await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);
    await store.delete('user1', DIGEST);

    await store.upsert('user2', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    expect(await store.listForUser('user1')).toEqual([]);
    expect(await store.listForUser('user2')).toHaveLength(1);
  });
});

describe('resolvePushTokenStore', () => {
  beforeEach(() => {
    resetFirestoreClientForTests();
  });

  it('falls back to the PushToken table when Firebase is not configured', () => {
    expect(resolvePushTokenStore({} as any, {})).toBeInstanceOf(PrismaPushTokenStore);
  });

  it('falls back to the PushToken table when only the project id is set', () => {
    // FCM v1 auth needs the service-account key too; a half-configured
    // deployment must degrade to a working store, not a broken Firestore client.
    expect(
      resolvePushTokenStore({} as any, { firebaseProjectId: 'proj' })
    ).toBeInstanceOf(PrismaPushTokenStore);
  });

  it('falls back to the PushToken table when the service-account key is not JSON', () => {
    expect(
      resolvePushTokenStore({} as any, {
        firebaseProjectId: 'proj',
        firebaseServiceAccountKeyBase64: Buffer.from('not json').toString('base64'),
      })
    ).toBeInstanceOf(PrismaPushTokenStore);
  });

  it('falls back to the PushToken table when the key is JSON but missing required fields', () => {
    expect(
      resolvePushTokenStore({} as any, {
        firebaseProjectId: 'proj',
        firebaseServiceAccountKeyBase64: Buffer.from(
          JSON.stringify({ project_id: 'proj' })
        ).toString('base64'),
      })
    ).toBeInstanceOf(PrismaPushTokenStore);
  });

  it('falls back to the PushToken table when the private key itself is unusable', () => {
    // Structurally complete JSON whose PEM is corrupt: cert() validates the
    // key eagerly and throws. Unguarded this crashed the worker at boot while
    // building the transport registry, taking email and every scheduled job
    // down with push.
    expect(
      resolvePushTokenStore({} as any, {
        firebaseProjectId: 'proj',
        firebaseServiceAccountKeyBase64: Buffer.from(
          JSON.stringify({
            project_id: 'proj',
            client_email: 'svc@proj.iam.gserviceaccount.com',
            private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
          })
        ).toString('base64'),
      })
    ).toBeInstanceOf(PrismaPushTokenStore);
  });
});
