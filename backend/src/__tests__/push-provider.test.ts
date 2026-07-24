import { describe, it, expect, jest, afterEach, beforeAll, afterAll } from '@jest/globals';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { ApnsProviderClient, FcmProviderClient, InvalidTokenError } from '../modules/notifications/push-provider.js';

// Epic 7 PR 7.5 (ADR-029 §4). APNs uses Node's raw http2 module (not `fetch`),
// so its happy/error paths are verified against a real local plaintext (h2c)
// HTTP/2 server rather than a mock — the goal is to prove the client speaks
// valid HTTP/2 framing + a real ES256 JWT, not just that it calls some function.
// FCM is plain HTTPS end-to-end, so it's verified via mocked `fetch`, mirroring
// email-provider.test.ts.

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerB64, payloadB64] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')),
  };
}

describe('ApnsProviderClient (Epic 7 PR 7.5, ADR-029 §4)', () => {
  let server: http2.Http2Server;
  let baseUrl: string;
  let lastRequest: { path: string; headers: http2.IncomingHttpHeaders } | null = null;
  let nextResponse: { status: number; body: string } = { status: 200, body: '' };

  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const privateKeyBase64 = Buffer.from(privateKeyPem).toString('base64');

  beforeAll(async () => {
    server = http2.createServer((req, res) => {
      lastRequest = { path: req.url ?? '', headers: req.headers };
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(nextResponse.status);
        res.end(nextResponse.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends a real HTTP/2 request with a valid ES256 JWT and the expected headers/path', async () => {
    nextResponse = { status: 200, body: '' };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await client.send({ token: 'device-token-abc', title: 'Hi', body: 'You have a new shift', topic: 'com.hotelcrm.workerapp' });

    expect(lastRequest).not.toBeNull();
    expect(lastRequest!.path).toBe('/3/device/device-token-abc');
    expect(lastRequest!.headers['apns-topic']).toBe('com.hotelcrm.workerapp');
    expect(lastRequest!.headers['apns-push-type']).toBe('alert');
    const authHeader = lastRequest!.headers.authorization as string;
    expect(authHeader).toMatch(/^bearer /);
    const jwt = authHeader.replace(/^bearer /, '');
    const { header, payload } = decodeJwt(jwt);
    expect(header).toMatchObject({ alg: 'ES256', typ: 'JWT', kid: 'KEY123' });
    expect(payload).toMatchObject({ iss: 'TEAM456' });
    expect(typeof payload.iat).toBe('number');
  });

  it('throws InvalidTokenError on a 410 (Unregistered) response', async () => {
    nextResponse = { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await expect(client.send({ token: 't', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' })).rejects.toThrow(InvalidTokenError);
  });

  it('throws InvalidTokenError on a 400 BadDeviceToken response', async () => {
    nextResponse = { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await expect(client.send({ token: 't', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' })).rejects.toThrow(InvalidTokenError);
  });

  it('throws a plain Error (not InvalidTokenError) on other non-200 responses', async () => {
    nextResponse = { status: 500, body: JSON.stringify({ reason: 'InternalServerError' }) };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await expect(client.send({ token: 't', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' })).rejects.toThrow(/500/);
    await expect(client.send({ token: 't', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' })).rejects.not.toThrow(InvalidTokenError);
  });

  it('never leaks the private key in a thrown error message', async () => {
    nextResponse = { status: 500, body: 'boom' };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await expect(client.send({ token: 't', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' })).rejects.not.toThrow(
      new RegExp(privateKeyBase64)
    );
  });

  it('caches the JWT across sends instead of re-signing every call', async () => {
    nextResponse = { status: 200, body: '' };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await client.send({ token: 't1', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' });
    const firstAuth = lastRequest!.headers.authorization;
    await client.send({ token: 't2', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' });
    const secondAuth = lastRequest!.headers.authorization;

    expect(firstAuth).toBe(secondAuth);
  });

  // Epic 7 PR 7.8: one client, one team-scoped JWT, topic selected per send.

  it('throws when no topic is supplied — a programming error, not a delivery failure', async () => {
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.toThrow(/topic/i);
  });

  it('sends different topics to different requests from the SAME client, reusing one cached JWT', async () => {
    nextResponse = { status: 200, body: '' };
    const client = new ApnsProviderClient(privateKeyBase64, 'KEY123', 'TEAM456', baseUrl);

    await client.send({ token: 'worker-token', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' });
    expect(lastRequest!.headers['apns-topic']).toBe('com.hotelcrm.workerapp');
    const workerAuth = lastRequest!.headers.authorization;

    await client.send({ token: 'checker-token', title: 'Hi', body: 'B', topic: 'com.hotelcrm.checkerapp' });
    expect(lastRequest!.headers['apns-topic']).toBe('com.hotelcrm.checkerapp');
    const checkerAuth = lastRequest!.headers.authorization;

    // Same JWT for both — proves the team-scoped key/cache is unaffected by topic.
    expect(workerAuth).toBe(checkerAuth);
  });
});

describe('FcmProviderClient (Epic 7 PR 7.5, ADR-029 §4)', () => {
  const originalFetch = global.fetch;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const serviceAccount = { client_email: 'svc@hotelcrm-app.iam.gserviceaccount.com', private_key: privateKeyPem };
  const serviceAccountKeyBase64 = Buffer.from(JSON.stringify(serviceAccount)).toString('base64');

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; statusText?: string; json?: unknown; text?: string }>) {
    let call = 0;
    const fn = jest.fn(async () => {
      const r = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        statusText: r.statusText ?? (r.ok ? 'OK' : 'Internal Server Error'),
        json: async () => r.json ?? {},
        text: async () => r.text ?? JSON.stringify(r.json ?? {}),
      };
    }) as unknown as typeof fetch;
    global.fetch = fn;
    return fn;
  }

  it('exchanges a self-signed RS256 JWT for an OAuth2 access token, then sends via HTTP v1', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'access-token-xyz', expires_in: 3600 } },
      { ok: true, json: {} },
    ]);
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await client.send({ token: 'device-token-abc', title: 'Hi', body: 'You have a new shift' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = (fetchMock as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const tokenBody = new URLSearchParams(tokenInit.body as string);
    expect(tokenBody.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { header, payload } = decodeJwt(tokenBody.get('assertion')!);
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: 'svc@hotelcrm-app.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const [sendUrl, sendInit] = (fetchMock as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe('https://fcm.googleapis.com/v1/projects/hotelcrm-app/messages:send');
    expect((sendInit.headers as Record<string, string>).Authorization).toBe('Bearer access-token-xyz');
    const sendBody = JSON.parse(sendInit.body as string);
    expect(sendBody.message).toEqual({
      token: 'device-token-abc',
      notification: { title: 'Hi', body: 'You have a new shift' },
    });
  });

  // Epic 7 PR 7.8: FCM has no apns-topic equivalent — a registration token is
  // already scoped to its originating app, so a supplied topic is a no-op.
  it('ignores a supplied topic (Android has no per-app header, unlike APNs)', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'access-token-xyz', expires_in: 3600 } },
      { ok: true, json: {} },
    ]);
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await client.send({ token: 'device-token-abc', title: 'Hi', body: 'B', topic: 'com.hotelcrm.workerapp' });

    const [, sendInit] = (fetchMock as jest.Mock).mock.calls[1] as [string, RequestInit];
    const sendBody = JSON.parse(sendInit.body as string);
    expect(sendBody).not.toHaveProperty('topic');
    expect(JSON.stringify(sendBody)).not.toContain('com.hotelcrm.workerapp');
  });

  it('caches the access token across sends instead of re-exchanging every call', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'access-token-xyz', expires_in: 3600 } },
      { ok: true, json: {} },
      { ok: true, json: {} },
    ]);
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await client.send({ token: 't1', title: 'Hi', body: 'B' });
    await client.send({ token: 't2', title: 'Hi', body: 'B' });

    // One token exchange + two sends, not two token exchanges + two sends.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws InvalidTokenError when FCM reports UNREGISTERED', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'access-token-xyz', expires_in: 3600 } },
      {
        ok: false,
        status: 404,
        json: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
      },
    ]);
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.toThrow(InvalidTokenError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a plain Error (not InvalidTokenError) on other FCM error responses', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { access_token: 'access-token-xyz', expires_in: 3600 } },
      { ok: false, status: 500, statusText: 'Internal Server Error', json: { error: { status: 'INTERNAL' } } },
    ]);
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.toThrow(/500/);
    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.not.toThrow(InvalidTokenError);
    // Token exchange happens once; the cached access token is reused for both sends.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws when the OAuth2 token exchange itself fails, without leaking the service-account key', async () => {
    mockFetchSequence([{ ok: false, status: 401, statusText: 'Unauthorized' }]);
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.toThrow(/401/);
    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.not.toThrow(
      new RegExp(serviceAccountKeyBase64)
    );
  });

  it('propagates a network-level fetch rejection', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = new FcmProviderClient(serviceAccountKeyBase64, 'hotelcrm-app');

    await expect(client.send({ token: 't', title: 'Hi', body: 'B' })).rejects.toThrow('ECONNREFUSED');
  });
});
