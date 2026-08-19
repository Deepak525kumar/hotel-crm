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
  CalendarAbsence,
  CalendarAbsenceKind,
  PushApp,
  WorkerDocument,
  DocumentCategory,
  ConsentStatus,
  ConsentNotice,
  ConsentRecord,
  RecordConsentDecisionInput,
  ContractDto,
  PayslipRequestDto,
  CreatePayslipRequestRequest,
} from '@/types/api';
import type { UiLocale } from '@/lib/locales';

// KNOWN GAP -- the user-facing error strings in this module (rate limit,
// session revoked, session expired, token-refresh failure, generic request
// failure) are still English in every locale. They surface verbatim in Alert dialogs via `ApiError.message`.
//
// They are NOT translated because importing '@/lib/i18n' here breaks this
// package's jest suites: the tests run under `testEnvironment: node` and
// react-i18next ships untransformed ESM, so five suites fail to parse. Fixing
// it properly means giving ApiError a stable machine-readable code and
// translating at the display sites -- a change to the error contract that is
// out of scope for an extraction pass. Tracked as SIR-I18N-013.
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
    // SIR-GLOB-022: true when `message` is one of this file's own English
    // literals rather than text the server sent. The transport layer runs
    // outside React and has no `t()`, so it cannot translate at throw time —
    // instead it flags the message as a fallback, and the display layer
    // (lib/api-error-i18n.ts `translateApiError`) substitutes a translated
    // string keyed on `code`. A server-supplied message is already localized
    // server-side and must be shown as-is, so it is never flagged.
    public readonly isFallbackMessage: boolean = false,
    // ADR-031 D-6/PR-4a: seconds to wait, parsed from the edge's
    // (Nginx/Cloudflare) Retry-After header on a 429. undefined when absent
    // or unparseable — the edge is the sole source of rate limiting (no
    // app-layer limiter per TREQ-AUTH-008), so this is passed through only.
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Retry-After (RFC 7231 §7.1.3) is either delay-seconds ("30") or an
 * HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"). Nginx emits delay-seconds
 * today, but the header format is a property of the edge, not this app —
 * an HTTP-date is handled defensively in case the edge/CDN ever changes.
 */
function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('Retry-After');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const deltaSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    return deltaSeconds >= 0 ? deltaSeconds : 0;
  }

  return undefined;
}

// ADR-031 D-6: a 429 is produced by the Nginx/Cloudflare edge, not the
// application (no app-layer rate limiter — TREQ-AUTH-008), so its body is
// not guaranteed to be JSON. Every response-body parse in this file must
// tolerate that rather than throwing on `.json()`.
interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function safeJson(res: Response): Promise<ErrorBody> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// Auth endpoints that must never trigger the 401 interceptor (avoids infinite loops)
const SKIP_REFRESH_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

// ADR-031 D-3/C-7: a 401 carrying this code means the account's
// authorization state changed after the access token was issued (role
// change, deactivation, deletion, password reset, or an admin-initiated
// revoke-all-sessions) — refreshing would either loop or hand back a token
// for a state that no longer holds. Must be treated as an immediate,
// non-refreshable session failure, distinct from ordinary expiry. Mirrors
// the backend's `ERROR_CODES.TOKEN_REVOKED`.
const TOKEN_REVOKED_CODE = 'TOKEN_REVOKED';

