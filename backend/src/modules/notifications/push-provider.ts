/**
 * PUSH transport provider clients (Epic 7 PR 7.5, ADR-029 §4).
 *
 * Each client owns everything specific to its provider — protocol, auth
 * flow, request/response payload — behind the one generic
 * `PushProviderClient.send()` contract, mirroring email-provider.ts's
 * abstraction. `PushTransportHandler` (outbox-transport.ts) depends only on
 * that contract; it must never branch on provider or construct a
 * provider-specific request.
 *
 * Unlike EMAIL (PR 7.4, plain HTTPS REST), the two PUSH providers have
 * materially different protocols:
 *  - APNs (iOS): HTTP/2 (native `fetch` does not negotiate HTTP/2 for
 *    outbound requests) + an ES256-signed JWT for auth. Implemented via
 *    Node's built-in `http2`/`crypto` modules — no new dependency.
 *  - FCM (Android), HTTP v1 API (the only current, non-deprecated FCM API):
 *    plain HTTPS, but auth is a short-lived OAuth2 access token obtained by
 *    exchanging a self-signed RS256 JWT (from a Firebase service-account
 *    key) at Google's token endpoint — implemented via `fetch` + `crypto`.
 *
 * MIG-GAP-11 carryover: no key/token material ever appears in a log line or
 * a thrown error's message.
 */

import http2 from 'node:http2';
import crypto from 'node:crypto';

export interface PushSendInput {
  token: string;
  title: string;
  body: string;
  /**
   * APNs only (Epic 7 PR 7.8): the `apns-topic` header, i.e. the bundle ID of
   * the app that minted this device token. Required by ApnsProviderClient and
   * supplied per delivery, because one client serves both mobile apps.
   * FcmProviderClient ignores it — an FCM registration token is
   * self-identifying, so Android has no equivalent per-send constraint.
   */
  topic?: string;
  /**
   * Deep-link/routing data, mirrors Notification.data (job-requests/service.ts
   * and friends already populate this for in-app display; it was never
   * threaded through to the push payload itself until now). Values must be
   * strings — both APNs' custom-payload keys and FCM's `data` field require
   * string values (FCM rejects a non-string value outright; APNs would accept
   * one but the client can't rely on it round-tripping identically across
   * platforms), so PushTransportHandler stringifies every value before
   * calling send(). Omit when there's nothing to route on (a generic
   * notification with no target screen).
   */
  data?: Record<string, string>;
}

/**
 * APNs payload size cap (4KB for a standard alert per Apple's docs,
 * https://developer.apple.com/documentation/usernotifications/
 * generating-a-remote-notification). ApnsProviderClient.send() rejects a
 * payload that exceeds this rather than truncating it or sending malformed
 * JSON. This module never receives arbitrary caller-supplied blobs — `data`
 * is always a handful of short id/type strings (e.g. work_request_id,
 * skill) — so hitting this limit in practice would indicate a caller bug,
 * not a case expected to occur in normal operation.
 */
const APNS_PAYLOAD_SIZE_LIMIT_BYTES = 4096;

export interface PushProviderClient {
  send(input: PushSendInput): Promise<void>;
}

/**
 * Thrown when the provider confirms a device token is permanently invalid
 * (APNs: 410 Gone/"Unregistered" or 400/"BadDeviceToken"; FCM:
 * error.details[].errorCode === "UNREGISTERED"). `PushTransportHandler`
 * catches this specifically to delete the corresponding `PushToken` row —
 * distinct from a transient failure (network error, provider outage),
 * which should retry via the normal outbox backoff instead.
 */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
    Object.setPrototypeOf(this, InvalidTokenError.prototype);
  }
}

