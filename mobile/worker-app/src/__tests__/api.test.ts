import {
  api,
  ApiError,
  setAccessToken,
  setRefreshToken,
  setOnTokenRefreshed,
  setOnAuthFailure,
  getAccessToken,
} from '@/lib/api';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

const mockUser = {
  id: 'u1',
  email: 'worker@hotel.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  role: 'worker' as const,
};

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

// Simulates the Nginx/Cloudflare edge's 429 response, whose body is not
// guaranteed to be JSON (ADR-031 D-6) — `.json()` rejects, as it would on
// a plain-text/HTML edge error page.
function nonJsonRes(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken(null);
  setRefreshToken(null);
  setOnTokenRefreshed(async () => {});
  setOnAuthFailure(async () => {});
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('request — happy path', () => {
  it('attaches Authorization header when token is set', async () => {
    setAccessToken('tok-abc');
    mockFetch.mockResolvedValueOnce(res(200, { data: mockUser }));

    await api.auth.me();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-abc');
  });

  it('omits Authorization header when no token', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: mockUser }));

    await api.auth.me();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('returns body.data on success', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: mockUser }));
    const result = await api.auth.me();
    expect(result).toEqual(mockUser);
  });
});

// ---------------------------------------------------------------------------
// 401 → refresh → retry
// ---------------------------------------------------------------------------