async function executeRefresh(): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: _refreshToken }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    if (res.status === 429) {
      throw new ApiError(
        'RATE_LIMITED',
        'Too many requests. Please wait before trying again.',
        429,
        true,
        parseRetryAfter(res),
      );
    }
    throw new ApiError(
      body.error?.code ?? 'REFRESH_FAILED',
      body.error?.message ?? 'Token refresh failed',
      res.status,
      body.error?.message == null,
    );
  }
  const body = await res.json();
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

  if (!res.ok) {
    // ADR-031 D-6/PR-4a: a 429 comes from the edge, not the app (no
    // app-layer limiter — TREQ-AUTH-008); its body may not be JSON, so this
    // is checked before any body parse and carries Retry-After through.
    if (res.status === 429) {
      throw new ApiError(
        'RATE_LIMITED',
        'Too many requests. Please wait before trying again.',
        429,
        true,
        parseRetryAfter(res),
      );
    }

    const body = await safeJson(res);

    if (res.status === 401 && body.error?.code === TOKEN_REVOKED_CODE) {
      // Distinct from ordinary expiry (C-7): never attempt a refresh.
      await _onAuthFailure?.();
      throw new ApiError(
        TOKEN_REVOKED_CODE,
        body.error?.message ?? 'Your session was revoked. Please log in again.',
        401,
        body.error?.message == null,
      );
    }

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
        throw new ApiError('SESSION_EXPIRED', 'Session expired. Please log in again.', 401, true);
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
      if (!retryRes.ok) {
        if (retryRes.status === 429) {
          throw new ApiError(
            'RATE_LIMITED',
            'Too many requests. Please wait before trying again.',
            429,
            true,
            parseRetryAfter(retryRes),
          );
        }
        const retryBody = await safeJson(retryRes);
        // A revocation can land on the post-refresh retry itself (a race
        // between the refresh succeeding and the retry completing) — must
        // clear credentials here too, not just on the first attempt.
        if (retryRes.status === 401 && retryBody.error?.code === TOKEN_REVOKED_CODE) {
          await _onAuthFailure?.();
          throw new ApiError(
            TOKEN_REVOKED_CODE,
            retryBody.error?.message ?? 'Your session was revoked. Please log in again.',
            401,
            retryBody.error?.message == null,
          );
        }
        throw new ApiError(
          retryBody.error?.code ?? 'UNKNOWN',
          retryBody.error?.message ?? 'Request failed',
          retryRes.status,
          retryBody.error?.message == null,
        );
      }
      const retryBody = await retryRes.json();
      return retryBody.data as T;
    }

    throw new ApiError(
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? 'Request failed',
      res.status,
      body.error?.message == null,
    );
  }

  const body = await res.json();
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
    // `preferred_language: null` is meaningful and distinct from omitting the
    // key -- null clears the stored choice and returns the checker to
    // device-locale negotiation. Same contract as the worker app.
    updateProfile: (input: { preferred_language?: UiLocale | null }) =>
      request<User>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
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
    /**
     * CRR §15: the checker uploads a photo WITH the rating.
     *
     * Always multipart, even with no photos, so there is one code path -- the
     * route parses multipart either way. React Native's FormData takes
     * {uri,name,type} rather than a Blob; the runtime streams the file off
     * disk when the request is sent, so images never sit in JS memory.
     */
    createVerification: (
      data: { assignment_id: string; score: number; notes?: string },
      photos: { uri: string; name: string; type: string }[] = []
    ) => {
      const form = new FormData();
      form.append('assignment_id', data.assignment_id);
      form.append('score', String(data.score));
      if (data.notes) form.append('notes', data.notes);
      for (const photo of photos) form.append('photos', photo as unknown as Blob);
      return request<QualityVerification>('/quality/verifications', {
        method: 'POST',
        body: form,
      });
    },
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

  // Self-scoped end to end: the backend resolves the caller from req.auth and
  // no worker_id is ever sent, so these need no role gate and none exists.
  calendar: {
    myAbsences: () => request<CalendarAbsence[]>('/calendar/my-absences'),
    markAbsence: (input: { day: string; kind: CalendarAbsenceKind }) =>
      request<CalendarAbsence>('/calendar/my-absences', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    deleteAbsence: (absenceId: string) =>
      request<void>(`/calendar/absences/${absenceId}`, { method: 'DELETE' }),
  },

  // --- Ported from worker-app (2026-08-18) ---
  // The consent/documents/hr screens in this app called these namespaces,
  // which had never existed here. Invisible until src/app/** entered tsc.
  documents: {
    // SPEC-DOCUMENTS-001@0.1.4 FROZEN (GD-16): worker self-upload/list.
    // worker_id is always the authenticated caller — self-scope is the
    // authorization, enforced server-side (documents/routes.ts
    // scopeWorkerRoute()). Only list/upload are ported here — this worker-app
    // screen has no use for completeness()/get()/export() (all exist on
    // frontend/lib/api.ts's documentsApi); add whichever is needed when a
    // screen actually consumes it, rather than porting the full contract
    // speculatively.
    list: (workerId: string, category?: DocumentCategory) =>
      request<WorkerDocument[]>(
        `/documents/workers/${workerId}/documents${category ? `?category=${category}` : ''}`
      ),
    // Takes the raw picker-asset shape (uri/name/mimeType, as returned by
    // expo-document-picker; `size` deliberately not accepted here — the
    // backend derives file_size_bytes server-side from the parsed file,
    // never a client field, RULE-DOC-09) rather than a pre-built FormData —
    // multipart construction is this module's own concern, not the caller's.
    // RN's FormData file-part contract is {uri, name, type} (note: `type`,
    // not `mimeType` — a documented divergence from the picker's own field
    // name).
    //
    // KNOWN BACKEND LIMITATION (pre-existing, shared with frontend/lib/api.ts's
    // identical documentsApi.upload — not introduced here): multipart form
    // fields arrive as strings while uploadDocumentSchema
    // (documents/validation.ts) expects is_work_permit as a real boolean.
    // Sending is_work_permit=true here likely 422s until the backend schema
    // is fixed (e.g. z.preprocess or z.enum(['true','false']).transform(...)).
    // Not fixed in this PR — backend scope, affects web identically.
    upload: (
      workerId: string,
      asset: { uri: string; name: string; mimeType?: string },
      input: {
        category: DocumentCategory;
        is_work_permit?: boolean;
        expires_at?: string;
      }
    ) => {
      const form = new FormData();
      form.append('file', {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
      } as unknown as Blob);
      form.append('category', input.category);
      form.append('original_filename', asset.name);
      form.append('mime_type', asset.mimeType ?? 'application/octet-stream');
      if (input.is_work_permit !== undefined) {
        form.append('is_work_permit', String(input.is_work_permit));
      }
      if (input.expires_at) form.append('expires_at', input.expires_at);

      return request<WorkerDocument>(`/documents/workers/${workerId}/documents`, {
        method: 'POST',
        body: form,
      });
    },
  },
  consent: {
    // SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015/ADR-037, GD-17): every route is
    // self-scoped — worker_id is always the authenticated caller, enforced
    // server-side, never a client-supplied field.
    // Whether the daily gate is enforced for THIS caller. Separate from
    // getStatus because it answers an operational question (is enforcement
    // on?) rather than a consent one, and so the FEATURE_CONSENT_GATE kill
    // switch reaches this screen and not just the API.
    getGateState: () => request<{ enforced: boolean }>('/consent/gate-state'),

    getStatus: (consentInstance: string) =>
      request<ConsentStatus>(`/consent/status?consent_instance=${encodeURIComponent(consentInstance)}`),

    // Fetches the current notice to present before a decision — does not
    // itself record a decision.
    requestNotice: (consentInstance: string, language?: string) =>
      request<ConsentNotice>('/consent/request', {
        method: 'POST',
        body: JSON.stringify({ consent_instance: consentInstance, ...(language ? { language } : {}) }),
      }),

    recordDecision: (input: RecordConsentDecisionInput) =>
      request<ConsentRecord>('/consent/decisions', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    // Immediately supersedes today's grant — the next status check reads as `absent`.
    withdraw: (consentInstance: string) =>
      request<ConsentRecord>('/consent/withdraw', {
        method: 'POST',
        body: JSON.stringify({ consent_instance: consentInstance }),
      }),
  },
  hr: {
    getContractStatus: (workerId: string) =>
      request<ContractDto | null>(`/hr/workers/${encodeURIComponent(workerId)}/contract-status`),

    listPayroll: () =>
      request<PayslipRequestDto[]>('/hr/payroll'),

    requestPayslip: (input: CreatePayslipRequestRequest) =>
      request<PayslipRequestDto>('/hr/payslip-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
};
