import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { PushApp, PushPlatform } from '@prisma/client';

/**
 * Firestore-backed device push-token store (push-token-store.ts).
 *
 * Covers the three behaviours the PUSH transport depends on and which no
 * existing test could have caught, because the store did not exist before:
 * the document key is derived (not the raw token), a schemaless document that
 * does not match the expected shape is skipped rather than delivered on, and
 * the deployment falls back to Postgres when Firebase is unconfigured so a
 * developer machine still registers tokens.
 */

// The logger reads LOG_LEVEL at construction; this suite never loads a real
// environment (it exercises the store, not configuration).
jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test', LOG_LEVEL: 'error' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

const mockSet = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDelete = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockGet = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

/** Records the path walked, so the test asserts the real collection layout. */
let walkedPath: string[] = [];

function makeFirestore() {
  const docRef: any = {
    set: mockSet,
    delete: mockDelete,
    collection: (name: string) => {
      walkedPath.push(name);
      return collectionRef;
    },
  };
  const collectionRef: any = {
    doc: (id: string) => {
      walkedPath.push(id);
      return docRef;
    },
    get: mockGet,
  };
  return {
    collection: (name: string) => {
      walkedPath.push(name);
      return collectionRef;
    },
  } as any;
}

import {
  FirestorePushTokenStore,
  PrismaPushTokenStore,
  resolvePushTokenStore,
} from '../modules/notifications/push-token-store.js';
import { resetFirestoreClientForTests } from '../lib/firebase-admin.js';

// sha256('device-token-abc')
const TOKEN = 'device-token-abc';
const EXPECTED_DOC_ID = require('node:crypto')
  .createHash('sha256')
  .update(TOKEN)
  .digest('hex');

describe('FirestorePushTokenStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walkedPath = [];
    mockSet.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  it('writes a token to users/{userId}/pushTokens/{sha256(token)}', async () => {
    const store = new FirestorePushTokenStore(makeFirestore());

    const result = await store.upsert('user1', TOKEN, PushPlatform.IOS, PushApp.WORKER);

    expect(walkedPath).toEqual(['users', 'user1', 'pushTokens', EXPECTED_DOC_ID]);
    expect(result.id).toBe(EXPECTED_DOC_ID);
    const [payload, options] = mockSet.mock.calls[0] as [any, any];
    expect(payload).toMatchObject({ token: TOKEN, platform: 'IOS', app: 'WORKER' });
    expect(options).toEqual({ merge: true });
  });

  it('keys the document by a digest, so a token containing "/" is still storable', async () => {
    // Firestore rejects a document id containing "/". Using the raw token as
    // the id would make such a device permanently unregisterable.
    const store = new FirestorePushTokenStore(makeFirestore());

    await store.upsert('user1', 'aa/bb+cc', PushPlatform.ANDROID, PushApp.CHECKER);

    const docId = walkedPath[3];
    expect(docId).not.toContain('/');
    expect(docId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns every well-formed token for the user', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'doc1', data: () => ({ token: 't1', platform: 'IOS', app: 'WORKER' }) },
        { id: 'doc2', data: () => ({ token: 't2', platform: 'ANDROID', app: 'CHECKER' }) },
      ],
    });
    const store = new FirestorePushTokenStore(makeFirestore());

    const tokens = await store.listForUser('user1');

    expect(tokens).toEqual([
      { id: 'doc1', token: 't1', platform: PushPlatform.IOS, app: PushApp.WORKER },
      { id: 'doc2', token: 't2', platform: PushPlatform.ANDROID, app: PushApp.CHECKER },
    ]);
  });

  it('skips malformed documents instead of failing the whole delivery', async () => {
    // Firestore enforces no schema, so a hand-edited or future-client
    // document can carry any shape. The user's other, valid device must still
    // receive the notification.
    mockGet.mockResolvedValue({
      docs: [
        { id: 'bad-platform', data: () => ({ token: 't1', platform: 'CARRIER_PIGEON', app: 'WORKER' }) },
        { id: 'no-token', data: () => ({ platform: 'IOS', app: 'WORKER' }) },
        { id: 'empty-token', data: () => ({ token: '', platform: 'IOS', app: 'WORKER' }) },
        { id: 'bad-app', data: () => ({ token: 't2', platform: 'IOS', app: 'KIOSK' }) },
        { id: 'good', data: () => ({ token: 't3', platform: 'ANDROID', app: 'CHECKER' }) },
      ],
    });
    const store = new FirestorePushTokenStore(makeFirestore());

    const tokens = await store.listForUser('user1');

    expect(tokens).toEqual([
      { id: 'good', token: 't3', platform: PushPlatform.ANDROID, app: PushApp.CHECKER },
    ]);
  });

  it('deletes by document id under the owning user', async () => {
    const store = new FirestorePushTokenStore(makeFirestore());

    await store.delete('user1', 'doc1');

    expect(walkedPath).toEqual(['users', 'user1', 'pushTokens', 'doc1']);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('resolvePushTokenStore', () => {
  beforeEach(() => {
    resetFirestoreClientForTests();
  });

  it('falls back to the PushToken table when Firebase is not configured', () => {
    const store = resolvePushTokenStore({} as any, {});
    expect(store).toBeInstanceOf(PrismaPushTokenStore);
  });

  it('falls back to the PushToken table when only the project id is set', () => {
    // FCM v1 auth needs the service-account key too; a half-configured
    // deployment must degrade to a working store, not to a broken Firestore
    // client.
    const store = resolvePushTokenStore({} as any, { firebaseProjectId: 'proj' });
    expect(store).toBeInstanceOf(PrismaPushTokenStore);
  });

  it('falls back to the PushToken table when the service-account key is unusable', () => {
    const store = resolvePushTokenStore({} as any, {
      firebaseProjectId: 'proj',
      firebaseServiceAccountKeyBase64: Buffer.from('not json').toString('base64'),
    });
    expect(store).toBeInstanceOf(PrismaPushTokenStore);
  });
});
