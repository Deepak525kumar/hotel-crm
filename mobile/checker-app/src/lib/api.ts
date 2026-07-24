import type {
  User,
  AuthResponse,
  AttendanceRecord,
  QualityVerification,
  Rating,
  LeaderboardEntry,
  Notification,
  PushToken,
  PushPlatform,
  PushApp,
} from '@/types/api';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _onTokenRefreshed: ((access: string, refresh: string) => Promise<void>) | null = null;
let _onAuthFailure: (() => Promise<void>) | null = null;
// Shared promise to serialize concurrent refresh attempts
let _refreshPromise: Promise<{ access_token: string; refresh_token: string }> | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function setRefreshToken(token: string | null): void {
  _refreshToken = token;
}

export function setOnTokenRefreshed(cb: (access: string, refresh: string) => Promise<void>): void {
  _onTokenRefreshed = cb;
}

export function setOnAuthFailure(cb: () => Promise<void>): void {
  _onAuthFailure = cb;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Auth endpoints that must never trigger the 401 interceptor (avoids infinite loops)
const SKIP_REFRESH_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

async function executeRefresh(): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: _refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(
      body.error?.code ?? 'REFRESH_FAILED',
      body.error?.message ?? 'Token refresh failed',
      res.status,
    );
  }
  return body.data as { access_token: string; refresh_token: string };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (_accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const body = await res.json();

  if (!res.ok) {
    if (res.status === 401 && !SKIP_REFRESH_PATHS.has(path) && _refreshToken) {
      // Isolate refresh failure from persistence failure (F1).
      // Only a server-rejected refresh is a genuine session expiry.
      let tokens: { access_token: string; refresh_token: string };
      try {
        if (!_refreshPromise) {
          _refreshPromise = executeRefresh().finally(() => {
            _refreshPromise = null;
          });
        }
        tokens = await _refreshPromise;
      } catch {
        // Server rejected the refresh token — genuine session expiry.
        await _onAuthFailure?.();
        throw new ApiError('SESSION_EXPIRED', 'Session expired. Please log in again.', 401);
      }

      // Refresh succeeded — update in-memory tokens before any await.
      _accessToken = tokens.access_token;
      _refreshToken = tokens.refresh_token;

      // Persist to storage. Failure is non-fatal: in-memory tokens are current
      // and the session continues. Do not call onAuthFailure on a storage error.
      try {
        await _onTokenRefreshed?.(tokens.access_token, tokens.refresh_token);
      } catch {
        // Storage write failed; session continues with in-memory tokens.
      }

      // Replay the original request with the new access token.
      const retryHeaders: Record<string, string> = {
        ...headers,
        Authorization: `Bearer ${_accessToken}`,
      };
      const retryRes = await fetch(`${BASE_URL}${path}`, { ...options, headers: retryHeaders });
      const retryBody = await retryRes.json();
      if (!retryRes.ok) {
        throw new ApiError(
          retryBody.error?.code ?? 'UNKNOWN',
          retryBody.error?.message ?? 'Request failed',
          retryRes.status,
        );
      }
      return retryBody.data as T;
    }

    throw new ApiError(
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? 'Request failed',
      res.status,
    );
  }

  return body.data as T;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    refresh: (refresh_token: string) =>
      request<AuthResponse>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token }),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () => request<User>('/auth/me'),
  },

  attendance: {
    list: (params?: {
      is_verified?: boolean;
      status?: string;
      hotel_id?: string;
      page?: number;
      per_page?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.is_verified !== undefined) qs.set('is_verified', String(params.is_verified));
      if (params?.status) qs.set('status', params.status);
      if (params?.hotel_id) qs.set('hotel_id', params.hotel_id);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.per_page) qs.set('per_page', String(params.per_page));
      return request<{ data: AttendanceRecord[]; total: number }>(`/attendance?${qs}`);
    },
    get: (id: string) => request<AttendanceRecord>(`/attendance/${id}`),
    verify: (id: string, notes?: string) =>
      request<AttendanceRecord>(`/attendance/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_verified: true, ...(notes ? { notes } : {}) }),
      }),
  },

  quality: {
    createVerification: (data: {
      assignment_id: string;
      score: number;
      notes?: string;
    }) =>
      request<QualityVerification>('/quality/verifications', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    createRating: (data: {
      assignment_id: string;
      worker_id: string;
      score: number;
      comment?: string;
    }) =>
      request<Rating>('/quality/ratings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    leaderboard: (hotel_id?: string) =>
      request<LeaderboardEntry[]>(
        hotel_id ? `/quality/leaderboard/by-hotel/${hotel_id}` : '/quality/leaderboard'
      ),
  },

  notifications: {
    list: () => request<Notification[]>('/notifications'),
    markAsRead: (id: string) =>
      request<Notification>(`/notifications/${id}/read`, { method: 'POST' }),
    // Epic 7 PR 7.7. Upsert-by-token on the backend, so calling this on every
    // launch is idempotent — and re-registering a token that belonged to a
    // different user reassigns ownership, which is what stops pushes reaching
    // a previous account on a shared device.
    registerPushToken: (input: { token: string; platform: PushPlatform; app: PushApp }) =>
      request<PushToken>('/notifications/push-tokens', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
};