describe('401 interceptor', () => {
  it('refreshes token and retries original request on 401', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');

    mockFetch
      // initial request → 401
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      // refresh call → new tokens
      .mockResolvedValueOnce(res(200, { data: { access_token: 'new-access', refresh_token: 'new-refresh' } }))
      // retry → success
      .mockResolvedValueOnce(res(200, { data: mockUser }));

    const result = await api.auth.me();

    expect(result).toEqual(mockUser);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // In-memory token updated
    expect(getAccessToken()).toBe('new-access');
    // Retry used the new token
    const [, retryInit] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe('Bearer new-access');
  });

  it('calls onTokenRefreshed callback after successful refresh', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');
    const onTokenRefreshed = jest.fn().mockResolvedValue(undefined);
    setOnTokenRefreshed(onTokenRefreshed);

    mockFetch
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(res(200, { data: { access_token: 'new-access', refresh_token: 'new-refresh' } }))
      .mockResolvedValueOnce(res(200, { data: mockUser }));

    await api.auth.me();

    expect(onTokenRefreshed).toHaveBeenCalledWith('new-access', 'new-refresh');
  });

  it('serializes concurrent 401s — executeRefresh called exactly once', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');

    mockFetch
      // both initial requests → 401
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      // single refresh call
      .mockResolvedValueOnce(res(200, { data: { access_token: 'new-access', refresh_token: 'new-refresh' } }))
      // both retries succeed
      .mockResolvedValueOnce(res(200, { data: mockUser }))
      .mockResolvedValueOnce(res(200, { data: mockUser }));

    await Promise.all([api.auth.me(), api.auth.me()]);

    const refreshCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      (url as string).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('calls onAuthFailure and throws SESSION_EXPIRED when refresh is rejected', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');
    const onAuthFailure = jest.fn().mockResolvedValue(undefined);
    setOnAuthFailure(onAuthFailure);

    mockFetch
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(res(401, { error: { code: 'REFRESH_FAILED', message: 'invalid refresh' } }));

    await expect(api.auth.me()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'SESSION_EXPIRED',
      status: 401,
    });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('continues session when onTokenRefreshed storage write fails', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');
    setOnTokenRefreshed(async () => { throw new Error('SecureStore failed'); });

    mockFetch
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(res(200, { data: { access_token: 'new-access', refresh_token: 'new-refresh' } }))
      .mockResolvedValueOnce(res(200, { data: mockUser }));

    // Should not throw — storage failure is non-fatal
    const result = await api.auth.me();
    expect(result).toEqual(mockUser);
    expect(getAccessToken()).toBe('new-access');
  });

  it('does not refresh when _refreshToken is null', async () => {
    setAccessToken('old-access');
    // no refresh token set

    mockFetch.mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }));

    await expect(api.auth.me()).rejects.toMatchObject({ status: 401 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ADR-031 C-7: TOKEN_REVOKED must never attempt a refresh
// ---------------------------------------------------------------------------

describe('TOKEN_REVOKED (ADR-031 C-7)', () => {
  it('does not attempt a refresh, calls onAuthFailure, and throws TOKEN_REVOKED', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');
    const onAuthFailure = jest.fn().mockResolvedValue(undefined);
    setOnAuthFailure(onAuthFailure);

    mockFetch.mockResolvedValueOnce(
      res(401, { error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked' } }),
    );

    await expect(api.auth.me()).rejects.toMatchObject({ code: 'TOKEN_REVOKED', status: 401 });
    // No refresh call, no retry — a single fetch only.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('is distinguished from an ordinary UNAUTHORIZED 401, which still refreshes', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');
    const onAuthFailure = jest.fn().mockResolvedValue(undefined);
    setOnAuthFailure(onAuthFailure);

    mockFetch
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      .mockResolvedValueOnce(res(200, { data: { access_token: 'new-access', refresh_token: 'new-refresh' } }))
      .mockResolvedValueOnce(res(200, { data: mockUser }));

    const result = await api.auth.me();

    expect(result).toEqual(mockUser);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('clears credentials if TOKEN_REVOKED arrives on the post-refresh retry itself', async () => {
    setAccessToken('old-access');
    setRefreshToken('old-refresh');
    const onAuthFailure = jest.fn().mockResolvedValue(undefined);
    setOnAuthFailure(onAuthFailure);

    mockFetch
      // initial request -> ordinary expiry
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }))
      // refresh succeeds
      .mockResolvedValueOnce(res(200, { data: { access_token: 'new-access', refresh_token: 'new-refresh' } }))
      // retry itself comes back revoked (race: account revoked mid-refresh)
      .mockResolvedValueOnce(res(401, { error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked' } }));

    await expect(api.auth.me()).rejects.toMatchObject({ code: 'TOKEN_REVOKED', status: 401 });
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ADR-031 D-6/PR-4a: edge-level 429 + Retry-After
// ---------------------------------------------------------------------------

describe('429 rate limiting (ADR-031 D-6)', () => {
  it('surfaces Retry-After as retryAfterSeconds even when the edge body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(nonJsonRes(429, { 'Retry-After': '30' }));

    await expect(api.auth.login('a@b.com', 'pw')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('leaves retryAfterSeconds undefined when the header is absent', async () => {
    mockFetch.mockResolvedValueOnce(res(429, {}));

    await expect(api.auth.login('a@b.com', 'pw')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: undefined,
    });
  });

  it('parses an HTTP-date form of Retry-After (RFC 7231), not just delay-seconds', async () => {
    const futureDate = new Date(Date.now() + 45_000).toUTCString();
    mockFetch.mockResolvedValueOnce(nonJsonRes(429, { 'Retry-After': futureDate }));

    const error = await api.auth.login('a@b.com', 'pw').catch((e) => e);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    // Allow slack for wall-clock rounding between the header and the assertion.
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(43);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(45);
  });
});

// ---------------------------------------------------------------------------
// SKIP_REFRESH_PATHS
// ---------------------------------------------------------------------------

describe('SKIP_REFRESH_PATHS', () => {
  it('does not attempt refresh on 401 from /auth/login', async () => {
    setRefreshToken('some-refresh');
    mockFetch.mockResolvedValueOnce(res(401, { error: { code: 'INVALID_CREDENTIALS', message: 'bad creds' } }));

    await expect(api.auth.login('a@b.com', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not attempt refresh on 401 from /auth/refresh', async () => {
    setRefreshToken('some-refresh');
    mockFetch.mockResolvedValueOnce(res(401, { error: { code: 'REFRESH_FAILED', message: 'bad token' } }));

    await expect(api.auth.refresh('bad-token')).rejects.toMatchObject({ status: 401 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not attempt refresh on 401 from /auth/logout', async () => {
    setRefreshToken('some-refresh');
    mockFetch.mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }));

    await expect(api.auth.logout()).rejects.toMatchObject({ status: 401 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ApiError shape
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('throws ApiError with code, message, status from error body', async () => {
    mockFetch.mockResolvedValueOnce(res(403, { error: { code: 'FORBIDDEN', message: 'Access denied' } }));

    await expect(api.auth.me()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'FORBIDDEN',
      message: 'Access denied',
      status: 403,
    });
  });

  it('falls back to UNKNOWN code when error body is absent', async () => {
    mockFetch.mockResolvedValueOnce(res(500, {}));

    await expect(api.auth.me()).rejects.toMatchObject({
      code: 'UNKNOWN',
      status: 500,
    });
  });

  it('ApiError is instanceof Error', async () => {
    mockFetch.mockResolvedValueOnce(res(404, { error: { code: 'NOT_FOUND', message: 'not found' } }));

    try {
      await api.auth.me();
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ApiError);
    }
  });
});

// ---------------------------------------------------------------------------
// Job Dispatch Phase 2 — broadcasts
// ---------------------------------------------------------------------------

describe('workRequests.getBroadcastEligibility', () => {
  it('fetches eligibility for a broadcast id', async () => {
    const eligibility = {
      job_request_id: 'jr1',
      hotel_id: 'h1',
      shift_date: '2026-08-10',
      slots: [{ skill: 'CLEANER', headcount: 2, confirmed_count: 1, eligible_count: 2, eligible: true }],
    };
    mockFetch.mockResolvedValueOnce(res(200, { data: eligibility }));

    const result = await api.workRequests.getBroadcastEligibility('jr1');

    expect(result).toEqual(eligibility);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/work-requests/broadcasts/jr1/eligibility');
  });
});

describe('workRequests.acceptBroadcast', () => {
  it('returns {status: "accepted", ...} on a successful claim', async () => {
    const result = { status: 'accepted', assignment_id: 'a1', job_request_id: 'jr1', skill: 'CLEANER' };
    mockFetch.mockResolvedValueOnce(res(201, { data: result }));

    const accepted = await api.workRequests.acceptBroadcast('jr1', 'CLEANER');

    expect(accepted).toEqual(result);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/work-requests/broadcasts/jr1/accept');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ skill: 'CLEANER' });
  });

  it('returns {status: "requirement_fulfilled", ...} without throwing on a lost race', async () => {
    const result = { status: 'requirement_fulfilled', job_request_id: 'jr1', skill: 'CLEANER' };
    mockFetch.mockResolvedValueOnce(res(200, { data: result }));

    await expect(api.workRequests.acceptBroadcast('jr1', 'CLEANER')).resolves.toEqual(result);
  });

  it('surfaces a 4xx failure as ApiError', async () => {
    mockFetch.mockResolvedValueOnce(res(409, { error: { code: 'CONFLICT', message: 'Already assigned that day' } }));

    await expect(api.workRequests.acceptBroadcast('jr1', 'CLEANER')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      status: 409,
    });
  });
});

// ---------------------------------------------------------------------------
// Content-Type: FormData bodies must not carry the JSON default
// ---------------------------------------------------------------------------

describe('request — FormData body', () => {
  it('omits Content-Type for a FormData body, letting the runtime set its own boundary', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: { id: 'doc1' } }));

    const form = new FormData();
    form.append('category', 'GENERAL');
    await api.documents.upload('worker1', { uri: 'file:///doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' }, { category: 'GENERAL' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('still defaults Content-Type to application/json for an ordinary JSON body', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: mockUser }));

    await api.auth.login('a@b.com', 'pw');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// documents.upload — picker-asset -> FormData field mapping
// ---------------------------------------------------------------------------

describe('documents.upload', () => {
  it('maps the picker asset (uri/name/mimeType) onto the file part as {uri, name, type}', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: { id: 'doc1' } }));
    const appendSpy = jest.spyOn(FormData.prototype, 'append');

    await api.documents.upload(
      'worker1',
      { uri: 'file:///doc.pdf', name: 'passport.pdf', mimeType: 'application/pdf' },
      { category: 'GENERAL' },
    );

    // The field key that carries the actual file must be named "file" (the
    // backend's multer middleware is `upload.single('file')`), and its value
    // must remap the picker's `mimeType` field to `type` — a documented
    // divergence from expo-document-picker's own asset shape, easy to get
    // silently wrong if either field is ever renamed.
    const fileCall = appendSpy.mock.calls.find(([field]) => field === 'file');
    expect(fileCall).toBeDefined();
    expect(fileCall?.[1]).toMatchObject({
      uri: 'file:///doc.pdf',
      name: 'passport.pdf',
      type: 'application/pdf',
    });

    appendSpy.mockRestore();
  });

  it('falls back to application/octet-stream when the picker returns no mimeType', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: { id: 'doc1' } }));
    const appendSpy = jest.spyOn(FormData.prototype, 'append');

    await api.documents.upload(
      'worker1',
      { uri: 'file:///doc', name: 'doc' },
      { category: 'GENERAL' },
    );

    const fileCall = appendSpy.mock.calls.find(([field]) => field === 'file');
    expect(fileCall?.[1]).toMatchObject({ type: 'application/octet-stream' });

    appendSpy.mockRestore();
  });

  it('sends is_work_permit and expires_at only when provided', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: { id: 'doc1' } }));
    const appendSpy = jest.spyOn(FormData.prototype, 'append');

    await api.documents.upload(
      'worker1',
      { uri: 'file:///doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' },
      { category: 'WORK_PERMIT', is_work_permit: true, expires_at: '2027-01-01' },
    );

    const fields = Object.fromEntries(appendSpy.mock.calls.map(([k, v]) => [k, v]));
    expect(fields['is_work_permit']).toBe('true');
    expect(fields['expires_at']).toBe('2027-01-01');

    appendSpy.mockRestore();
  });

  it('posts to /documents/workers/:worker_id/documents', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: { id: 'doc1' } }));

    await api.documents.upload(
      'worker1',
      { uri: 'file:///doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf' },
      { category: 'GENERAL' },
    );

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/documents/workers/worker1/documents');
    expect(init.method).toBe('POST');
  });
});

