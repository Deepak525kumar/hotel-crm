import type { UiLocale } from './locales';
import type {
  ReworkRoundPhotos,
  EmploymentRecordDto,
  QualityCheck,
  User,
  AuthResponse,
  WorkRequest,
  WorkerAssignment,
  Attendance,
  Notification,
  LeaderboardEntry,
  AnalyticsLeaderboardEntry,
  CalendarEntry,
  DailyShiftSummary,
  DashboardStats,
  HotelGroup,
  WorkerAvailability,
  Hotel,
  HotelSummary,
  WorkerStats,
  CalendarAbsence,
  CalendarAbsenceKind,
  GeoCheckin,
  PushToken,
  PushPlatform,
  PushApp,
  SkillTag,
  BroadcastEligibility,
  AcceptBroadcastResult,
  RoomLog,
  WorkerDocument,
  DocumentCategory,
  DocumentCompleteness,
  ConsentStatus,
  ConsentNotice,
  ConsentRecord,
  RecordConsentDecisionInput,
  ContractDto,
  PayslipRequestDto,
  CreatePayslipRequestRequest,
  ChatbotCommandDto,
  ChatbotConversationDto,
  ChatbotConversationSummaryDto,
  ChatbotTranscriptDto,
  ChatbotTurnDto,
  GeneratedReportDto,
} from '../types/api';

// KNOWN GAP -- the user-facing error strings in this module (rate limit,
// session revoked, session expired, token-refresh failure, generic request
// failure) are still English in every locale. They surface verbatim in Alert dialogs via `ApiError.message`.
//
// They are NOT translated because importing './i18n' here breaks this
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
/**
 * Fired whenever the API refuses a call with CONSENT_REQUIRED.
 *
 * The server revokes consent immediately, but the client used to find out only
 * on a fresh mount: ConsentGate read /consent/status once in a useEffect, so a
 * worker whose consent was withdrawn (from the web, by an admin, or on another
 * device) kept a fully usable UI until the app was force-quit. Every gated
 * request was already 403-ing underneath. This turns that 403 into the signal
 * that re-runs the gate.
 */
let _onConsentRequired: (() => void) | null = null;
// Shared promise to serialize concurrent refresh attempts
let _refreshPromise: Promise<{ access_token: string; refresh_token: string }> | null = null;

export interface BlocklistEntryDto {
  id: string;
  hotel_id: string;
  employment_record_id: string;
  /** The human-facing id ("EMP-W-001") the write path is keyed by. */
  employee_id: string | null;
  user_id: string | null;
  worker_name: string | null;
  reason: string | null;
  created_by_id: string;
  created_at: string;
}

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

export function setOnConsentRequired(cb: (() => void) | null): void {
  _onConsentRequired = cb;
}

/** The server's error code for a call refused by the daily consent gate. */
export const CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED';

/**
 * Notifies the consent gate, without altering control flow: the caller still
 * gets its ApiError, so per-screen error handling is unchanged.
 */
function notifyIfConsentRequired(code: string | undefined): void {
  if (code === CONSENT_REQUIRED_CODE) _onConsentRequired?.();
}

export function getAccessToken(): string | null {
  return _accessToken;
}

/**
 * Stable, user-id-keyed URL for `GET /users/:id/photo` (backend
 * users/routes.ts) -- never a presigned one, which is what lets
 * `expo-image`'s disk cache key on this exact string instead of re-fetching
 * the photo on every screen that shows it. Bearer auth (this app has no
 * cookie transport) is supplied by the caller via `source={{ uri, headers }}`
 * -- see components/UserAvatar.tsx.
 */
