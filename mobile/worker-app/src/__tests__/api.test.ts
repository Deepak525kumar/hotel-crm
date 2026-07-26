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