/**
 * Thrown when the provider rejects the send because THIS DEPLOYMENT is
 * misconfigured, not because anything about the device or the network is
 * wrong. Today that means the APNs topic: `BadTopic` (the `apns-topic`
 * header is not a bundle ID this auth key's team owns), `TopicDisallowed`,
 * and `DeviceTokenNotForTopic` (the token was minted by a different app than
 * the topic names).
 *
 * Separated from the plain `Error` transient path because retrying cannot
 * possibly help: every attempt re-sends the same wrong header and fails
 * identically until a human edits the environment and redeploys. Treating it
 * as transient is not merely wasteful, it is actively misleading -- it was
 * how a one-character-class config mistake (`com.hotelcrm.checkerapp` in the
 * deployed .env versus the real `com.fhmhotelservices.checkerapp`) produced
 * a 100% iOS push outage across BOTH apps that read, from the outside, as a
 * healthy worker steadily dead-lettering events: the boot log said "APNs
 * configured", each row exhausted its backoff schedule normally, and no
 * single log line named the topic as the cause.
 *
 * `PushTransportHandler` catches this specifically to log at ERROR with the
 * offending topic, and to NOT count it as a transient failure. It also never
 * deletes the PushToken row: the token is perfectly valid and will deliver
 * the moment the topic is corrected. Deleting it would force every device to
 * re-register before push worked again, turning a config fix into a
 * fix-plus-reinstall.
 */
export class PushConfigurationError extends Error {
  constructor(
    message: string,
    /** The rejected `apns-topic`, so the log line names what to fix. */
    readonly topic?: string
  ) {
    super(message);
    this.name = 'PushConfigurationError';
    Object.setPrototypeOf(this, PushConfigurationError.prototype);
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Builds and signs a compact JWT. ES256 requires the raw (r||s) signature encoding, not DER. */
function signJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  alg: 'ES256' | 'RS256',
  extraHeader: Record<string, string> = {}
): string {
  const header = { alg, typ: 'JWT', ...extraHeader };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign(alg === 'ES256' ? 'SHA256' : 'RSA-SHA256');
  signer.update(signingInput);
  const signature =
    alg === 'ES256'
      ? signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
      : signer.sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * APNs provider (token-based HTTP/2 API). `authority` defaults to Apple's
 * production endpoint; overridable so tests can point it at a local
 * plaintext (h2c) server.
 *
 * The topic (bundle ID) is NOT held here — it is supplied per send (Epic 7
 * PR 7.8), because a single instance serves both mobile apps. That works
 * because an APNs auth key is *team*-scoped: the ES256 JWT carries only the
 * team ID (`iss`), never a bundle ID, so one cached JWT is valid for every
 * topic in the team.
 */
export class ApnsProviderClient implements PushProviderClient {
  private cachedJwt: { token: string; issuedAt: number } | null = null;

  constructor(
    private readonly privateKeyBase64: string,
    private readonly keyId: string,
    private readonly teamId: string,
    private readonly authority: string = 'https://api.push.apple.com'
  ) {}

  /** Apple allows a JWT to live up to 1h; refresh well before that to tolerate clock skew. */
  private getJwt(): string {
    const nowSec = Math.floor(Date.now() / 1000);
    if (this.cachedJwt && nowSec - this.cachedJwt.issuedAt < 20 * 60) {
      return this.cachedJwt.token;
    }
    const privateKeyPem = Buffer.from(this.privateKeyBase64, 'base64').toString('utf8');
    const token = signJwt({ iss: this.teamId, iat: nowSec }, privateKeyPem, 'ES256', { kid: this.keyId });
    this.cachedJwt = { token, issuedAt: nowSec };
    return token;
  }

  async send(input: PushSendInput): Promise<void> {
    if (!input.topic) {
      // Programming error, not a delivery failure: PushTransportHandler always
      // resolves a topic before dispatching, and APNs rejects a topic-less send.
      throw new Error('ApnsProviderClient: topic (apns-topic) is required');
    }

    const jwt = this.getJwt();
    let session: http2.ClientHttp2Session | undefined;
    try {
      session = http2.connect(this.authority);
      await new Promise<void>((resolve, reject) => {
        session!.on('error', reject);

        const req = session!.request({
          ':method': 'POST',
          ':path': `/3/device/${input.token}`,
          authorization: `bearer ${jwt}`,
          'apns-topic': input.topic,
          'apns-push-type': 'alert',
          'content-type': 'application/json',
        });

        let status = 0;
        const chunks: Buffer[] = [];
        req.on('response', (headers) => {
          status = Number(headers[':status']);
        });
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          if (status === 200) {
            resolve();
            return;
          }
          const bodyText = Buffer.concat(chunks).toString('utf8');
          let reason = 'Unknown';
          try {
            reason = JSON.parse(bodyText).reason ?? reason;
          } catch {
            // Non-JSON or empty body — keep the default reason.
          }
          if (status === 410 || (status === 400 && reason === 'BadDeviceToken')) {
            reject(new InvalidTokenError(`APNs reported the token invalid: ${status} ${reason}`));
            return;
          }
          // Topic rejections are a deployment-config fault, not a delivery
          // fault -- see PushConfigurationError. `DeviceTokenNotForTopic`
          // sits here rather than with the invalid-token cases above for the
          // same reason: the token is fine, it just belongs to the OTHER
          // app, which means this deployment paired the wrong topic with it.
          if (reason === 'BadTopic' || reason === 'TopicDisallowed' || reason === 'DeviceTokenNotForTopic') {
            reject(
              new PushConfigurationError(
                `APNs rejected the topic: ${status} ${reason}. apns-topic must equal the app's iOS bundle identifier (expo.ios.bundleIdentifier in mobile/<app>/app.json); check APNS_BUNDLE_ID_WORKER / APNS_BUNDLE_ID_CHECKER / APNS_BUNDLE_ID_MANAGER.`,
                input.topic
              )
            );
            return;
          }
          reject(new Error(`APNs send failed: ${status} ${reason}`));
        });
        req.on('error', reject);

        // Custom keys live outside `aps`, at the payload's top level (APNs
        // convention) — never inside `aps` itself, which is reserved for
        // Apple's own alert/sound/badge/etc. keys.
        const payload = JSON.stringify({
          aps: { alert: { title: input.title, body: input.body } },
          ...(input.data ?? {}),
        });
        if (Buffer.byteLength(payload, 'utf8') > APNS_PAYLOAD_SIZE_LIMIT_BYTES) {
          reject(new Error('ApnsProviderClient: payload exceeds the 4KB APNs size limit'));
          return;
        }
        req.end(payload);
      });
    } finally {
      session?.close();
    }
  }
}