export function getUserPhotoUrl(userId: string): string {
  return `${BASE_URL}/users/${userId}/photo`;
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
    // ADR-031 D-6/PR-4a: seconds to wait, parsed from the Retry-After
    // header on a 429. undefined when absent or unparseable. Originally the
    // edge (Nginx/Cloudflare) was the sole source of a 429 (no app-layer
    // limiter, TREQ-AUTH-008); ADR-070 (2026-08-21) narrowed that for
    // /auth/login only, which now also sets its own Retry-After on an
    // app-layer per-account throttle — parsed identically here either way.
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

// ADR-031 D-6: a 429 from the Nginx/Cloudflare edge is not guaranteed to be
// JSON. Every response-body parse in this file must tolerate that rather
// than throwing on `.json()`. /auth/login's own app-layer 429 (ADR-070)
// does return real JSON, but every 429 is handled identically below rather
// than special-cased — see the `request()` 429 branch.
interface ErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Appends a file to a FormData object in a way that is compatible with React Native's
 * legacy `fetch` and Expo's WinterCG `fetch`.
 */
function appendNativeFile(form: FormData, field: string, asset: { uri: string; name: string; type?: string; file?: unknown }) {
  if (typeof Blob !== 'undefined' && asset.file instanceof Blob) {
    // Web: a real File/Blob, which FormData encodes directly.
    form.append(field, asset.file, asset.name);
  } else {
    let FileCtor: (new (uri: string) => unknown) | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      FileCtor = (require('expo-file-system') as { File: new (uri: string) => unknown }).File;
    } catch {
      FileCtor = undefined;
    }
    if (!FileCtor) {
      throw new ApiError(
        'NATIVE_MODULE_MISSING',
        'This app build is missing a required component (expo-file-system). Please update or reinstall the app.',
        0,
        true,
      );
    }
    form.append(field, new FileCtor(asset.uri) as unknown as Blob, asset.name);
  }
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

// Duck-typed rather than `instanceof FormData` — RN's FormData polyfill has
// historically diverged from the global under some bundler/engine
// configurations, so an identity check is a safer signal than a class check
// here (same reasoning React Native's own codebase applies to this type).
function isFormDataLike(value: unknown): value is FormData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { append?: unknown }).append === 'function'
  );
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    // A FormData body must NOT carry an explicit Content-Type — the runtime
    // sets its own `multipart/form-data; boundary=...`. Every existing call
    // site sends a JSON body, so this default is unchanged for them.
    ...(isFormDataLike(options?.body) ? {} : { 'Content-Type': 'application/json' }),
    ...(options?.headers as Record<string, string>),
  };

  if (_accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    // ADR-031 D-6/PR-4a: a 429 may not carry a JSON body (the edge's
    // doesn't; ADR-070's own app-layer /auth/login throttle does, but is
    // handled the same way here rather than special-cased), so this is
    // checked before any body parse and carries Retry-After through.
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
        notifyIfConsentRequired(retryBody.error?.code);
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

    notifyIfConsentRequired(body.error?.code);
    throw new ApiError(
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? 'Request failed',
      res.status,
      body.error?.message == null,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json();
  return body.data as T;
}

export const api = {
  /**
   * The caller's own data as a spreadsheet -- the GDPR Article 15/20 right of
   * access and portability, available to every role.
   *
   * Returns a SHORT-LIVED presigned link rather than bytes. A phone should not
   * hold a year of somebody's history in memory, and handing the OS a URL lets
   * the platform's own download and share sheet do the work.
   *
   * `url` is null when file storage is unconfigured server-side. That is a
   * real state and callers must render it as such, never as a dead link.
   */
  reports: {
    /**
     * The team report, as a file.
     *
     * Export only, no on-screen table (owner decision, 2026-09-22): a phone
     * is a poor place to read a report and a good place to send one. The
     * response is a download the caller shares or opens elsewhere.
     */
    exportTeam: (input: { dataset: string; from?: string; to?: string }) =>
      request<GeneratedReportDto>('/reports/export', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    exportMine: (range?: { from: string; to: string }) =>
      request<GeneratedReportDto>('/reports/export/mine', {
        method: 'POST',
        body: JSON.stringify(range ?? {}),
      }),
  },

  /**
   * Chatbot. Every route 404s while FEATURE_CHATBOT is off, which is its
   * state in production — `isAvailable()` exists so the app can decide
   * whether to offer the assistant at all rather than surfacing a failed
   * request to a worker who never asked for one.
   */
  chatbot: {
    /**
     * Deliberately swallows the error: a 404 means the flag is off and a 403
     * means this user may not use it, and in both cases the right UI is no
     * assistant. Distinguishing them would leak that an unreleased feature
     * exists.
     */
    isAvailable: async (): Promise<boolean> => {
      try {
        await request<ChatbotCommandDto[]>('/chatbot/commands');
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Availability AND the chips, in one request.
     *
     * `isAvailable()` above fetches /chatbot/commands, throws the response
     * away, and returns a boolean -- so the store then fetched the SAME
     * endpoint a second time, sequentially, to get the chips. Two round
     * trips for one answer, before the person has typed anything.
     *
     * On a phone on mobile data that is a visible wait, which is how it was
     * reported (2026-09-12: the assistant "takes a little more time" on the
     * apps than on the web). The request was always redundant; only the
     * network made it matter.
     *
     * `null` means no assistant -- a 404 (flag off) and a 403 (not for this
     * user) collapse deliberately, as in `isAvailable()`: the right UI is the
     * same for both, and telling them apart leaks whether an unreleased
     * feature exists.
     */
    probeCommands: async (): Promise<ChatbotCommandDto[] | null> => {
      try {
        return await request<ChatbotCommandDto[]>('/chatbot/commands');
      } catch {
        return null;
      }
    },

    commands: () => request<ChatbotCommandDto[]>('/chatbot/commands'),

    startConversation: () =>
      request<ChatbotConversationDto>('/chatbot/conversations', {
        method: 'POST',
        body: JSON.stringify({}),
      }),

    /** The caller's OWN conversations from the last 30 days, newest first. */
    listConversations: () => request<ChatbotConversationSummaryDto[]>('/chatbot/conversations'),

    /** One of the caller's own conversations, both sides, for reading back. */
    getTranscript: (conversationId: string) =>
      request<ChatbotTranscriptDto>(`/chatbot/conversations/${conversationId}/messages`),

    /**
     * Exactly ONE of text, commandId or confirmToken. The backend rejects any
     * other combination, and a confirmation carries no text precisely so
     * there is nothing to alter between what was approved and what runs.
     */
    sendMessage: (
      conversationId: string,
      input: { text?: string; commandId?: string; confirmToken?: string },
    ) =>
      request<ChatbotTurnDto>(`/chatbot/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.commandId !== undefined ? { command_id: input.commandId } : {}),
          ...(input.confirmToken !== undefined ? { confirm_token: input.confirmToken } : {}),
        }),
      }),
  },

  auth: {
    // Anti-enumeration by design: the server answers 200 whether or not the
    // address exists, so callers must not infer anything from success.
    requestPasswordReset: (email: string) =>
      request<{ message: string }>('/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      }),
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
    // PUT /auth/profile — the self-service profile route, reachable by any
    // authenticated user. Used here for the language preference: workers
    // cannot call PUT /users/:id, which is gated to admin/manager/RM.
    //
    // `preferred_language: null` is meaningful and distinct from omitting
    // the key — null clears the stored choice and returns the worker to
    // device-locale negotiation.
    updateProfile: (input: { preferred_language?: UiLocale | null }) =>
      request<User>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
  },
  workRequests: {
    /**
     * `per_page`, NOT `limit` (2026-09-23). ListWorkRequestsQuerySchema names
     * the page size `per_page`; zod dropped the unknown `limit` key without
     * complaint, so every caller silently got the default page size and a
     * "show me 50" control did nothing at all.
     */
    list: (params?: { status?: string; page?: number; per_page?: number; is_broadcast?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.per_page) qs.set('per_page', String(params.per_page));
      // The backend accepts only the literal strings "true"/"false".
      if (params?.is_broadcast !== undefined) qs.set('is_broadcast', params.is_broadcast ? 'true' : 'false');
      const q = qs.toString();
      return request<WorkRequest[]>(`/work-requests${q ? `?${q}` : ''}`);
    },
    get: (id: string) => request<WorkRequest>(`/work-requests/${id}`),
    // Job Dispatch Phase 2: per-skill-slot eligibility for one broadcast.
    // No requireRole gate backend-side, but the response is role-scoped
    // server-side — a worker/checker caller only ever receives their own
    // `eligible` inclusion per slot, never another worker's id.
    getBroadcastEligibility: (id: string) =>
      request<BroadcastEligibility>(`/work-requests/broadcasts/${id}/eligibility`),
    // Worker accepts one skill slot on a broadcast. First-accept wins; a
    // lost race returns {status: 'requirement_fulfilled'}, not an error.
    // `skill: null` (2026-08-26) claims the "no specific skill required"
    // slot, if the broadcast has one.
    acceptBroadcast: (id: string, skill: SkillTag | null) =>
      request<AcceptBroadcastResult>(`/work-requests/broadcasts/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ skill }),
      }),

    /**
     * Raise a work request.
     *
     * `status` defaults to DRAFT server-side, so publishing on creation means
     * sending 'OPEN' explicitly -- the two-step (save draft, then publish) is
     * the default, not the exception.
     */
    create: (input: {
      hotel_id: string;
      target_role: 'WORKER' | 'CHECKER';
      position: string;
      workers_needed: number;
      shift_date: string;
      shift_start_time: string;
      shift_end_time: string;
      hourly_rate?: number;
      currency?: string;
      description?: string;
      requirements?: string;
      status?: 'DRAFT' | 'OPEN';
    }) =>
      request<WorkRequest>('/work-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /**
     * Raise a broadcast: one shift, several skill x headcount lines.
     *
     * `skills` must hold at least one line, and `skill: null` is the
     * "no specific skill required" slot rather than a missing value -- the
     * schema makes it nullable on purpose, so sending nothing is a different
     * (and invalid) request from sending null.
     */
    createBroadcast: (input: {
      hotel_id: string;
      target_role: 'WORKER' | 'CHECKER';
      shift_date: string;
      shift_start_time: string;
      shift_end_time: string;
      hourly_rate?: number;
      currency?: string;
      description?: string;
      skills: { skill: string | null; headcount: number }[];
    }) =>
      request<WorkRequest>('/work-requests/broadcasts', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /**
     * Manager writes (2026-09-22). `PATCH /work-requests/:id` carries both
     * publish and cancel -- there is no separate route for either, so the
     * caller sends the status it wants.
     */
    update: (id: string, input: Record<string, unknown>) =>
      request<WorkRequest>(`/work-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    /**
     * Close a broadcast early. Gated by FEATURE_JOBDISPATCH_PHASE2, and 404s
     * rather than 403s when it is off.
     */
    closeBroadcast: (id: string) =>
      request<WorkRequest>(`/work-requests/broadcasts/${id}/close`, { method: 'POST' }),
  },
  assignments: {
    list: (params?: { page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<WorkerAssignment[]>(`/assignments${q ? `?${q}` : ''}`);
    },
    get: (id: string) => request<WorkerAssignment>(`/assignments/${id}`),
    /**
     * `cancellation_reason` is accepted by UpdateAssignmentSchema and stored
     * on the row. The manager app asked for a reason, made it MANDATORY in
     * the dialog, and then dropped it on the floor with `void reason`
     * (2026-09-23) -- so every cancelled shift in production carries a null
     * reason that someone typed.
     */
    updateStatus: (id: string, status: string, cancellationReason?: string) =>
      request<WorkerAssignment>(`/assignments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          ...(cancellationReason ? { cancellation_reason: cancellationReason } : {}),
        }),
      }),

    /**
     * Placements over a day range.
     *
     * `from` and `to` go together or not at all -- the backend refuses a lone
     * one, because it would silently produce a query unbounded on one side.
     *
     * FEATURE_JOBDISPATCH_PHASE2 gates this. With the flag off it 404s rather
     * than 403ing, so callers must treat "not found" as "unavailable".
     */
    calendarEntries: (params: { from: string; to: string; hotelId?: string }) => {
      const qs = new URLSearchParams({ from: params.from, to: params.to, per_page: '100' });
      if (params.hotelId) qs.set('hotel_id', params.hotelId);
      return request<CalendarEntry[]>(`/assignments/calendar-entries?${qs.toString()}`);
    },

    createCalendarEntry: (input: { worker_id: string; hotel_id: string; day: string }) =>
      request<CalendarEntry>('/assignments/calendar-entries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /**
     * Day-only move, by product decision (2026-08-05): the hotel and worker on
     * a placement never change here. Moving someone to a DIFFERENT HOTEL means
     * cancelling and re-placing -- which is why the agenda's drag targets are
     * days and never hotel sections.
     */
    /**
     * The manager's assignment list. `per_page`, not `limit` -- the backend
     * schema names it that, and `limit` is silently ignored (a default page
     * of 20 that looks like "there are only 20").
     */
    listFiltered: (params: {
      page?: number;
      perPage?: number;
      status?: string;
      q?: string;
      hotelId?: string;
    }) => {
      const qs = new URLSearchParams();
      qs.set('page', String(params.page ?? 1));
      qs.set('per_page', String(params.perPage ?? 20));
      if (params.status) qs.set('status', params.status);
      if (params.q) qs.set('q', params.q);
      if (params.hotelId) qs.set('hotel_id', params.hotelId);
      return request<WorkerAssignment[]>(`/assignments?${qs.toString()}`);
    },

    reassign: (id: string, workerId: string) =>
      request<WorkerAssignment>(`/assignments/${id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ worker_id: workerId }),
      }),

    /**
     * The aggregate count a manager enters, NOT a room-level log. Workers own
     * the per-room record and those routes are `requireRole('worker')`.
     */
    logRoomsCompleted: (id: string, input: { rooms_completed: number; notes?: string }) =>
      request<void>(`/assignments/${id}/rooms-completed`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    moveCalendarEntry: (id: string, day: string) =>
      request<CalendarEntry>(`/assignments/calendar-entries/${id}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ day }),
      }),
  },
  attendance: {
    // GD-14: when coordinates are available they're sent with the check-in
    // itself so backend-attendance can run its geofence verification
    // (IF-GEO-DISTANCE-CHECK via backend-geo) as part of the same request —
    // coordinates are optional here only because location permission/signal
    // can fail on-device, not because Attendance treats them as informational.
    checkIn: (assignmentId: string, location?: { latitude: number; longitude: number }) =>
      request<Attendance>('/attendance', {
        method: 'POST',
        body: JSON.stringify({ assignment_id: assignmentId, ...location }),
      }),
    checkOut: (attendanceId: string, location?: { latitude: number; longitude: number }) =>
      request<Attendance>(`/attendance/${attendanceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ check_out_at: new Date().toISOString(), ...location }),
      }),
    get: (id: string) => request<Attendance>(`/attendance/${id}`),
    // GET /attendance is scoped by req.auth server-side, so a worker receives
    // only their own records -- no worker_id is sent from the client.
    listMine: (params?: { page?: number; per_page?: number }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.per_page) qs.set('per_page', String(params.per_page));
      const q = qs.toString();
      return request<Attendance[]>(`/attendance${q ? `?${q}` : ''}`);
    },
    // Resolve the attendance record for an assignment dynamically. The backend
    // does not embed attendance on AssignmentDto, so the shift screen looks it
    // up by assignment_id to obtain the id needed for check-out.
    /**
     * The team's attendance. Scope is the server's: a manager sees their
     * hotel's rows, an RM their group's.
     */
    listTeam: (params: { from?: string; to?: string; status?: string; hotelId?: string }) => {
      const qs = new URLSearchParams();
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      if (params.status) qs.set('status', params.status);
      if (params.hotelId) qs.set('hotel_id', params.hotelId);
      const q = qs.toString();
      return request<Attendance[]>(`/attendance${q ? `?${q}` : ''}`);
    },

    /**
     * Manager verification and timesheet correction.
     *
     * `PATCH /attendance/:id` has NO route-level role gate -- authorization is
     * entirely service-layer, so this client is a new caller of a route whose
     * only guard is downstream. It never invents `verified_by`: the server
     * derives the actor from the token.
     *
     * At least one field is required (the schema refuses an empty body), and
     * latitude/longitude must be sent together or not at all.
     */
    updateRecord: (
      id: string,
      input: {
        status?: 'PRESENT' | 'ABSENT' | 'LATE' | 'PARTIAL' | 'EXCUSED';
        is_verified?: boolean;
        check_in_at?: string;
        check_out_at?: string;
        minutes_late?: number;
        minutes_worked?: number;
        notes?: string;
      }
    ) =>
      request<Attendance>(`/attendance/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    listByAssignment: (assignmentId: string) =>
      request<Attendance[]>(`/attendance?assignment_id=${encodeURIComponent(assignmentId)}`),
  },

  notifications: {
    list: () => request<Notification[]>('/notifications'),
    markRead: (notificationId: string) =>
      request<Notification>(`/notifications/${notificationId}/read`, { method: 'POST' }),
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
  users: {
    /**
     * Scoped server-side: a manager receives their hotel's users, an RM their
     * group's. `limit`, not `per_page` -- this endpoint's schema names it
     * differently from the assignments one, and the wrong name is silently
     * ignored rather than rejected.
     */
    list: (params?: { page?: number; limit?: number; role?: string; is_active?: boolean }) => {
      const qs = new URLSearchParams();
      qs.set('page', String(params?.page ?? 1));
      qs.set('limit', String(params?.limit ?? 50));
      if (params?.role) qs.set('role', params.role);
      if (params?.is_active !== undefined) qs.set('is_active', String(params.is_active));
      return request<User[]>(`/users?${qs.toString()}`);
    },
    get: (id: string) => request<User>(`/users/${id}`),

    /**
     * Create an account. MULTIPART: the route runs `uploadPhoto.single('photo')`,
     * so the body is FormData and a JSON body would be rejected.
     *
     * The request helper duck-types FormData and omits Content-Type so the
     * runtime can set its own multipart boundary — which is precisely why
     * this package took worker-app's `request()` and not checker-app's, which
     * hardcodes application/json (see MIGRATION.md).
     *
     * `skills` is a COMMA-SEPARATED STRING, not an array: the schema
     * preprocesses a string into a list, because multipart cannot carry one.
     *
     * Which roles the caller may create is RULE A, enforced server-side by
     * `canCreateRole`. The client mirrors it only to avoid offering a choice
     * that will be refused; it is never the gate.
     */
    create: (input: {
      email: string;
      password: string;
      first_name: string;
      last_name: string;
      phone: string;
      role: string;
      hotel_id?: string;
      hotel_group_id?: string;
      skills?: string;
      photo?: { uri: string; name: string; type: string };
    }) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined || key === 'photo') continue;
        form.append(key, String(value));
      }
      if (input.photo) {
        // React Native's FormData takes this shape for a file part; the cast
        // is unavoidable because the DOM lib types `append` against Blob.
        form.append('photo', input.photo as unknown as Blob);
      }
      return request<User>('/users', { method: 'POST', body: form });
    },
    /**
     * Profile fields ONLY.
     *
     * `role` is deliberately absent from this shape and must never be added:
     * ADR-030 D-4a splits role assignment onto its own Admin-gated route
     * precisely so `users:write` cannot imply it. A client that sent `role`
     * here would be testing whether the server's guard holds, which is not
     * this layer's job.
     */
    updateProfile: (
      id: string,
      input: { first_name?: string; last_name?: string; phone?: string; is_active?: boolean }
    ) =>
      request<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  },

  crm: {
    /**
     * The hotels the CALLER can see -- the server filters by their scope, so
     * a hotel manager gets exactly one row and an RM gets their group's.
     * There is no "all hotels" request shape here, deliberately: the filter
     * is the JWT's, never the client's.
     */
    hotels: () => request<Hotel[]>('/crm/hotels'),
    hotel: (id: string) => request<Hotel>(`/crm/hotels/${id}`),
    hotelGroups: () => request<HotelGroup[]>('/crm/hotel-groups'),
    hotelGroup: (id: string) => request<HotelGroup>(`/crm/hotel-groups/${id}`),

    /**
     * Archived entities. `only_deleted` takes the literal strings
     * "true"/"false" -- a boolean serialises to the same text here, but the
     * enum is what the schema validates, so it is sent explicitly.
     *
     * Admin-only, like restore below: archiving and restoring are master-data
     * lifecycle (ADR-030 D-2), not operations.
     */
    archivedHotels: () => request<Hotel[]>('/crm/hotels?only_deleted=true'),
    archivedHotelGroups: () => request<HotelGroup[]>('/crm/hotel-groups?only_deleted=true'),

    /**
     * Restore is the inverse of DELETE (soft delete), NOT of deactivate --
     * deactivate/reactivate are the temporary pair. Confusing them would
     * "restore" an entity that was merely paused and leave a deleted one
     * still gone.
     */
    restoreHotel: (id: string) =>
      request<Hotel>(`/crm/hotels/${id}/restore`, { method: 'POST' }),
    restoreHotelGroup: (id: string) =>
      request<HotelGroup>(`/crm/hotel-groups/${id}/restore`, { method: 'POST' }),
  },
  analytics: {
    /**
     * `hotelId` is a REQUEST, not a grant. For any non-admin the server
     * ignores an out-of-scope value and answers 403 rather than filtering to
     * it (analytics/controller.ts `resolveScopedFilter`), and omitting it
     * does not widen a manager to every hotel -- their JWT scope claim is the
     * only filter that counts. So this parameter exists to narrow an admin,
     * or to pick one hotel inside an RM's own group; it can never broaden
     * anyone.
     */
    stats: (hotelId?: string) =>
      request<DashboardStats>(
        hotelId ? `/analytics/stats?hotel_id=${encodeURIComponent(hotelId)}` : '/analytics/stats'
      ),
    // GD-06: resolves the previously-silent 403 — /stats is admin/manager-only.
    myStats: () => request<WorkerStats>('/analytics/my-stats'),
    /**
     * The manager-facing leaderboard, behind `analytics:read`. Distinct from
     * `quality.leaderboard()` in both route and response shape -- see
     * AnalyticsLeaderboardEntry.
     */
    leaderboard: (hotelId?: string) =>
      request<AnalyticsLeaderboardEntry[]>(
        hotelId
          ? `/analytics/leaderboard/by-hotel/${encodeURIComponent(hotelId)}`
          : '/analytics/leaderboard'
      ),
    hotelSummary: (hotelId: string) =>
      request<HotelSummary>(`/analytics/hotel-summary/${encodeURIComponent(hotelId)}`),
  },
  /**
   * The worker's own room log (2026-09-01) -- the rooms they cleaned on a
   * shift, room by room.
   *
   * Every route here is self-scoped server-side: `mine` takes no worker id at
   * all, and a write is refused unless the assignment belongs to the caller,
   * so there is no request shape in this client that could touch another
   * worker's rooms.
   */
  rooms: {
    /**
     * Two lists: `rooms` for the given day (default today), and `needs_rework`
     * across ALL days -- a rework raised yesterday is dated today by the
     * server, and a day-filtered list alone would hide it.
     */
    mine: (day?: string) =>
      request<{ rooms: RoomLog[]; needs_rework: RoomLog[] }>(
        `/rooms/mine${day ? `?day=${encodeURIComponent(day)}` : ''}`
      ),

    /** Log a finished room against a shift the caller is checked in to. */
    log: (assignmentId: string, roomNumber: string) =>
      request<RoomLog>(`/rooms/assignments/${encodeURIComponent(assignmentId)}/rooms`, {
        method: 'POST',
        body: JSON.stringify({ room_number: roomNumber }),
      }),

    /** Correct a mis-typed room. Refused once the room has been inspected. */
    update: (roomLogId: string, roomNumber: string) =>
      request<RoomLog>(`/rooms/logs/${encodeURIComponent(roomLogId)}`, {
        method: 'PUT',
        body: JSON.stringify({ room_number: roomNumber }),
      }),

    /** Remove a mis-tapped room. Refused once the room has been inspected. */
    remove: (roomLogId: string) =>
      request<void>(`/rooms/logs/${encodeURIComponent(roomLogId)}`, { method: 'DELETE' }),

    /**
     * Room numbers already used at this hotel, for the input's typeahead.
     * This is what lets the server keep room matching conservative (trim +
     * upper-case only) without workers inventing three spellings of one room.
     */
    suggestions: (hotelId: string) =>
      request<{ rooms: string[] }>(`/rooms/suggestions?hotel_id=${encodeURIComponent(hotelId)}`),
  },

  quality: {
    /**
     * Every check the checker recorded against one shift.
     *
     * The worker's shift screen lists these below the shift detail. No
     * permission gate on the route: the subject of an inspection may always
     * read it, and the server confirms it is their assignment.
     */
    /**
     * The check a rework shift exists to correct, addressed by that shift.
     *
     * The worker doing a rework holds the rework assignment id and nothing
     * else; without this they see only the one-line note the push carried,
     * with no picture of what was actually wrong.
     */
    checkForRework: (reworkAssignmentId: string) =>
      request<QualityCheck & { current_round_number: number }>(
        `/quality/rework-assignments/${encodeURIComponent(reworkAssignmentId)}/check`
      ),

    checksForAssignment: (assignmentId: string) =>
      request<{ assignment_id: string; checks: QualityCheck[] }>(
        `/quality/assignments/${encodeURIComponent(assignmentId)}/checks`
      ),

    /**
     * One check, in the SAME shape the checker's own history screen renders --
     * deliberately one endpoint, so the two sides cannot show different scores
     * for the same inspection.
     */
    getCheck: (checkId: string) =>
      request<QualityCheck>(`/quality/checks/${encodeURIComponent(checkId)}`),

    /** Presigned URLs for one check's photos, including any rework evidence. */
    /**
     * `photos` is the CHECKER's own photographs; `rework_rounds` carries each
     * attempt's evidence separately (2026-08-30). They used to be one array,
     * which is why neither side could tell which pictures proved the fix.
     */
    checkPhotos: (checkId: string) =>
      request<{
        verification_id: string;
        photos: { key: string; url: string | null }[];
        rework_rounds: ReworkRoundPhotos[];
      }>(`/quality/verifications/${encodeURIComponent(checkId)}/photos`),

    // The leaderboard lives here, not under /analytics. /analytics/leaderboard
    // is gated requireRole(['admin','manager','regional_manager']) -- a worker
    // got a flat 403, so this screen had never worked -- and it applies no
    // actor scoping at all, so opening it up would have handed every worker the
    // platform-wide board. /quality/leaderboard scopes server-side to the
    // caller's own hotel group, and is the same endpoint the checker app uses.
    leaderboard: () => request<LeaderboardEntry[]>('/quality/leaderboard'),

    /**
     * CRR §14: the worker uploads a photo and marks the rework done.
     *
     * multipart, because the photo IS the payload -- it is what the checker is
     * notified with. React Native's FormData takes {uri,name,type} rather than
     * a Blob; the runtime reads the file off disk when the request is sent, so
     * the image is never loaded into JS memory.
     */
    completeRework: (assignmentId: string, photos: { uri: string; name: string; type: string }[]) => {
      const form = new FormData();
      for (const photo of photos) {
        appendNativeFile(form, 'photos', photo);
      }
      return request<unknown>(
        `/quality/rework/${encodeURIComponent(assignmentId)}/complete`,
        { method: 'POST', body: form }
      );
    },
  },
  calendar: {
    // GD-18 narrow slice: self-scoped to the authenticated worker (server-side,
    // via req.auth.userId — no worker_id is ever sent from the client).
    myAbsences: () => request<CalendarAbsence[]>('/calendar/my-absences'),
    // `reason` is REQUIRED by the backend for VACATION and optional for SICK
    // (MarkAbsenceSchema). It was missing entirely here, so every vacation
    // request came back 422.
    markAbsence: (input: { day: string; kind: CalendarAbsenceKind; reason?: string }) =>
      request<CalendarAbsence>('/calendar/my-absences', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // 2026-08-13 parity gap: a worker could mark themselves sick from the
    // phone but had no way to undo it here -- the withdraw action existed only
    // on the web app, which is not where workers actually are. The backend
    // self-scopes this (a worker may only delete their own absence) and
    // refuses a past day.
    deleteAbsence: (absenceId: string) =>
      request<void>(`/calendar/absences/${absenceId}`, { method: 'DELETE' }),

    /**
     * The team's absences over a range. `from` and `to` are BOTH required by
     * the backend -- there is no default window, so an agenda always sends
     * one (ListAbsencesQuerySchema).
     */
    teamAbsences: (params: { from: string; to: string; workerId?: string }) => {
      const qs = new URLSearchParams({ from: params.from, to: params.to });
      if (params.workerId) qs.set('worker_id', params.workerId);
      return request<CalendarAbsence[]>(`/calendar/absences?${qs.toString()}`);
    },

    /**
     * Mark an absence FOR a worker (manager/RM/admin).
     *
     * `reason` is mandatory for VACATION and optional for SICK, enforced by a
     * zod refine -- omitting it on a vacation is a 422, not a silently empty
     * field. The same omission already cost this client every vacation
     * request once (see markAbsence above).
     */
    markAbsenceForWorker: (input: {
      worker_id: string;
      day: string;
      kind: CalendarAbsenceKind;
      reason?: string;
    }) =>
      request<CalendarAbsence>('/calendar/absences', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /** Day-only move. Nothing else about the absence changes. */
    moveAbsence: (absenceId: string, day: string) =>
      request<CalendarAbsence>(`/calendar/absences/${absenceId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ day }),
      }),

    availability: () => request<WorkerAvailability[]>('/calendar/availability'),

    /**
     * A hotel's shift summaries. Scoped by checkHotelAccess() on the route, so
     * a manager asking about another hotel is refused rather than filtered.
     */
    shiftSummaries: (hotelId: string) =>
      request<DailyShiftSummary[]>(`/calendar/hotels/${hotelId}/shift-summaries`),

    /**
     * Upsert one day's summary. PUT, not POST: the day is the identity, so
     * saving twice corrects the row rather than creating a second one.
     */
    saveShiftSummary: (
      hotelId: string,
      date: string,
      input: {
        total_rooms: number;
        stay_over_rooms: number;
        checkout_rooms: number;
        total_people_working: number;
        notes?: string;
      }
    ) =>
      request<DailyShiftSummary>(`/calendar/hotels/${hotelId}/shift-summaries/${date}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
  },
  geo: {
    // GD-14: self-checkin, self-scoped to the authenticated worker
    // (server-side, via req.auth.userId — no worker_id is ever sent from the
    // client). The response never includes raw coordinates (OD-GEO-005) —
    // only distance_meters/inside_radius.
    checkIn: (input: { hotel_id: string; latitude: number; longitude: number }) =>
      request<GeoCheckin>('/geo/checkins', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
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
    getCompleteness: (workerId: string) =>
      request<DocumentCompleteness>(`/documents/workers/${workerId}/documents/completeness`),
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
      asset: { uri: string; name: string; mimeType?: string; file?: unknown },
      input: {
        category: DocumentCategory;
        is_work_permit?: boolean;
        expires_at?: string;
      }
    ) => {
      const form = new FormData();

      // WHY THIS IS NOT THE {uri, name, type} SHAPE EVERY RN GUIDE SHOWS.
      //
      // Expo replaces the global `fetch` on native with its WinterCG
      // implementation (expo/src/winter/runtime.native.ts:
      // `install('fetch', () => require('./fetch').fetch)`). That fetch
      // serialises multipart itself, and its converter
      // (expo/src/winter/fetch/convertFormData.ts) accepts exactly three
      // things per part:
      //
      //     a string | a Blob | an object with `bytes()`
      //
      // and throws `Unsupported FormDataPart implementation` on anything
      // else. Its own doc comment is explicit: "`uri` is not supported for
      // React Native's FormData."
      //
      // So RN's legacy {uri, name, type} part -- which React Native's OWN
      // FormData still accepts -- fails under Expo's fetch, and every native
      // document upload threw. The web client was unaffected because a
      // browser sends a real File.
      //
      // expo-file-system's `File` satisfies the third branch: it exposes
      // `bytes()` and a `name`, which is what the converter reads for the
      // filename. Required lazily, never at module scope: a top-level import
      // of an Expo module whose native half is absent throws during module
      // evaluation and takes down every importer (the same failure that once
      // presented as "Route is missing the required default export").
      appendNativeFile(form, 'file', asset);
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
    delete: (documentId: string) =>
      request<void>(`/documents/documents/${documentId}`, { method: 'DELETE' }),
  },
  employee: {
    /**
     * The reviewer's queue, filtered to their own SCOPE server-side -- not
     * merely gated by role. An empty queue therefore proves nothing about
     * whether the filter works; it may simply be empty.
     */
    reviewQueue: () => request<EmploymentRecordDto[]>('/employees/review-queue'),

    /**
     * The six lifecycle transitions, each a named workflow action rather than
     * a field edit.
     *
     * ADR-030 D-4b is explicit that manager authority over an employment
     * record is expressed ONLY as discrete transitions -- there is no
     * manager-editable field set, and none may be introduced by inference
     * from `employees:write`. That is why this is a fixed verb list and not a
     * generic PATCH.
     *
     * Approving a MANAGER or REGIONAL_MANAGER is TWO calls, approve then
     * assign (ADR-065). A caller that stops after the first leaves the record
     * approved and unassigned, and the hotel without a manager.
     */
    transition: (
      employeeId: string,
      action:
        | 'submit-for-review'
        | 'approve'
        | 'reject'
        | 'deactivate'
        | 'reactivate'
        | 'rehire'
        | 'trigger-reonboarding',
      body?: Record<string, unknown>
    ) =>
      request<EmploymentRecordDto>(`/employees/${employeeId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),

    assign: (employeeId: string, input: { hotel_group_id: string; primary_hotel_id?: string }) =>
      request<EmploymentRecordDto>(`/employees/${employeeId}/assign`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /**
     * 2026-09-23: this declared `{ employee_id, reason }[]` and the service
     * returned raw Prisma rows, which carry NEITHER. The manager app rendered
     * blank rows keyed by `undefined` (duplicate React keys) because both
     * sides had agreed on a field that has never existed on this wire. The
     * service now returns a real DTO; this type is that DTO.
     */
    blocklist: (hotelId: string) =>
      request<BlocklistEntryDto[]>(`/employees/hotels/${hotelId}/blocklist`),

    /**
     * Block an employee from a hotel. A REASON IS REQUIRED by the schema
     * (`SetBlocklistSchema`, min(1)) -- this bars a named person from a named
     * property, and the reason is the record of why.
     */
    addToBlocklist: (hotelId: string, input: { employee_id: string; reason: string }) =>
      request<void>(`/employees/hotels/${hotelId}/blocklist`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /** RM and admin only -- `org_chart:read` is the one token RM has and Manager does not. */
    orgChart: (hotelGroupId: string) =>
      request<Record<string, unknown>>(`/employees/hotel-groups/${hotelGroupId}/org-chart`),

    /**
     * Resolves this user's EmploymentRecord, or null when none exists yet
     * (null, not a 404). Workers hold `employees:read` and the service scopes
     * visibility to self, so a worker may call this for their own account.
     *
     * Required before submitForReview: the lifecycle endpoints are keyed by
     * the human-facing `employee_id` (e.g. "EMP-W-001"), which is NOT the
     * user id and is not returned by /auth/me. Mirrors what the web client
     * does (employeesApi.getByUserId -> record.employee_id).
     */
    getByUserId: (userId: string) =>
      request<EmploymentRecordDto | null>(`/employees/by-user/${encodeURIComponent(userId)}`),

    /**
     * `employeeId` is the EmploymentRecord's `employee_id`, never the user id.
     *
     * This endpoint previously carried an `/employee-management` prefix and was
     * called with the user id. Both were wrong: the router is mounted at
     * `/employees`, and the service resolves the record by `employee_id`. Every
     * submission 404'd, so onboarding could not be completed from the app.
     */
    submitForReview: (employeeId: string) =>
      request<unknown>(`/employees/${encodeURIComponent(employeeId)}/submit-for-review`, { method: 'POST' }),
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

    getContractDownloadUrl: (workerId: string) =>
      `${BASE_URL}/hr/workers/${encodeURIComponent(workerId)}/contract-download`,

    listPayroll: () =>
      request<PayslipRequestDto[]>('/hr/payroll'),

    /** Contracts the caller may see; scoped server-side. */
    listContracts: () => request<ContractDto[]>('/hr/contracts'),

    /** Manager fulfils a payslip request. Cross-group is refused server-side. */
    fulfilPayslip: (requestId: string) =>
      request<PayslipRequestDto>(`/hr/payroll/${requestId}/fulfil`, { method: 'POST' }),

    /**
     * Upload a signed contract scan. MULTIPART, like every other file path in
     * this client — the request helper omits Content-Type so the runtime sets
     * its own boundary.
     *
     * This is the step that cannot happen on a laptop: the signed page is on
     * paper, and the phone's camera is the scanner. The web equivalent
     * assumes a printer and a flatbed.
     */
    uploadContractScan: (workerId: string, file: { uri: string; name: string; type: string }) => {
      const form = new FormData();
      form.append('file', file as unknown as Blob);
      return request<ContractDto>(`/hr/workers/${workerId}/contract-scan`, {
        method: 'POST',
        body: form,
      });
    },

    confirmContract: (workerId: string) =>
      request<ContractDto>(`/hr/workers/${workerId}/contract-confirm`, { method: 'POST' }),

    requestPayslip: (input: CreatePayslipRequestRequest) =>
      request<PayslipRequestDto>('/hr/payslip-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
};
