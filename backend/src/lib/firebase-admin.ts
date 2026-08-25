import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from './logger.js';

/**
 * Firebase Admin SDK bootstrap, used only as the credential/handle source for
 * Firestore (the push-token store — see push-token-store.ts).
 *
 * Deliberately NOT used for message delivery: the PUSH transport already
 * speaks FCM HTTP v1 and APNs directly (push-provider.ts, Epic 7 PR 7.5), and
 * `firebase-admin`'s messaging API is a wrapper over the same FCM HTTP v1
 * endpoint. Routing sends through it as well would duplicate a working
 * transport, and would not cover APNs at all (the Admin SDK reaches iOS only
 * via FCM, which this deployment does not use for iOS).
 *
 * Credentials are the same pair the FCM provider client already requires, so
 * a deployment that can send push can also reach Firestore with no new
 * secret: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 (base64-encoded service-account
 * JSON) and FIREBASE_PROJECT_ID.
 *
 * Returns undefined rather than throwing when unconfigured. Firestore is
 * optional infrastructure: local development and the test suite run without
 * any Firebase project, and callers fall back to the Prisma-backed store
 * (resolvePushTokenStore). An unconfigured deployment must degrade, not
 * crash at import time.
 *
 * MIG-GAP-11 carryover, matching push-provider.ts: no key material ever
 * appears in a log line or a thrown error's message. A malformed key is
 * reported by shape ("not valid JSON"), never by content.
 */

const APP_NAME = 'push-token-store';

let cached: Firestore | undefined;
let resolved = false;

export interface FirebaseAdminConfig {
  projectId?: string;
  serviceAccountKeyBase64?: string;
}

function decodeServiceAccount(
  serviceAccountKeyBase64: string
): { projectId: string; clientEmail: string; privateKey: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8'));
  } catch {
    // Message intentionally carries no decoded content.
    logger.error('FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON');
    return undefined;
  }

  const key = parsed as Record<string, unknown>;
  const projectId = key.project_id;
  const clientEmail = key.client_email;
  const privateKey = key.private_key;

  if (
    typeof projectId !== 'string' ||
    typeof clientEmail !== 'string' ||
    typeof privateKey !== 'string'
  ) {
    logger.error(
      'FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is missing one of project_id/client_email/private_key'
    );
    return undefined;
  }

  return { projectId, clientEmail, privateKey };
}

/**
 * The Firestore handle for this process, or undefined when Firebase is not
 * configured (or the service-account key is unusable).
 *
 * Memoized including the negative result: a deployment without Firebase would
 * otherwise re-parse and re-log on every push-token read.
 */
export function getFirestoreClient(config: FirebaseAdminConfig): Firestore | undefined {
  if (resolved) return cached;
  resolved = true;

  const { projectId, serviceAccountKeyBase64 } = config;
  if (!projectId || !serviceAccountKeyBase64) return undefined;

  const serviceAccount = decodeServiceAccount(serviceAccountKeyBase64);
  if (!serviceAccount) return undefined;

  // Named app, never the default: this process may run alongside other
  // Firebase usage, and initializeApp() on an already-initialized default app
  // throws.
  //
  // The whole construction is guarded because cert() validates the private
  // key eagerly and throws on a structurally valid JSON key whose PEM is
  // corrupt or truncated. Unguarded, that would surface as a 500 on push-token
  // registration and — worse — as a crash while building the outbox transport
  // registry at worker boot, taking down email delivery and every scheduled
  // job along with push. Degrading to the Prisma store matches how every
  // other unusable-config path here behaves.
  try {
    let app: App;
    const existing = getApps().find((candidate: { name: string }) => candidate.name === APP_NAME);
    if (existing) {
      app = getApp(APP_NAME);
    } else {
      app = initializeApp(
        {
          credential: cert({
            projectId: serviceAccount.projectId,
            clientEmail: serviceAccount.clientEmail,
            privateKey: serviceAccount.privateKey,
          }),
          projectId,
        },
        APP_NAME
      );
    }

    cached = getFirestore(app);
  } catch (error) {
    // No key material in the log line: the message comes from the SDK, which
    // reports key *shape* problems, and is never concatenated with the key.
    logger.error('Firebase Admin initialization failed — falling back to the PushToken table', {
      error: error instanceof Error ? error.message : String(error),
    });
    cached = undefined;
  }

  return cached;
}

/** Test-only: clears the memoized handle so a test can vary the config. */
export function resetFirestoreClientForTests(): void {
  cached = undefined;
  resolved = false;
}