/**
 * FCM provider (HTTP v1 API). Plain HTTPS for both the OAuth2 token exchange
 * and the send call — no HTTP/2 requirement, unlike APNs.
 */
export class FcmProviderClient implements PushProviderClient {
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly serviceAccountKeyBase64: string,
    private readonly projectId: string
  ) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > now) {
      return this.cachedAccessToken.token;
    }

    const serviceAccount = JSON.parse(
      Buffer.from(this.serviceAccountKeyBase64, 'base64').toString('utf8')
    ) as { client_email: string; private_key: string };
    const nowSec = Math.floor(now / 1000);
    const assertion = signJwt(
      {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: nowSec,
        exp: nowSec + 3600,
      },
      serviceAccount.private_key,
      'RS256'
    );

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`FCM OAuth2 token exchange failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh 60s before actual expiry so a cached token is never used mid-flight.
    this.cachedAccessToken = { token: data.access_token, expiresAt: now + (data.expires_in - 60) * 1000 };
    return data.access_token;
  }

  async send(input: PushSendInput): Promise<void> {
    // `input.topic` is intentionally unused: FCM registration tokens are
    // self-identifying, so there is no per-app header to set (PR 7.8).
    const accessToken = await this.getAccessToken();
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: { title: input.title, body: input.body },
          // FCM's `data` field: sibling of `notification`, not nested inside
          // it. Every value must already be a string (enforced by
          // PushSendInput's own type + PushTransportHandler's stringify
          // step) — FCM rejects a non-string data value outright.
          ...(input.data ? { data: input.data } : {}),
        },
      }),
    });

    if (res.ok) return;

    const bodyText = await res.text().catch(() => '');
    let errorCode: string | undefined;
    try {
      const parsed = JSON.parse(bodyText);
      errorCode =
        parsed?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode ??
        parsed?.error?.status;
    } catch {
      // Non-JSON or empty body — errorCode stays undefined, falls through to generic Error.
    }

    if (errorCode === 'UNREGISTERED') {
      throw new InvalidTokenError(`FCM reported the token invalid: ${res.status} ${errorCode}`);
    }
    throw new Error(`FCM send failed: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
  }
}