describe('workRequests.list — is_broadcast', () => {
  it('serializes is_broadcast as the literal string "true"', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: [] }));

    await api.workRequests.list({ is_broadcast: true });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('is_broadcast=true');
  });

  it('omits is_broadcast from the query when not passed', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: [] }));

    await api.workRequests.list({});

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).not.toContain('is_broadcast');
  });
});

// ---------------------------------------------------------------------------
// SIR-GLOB-022: isFallbackMessage — set by the transport layer, consumed by
// lib/api-error-i18n.ts. These assert the flag against real thrown errors
// rather than hand-built ones, so the throw sites stay honest.
// ---------------------------------------------------------------------------

describe('isFallbackMessage', () => {
  it('flags the 429 message, which the edge never supplies', async () => {
    mockFetch.mockResolvedValueOnce(nonJsonRes(429, { 'Retry-After': '30' }));
    const error = (await api.auth.me().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isFallbackMessage).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('flags a failure where the server sent no message', async () => {
    mockFetch.mockResolvedValueOnce(res(500, { error: { code: 'BOOM' } }));
    const error = (await api.auth.me().catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('Request failed');
    expect(error.isFallbackMessage).toBe(true);
  });

  it('does NOT flag a message the server supplied', async () => {
    // The server localizes its own copy; re-translating would discard detail.
    mockFetch.mockResolvedValueOnce(
      res(409, { error: { code: 'CONFLICT', message: 'Already checked in at 09:03' } }),
    );
    const error = (await api.auth.me().catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('Already checked in at 09:03');
    expect(error.isFallbackMessage).toBe(false);
  });

  it('flags SESSION_EXPIRED, thrown entirely client-side', async () => {
    setAccessToken('a');
    setRefreshToken('r');
    mockFetch
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHORIZED' } }))
      .mockResolvedValueOnce(res(401, { error: { code: 'INVALID_REFRESH' } }));
    const error = (await api.auth.me().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(error.isFallbackMessage).toBe(true);
  });
});
