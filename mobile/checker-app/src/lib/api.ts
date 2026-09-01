import type {
  ReworkRoundPhotos,
  AcceptBroadcastResult,
  Broadcast,
  BroadcastEligibility,
  InspectableWorker,
  SkillTag,
  WorkRequest,
  WorkerAssignment,
  WorkerStats,
  AttendanceRecord,
  AuthResponse,
  CalendarAbsence,
  CalendarAbsenceKind,
  ConsentNotice,
  ConsentRecord,
  ConsentStatus,
  ContractDto,
  CreatePayslipRequestRequest,
  DocumentCategory,
  DocumentCompleteness,
  EmploymentRecordDto,
  LeaderboardEntry,
  Notification,
  OwnInspection,
  OwnInspectionsPage,
  RecordedInspection,
  PayslipRequestDto,
  PushApp,
  PushPlatform,
  PushToken,
  QualityVerification,
  Rating,
  RecordConsentDecisionInput,
  User,
  WorkerDocument,
} from '@/types/api';
import type { UiLocale } from '@/lib/locales';
import type { InspectionOutcome } from '@/lib/inspection-outcome';

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
/**
 * Fired whenever the API refuses a call with CONSENT_REQUIRED.
 *
 * The server revokes consent immediately, but this client only ever found out
 * on a fresh mount: ConsentGate read /consent/status once in a useEffect, so a
 * checker whose consent was withdrawn (from the web, by an admin, or on
 * another device) kept a fully usable UI until the app was force-quit, while
 * every gated request was already 403-ing underneath. This turns that 403 into
 * the signal that re-runs the gate.
 */
let _onConsentRequired: (() => void) | null = null;
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

export function setOnConsentRequired(cb: (() => void) | null): void {
  _onConsentRequired = cb;
}

/** The server's error code for a call refused by the daily consent gate. */
export const CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED';

/**
 * Notifies the consent gate without altering control flow: the caller still
 * gets its ApiError, so per-screen error handling is unchanged.
 */
function notifyIfConsentRequired(code: string | undefined): void {
  if (code === CONSENT_REQUIRED_CODE) _onConsentRequired?.();
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
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

  const body = await res.json();
  return body.data as T;
}

export const api = {
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
    // --- Ported from worker-app (2026-08-27) ---
    // A checker checks in to their own shift exactly as a worker does, and
    // must be checked in before inspecting a room. POST /attendance admits
    // 'checker' as of the same date.
    //
    // GD-14: when coordinates are available they're sent with the check-in
    // itself so backend-attendance can run its geofence verification as part
    // of the same request — optional here only because location
    // permission/signal can fail on-device, not because Attendance treats
    // them as informational.
    checkIn: (assignmentId: string, location?: { latitude: number; longitude: number }) =>
      request<AttendanceRecord>('/attendance', {
        method: 'POST',
        body: JSON.stringify({ assignment_id: assignmentId, ...location }),
      }),
    checkOut: (attendanceId: string, location?: { latitude: number; longitude: number }) =>
      request<AttendanceRecord>(`/attendance/${attendanceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ check_out_at: new Date().toISOString(), ...location }),
      }),
    // GET /attendance is self-scoped server-side for a WORKER, but
    // deliberately NOT for a CHECKER -- checker is cross-hotel there by
    // design, because the same endpoint backs the attendance-verification
    // queue (list every worker's rows to verify them). A checker calling
    // this with no worker_id therefore got back every worker's attendance,
    // not their own: their Attendance tab showed other people's shifts, and
    // tapping one 403'd with "Cannot access this assignment" (assignments
    // stay self-scoped for a checker, so a foreign assignment id is refused)
    // -- found live, traced to this one unscoped call.
    // worker_id is required here (not optional) so this cannot regress back
    // to the unscoped call by a param being left off.
    listMine: (workerId: string, params?: { page?: number; per_page?: number }) => {
      const qs = new URLSearchParams();
      qs.set('worker_id', workerId);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.per_page) qs.set('per_page', String(params.per_page));
      return request<AttendanceRecord[]>(`/attendance?${qs}`);
    },
    // The backend does not embed attendance on AssignmentDto, so a shift is
    // resolved to its attendance row by assignment_id to obtain the id needed
    // for check-out.
    listByAssignment: (assignmentId: string) =>
      request<AttendanceRecord[]>(`/attendance?assignment_id=${encodeURIComponent(assignmentId)}`),
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
      return request<AttendanceRecord[]>(`/attendance?${qs}`);
    },
    get: (id: string) => request<AttendanceRecord>(`/attendance/${id}`),
    verify: (id: string, notes?: string) =>
      request<AttendanceRecord>(`/attendance/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_verified: true, ...(notes ? { notes } : {}) }),
      }),
  },

  workRequests: {
    // Server-side, GET /work-requests is already narrowed to the caller's
    // own target_role for a self-scoped role (job-requests/service.ts
    // list()), so a checker only ever receives CHECKER-targeted rows and
    // cannot widen that by passing a target_role of its own. This client
    // does not send one -- there is nothing useful it could ask for.
    list: (params?: { status?: string; page?: number; limit?: number; is_broadcast?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      // The backend accepts only the literal strings "true"/"false".
      if (params?.is_broadcast !== undefined) qs.set('is_broadcast', params.is_broadcast ? 'true' : 'false');
      const q = qs.toString();
      return request<WorkRequest[]>(`/work-requests${q ? `?${q}` : ''}`);
    },
    get: (id: string) => request<WorkRequest>(`/work-requests/${id}`),
    getBroadcastEligibility: (id: string) =>
      request<BroadcastEligibility>(`/work-requests/broadcasts/${id}/eligibility`),
    // First-accept wins; a lost race returns {status: 'requirement_fulfilled'},
    // not an error. `skill: null` claims the "no specific skill required"
    // slot -- the only shape a CHECKER-targeted broadcast uses, since the
    // SkillTag values are all WORKER-domain.
    acceptBroadcast: (id: string, skill: SkillTag | null) =>
      request<AcceptBroadcastResult>(`/work-requests/broadcasts/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ skill }),
      }),
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
    updateStatus: (id: string, status: string) =>
      request<WorkerAssignment>(`/assignments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
  },
  analytics: {
    // Only the self-scoped one is ported: /analytics/stats is admin/manager
    // only, so a checker calling it takes a 403 (GD-06 fixed exactly that
    // silent failure in worker-app).
    myStats: () => request<WorkerStats>('/analytics/my-stats'),
  },
  quality: {
    /**
     * ADR-072 §2.5: the workers this checker may inspect on `day` (defaults to
     * today server-side). Scope is resolved on the server from the checker's
     * own shifts — the client sends no hotel, and could not be trusted to.
     */
    inspectableWorkers: (day?: string) =>
      request<{ day: string; workers: InspectableWorker[] }>(
        `/quality/inspectable-workers${day ? `?day=${encodeURIComponent(day)}` : ''}`
      ),
    /**
     * CRR §15: the checker uploads a photo WITH the rating.
     *
     * Always multipart, even with no photos, so there is one code path -- the
     * route parses multipart either way. React Native's FormData takes
     * {uri,name,type} rather than a Blob; the runtime streams the file off
     * disk when the request is sent, so images never sit in JS memory.
     */
    /**
     * One inspection, one request.
     *
     * Replaces the three-call sequence this app used to run -- createRating,
     * createVerification, assignRework -- which uploaded the photos TWICE
     * (once per record), had no atomicity, and produced up to three
     * notifications for one decision. Since the Rating merge (2026-08-29) the
     * server writes a single QualityVerification carrying the checklist, the
     * photos, the score and the outcome, plus any rework assignment, in one
     * transaction.
     *
     * `outcome` is the checker's decision and is NOT inferred from `score`:
     * rework is assignable at any score.
     */
    recordInspection: (
      data: {
        assignment_id: string;
        worker_id: string;
        room_number: string;
        score: number;
        comment?: string;
        criteria_scores?: Record<string, number>;
        outcome: InspectionOutcome;
        rework_notes?: string;
      },
      photos: { uri: string; name: string; type: string }[] = []
    ) => {
      const form = new FormData();
      form.append('assignment_id', data.assignment_id);
      form.append('worker_id', data.worker_id);
      form.append('room_number', data.room_number);
      form.append('score', String(data.score));
      form.append('outcome', data.outcome);
      if (data.comment) form.append('comment', data.comment);
      if (data.rework_notes) form.append('rework_notes', data.rework_notes);
      if (data.criteria_scores) {
        form.append('criteria_scores', JSON.stringify(data.criteria_scores));
      }
      for (const photo of photos) appendNativeFile(form, 'photos', photo);
      return request<RecordedInspection>('/quality/inspections', {
        method: 'POST',
        body: form,
      });
    },

    createVerification: (
      // room_number is REQUIRED, not optional-with-a-default: the server
      // rejects a check without one, and leaving it out of this type is what
      // let the web's equivalent form break silently -- tsc had nothing to say.
      data: { assignment_id: string; room_number: string; score: number; notes?: string },
      photos: { uri: string; name: string; type: string }[] = []
    ) => {
      const form = new FormData();
      form.append('assignment_id', data.assignment_id);
      form.append('room_number', data.room_number);
      form.append('score', String(data.score));
      if (data.notes) form.append('notes', data.notes);
      for (const photo of photos) appendNativeFile(form, 'photos', photo);
      return request<QualityVerification>('/quality/verifications', {
        method: 'POST',
        body: form,
      });
    },
    /**
     * CRR §14/§15: presigned URLs for one inspection's evidence. Fetched on
     * demand -- the URLs expire in 15 minutes, so caching them with the
     * verification would store values that are already dead.
     */
    /**
     * The inspection record itself. Needed alongside the photos so the
     * evidence screen can show the score and decide whether rework is still
     * assignable — CRR §14's "Checker assigns rework to a specific worker".
     */
    getVerification: (verificationId: string) =>
      request<QualityVerification>(
        `/quality/verifications/${encodeURIComponent(verificationId)}`
      ),

    /**
     * CRR §14: assign rework for a failed inspection to the same worker.
     * Creates a second, linked assignment; a second call for the same
     * verification is a 409, not a duplicate.
     */
    assignRework: (verificationId: string, notes: string) =>
      request<unknown>('/quality/rework', {
        method: 'POST',
        body: JSON.stringify({ verification_id: verificationId, notes }),
      }),

    /**
     * The checker's own inspection history — the shifts they scored, newest
     * first. Self-scoped server-side off the auth token; there is no actor
     * parameter to pass and none to spoof.
     *
     * This is the app's only route back to a past inspection. Before it, both
     * evidence screens were reachable only from the redirect immediately after
     * submitting, or from a push notification — so a checker who dismissed the
     * confirmation could not see their own scores or photos again, and
     * "Assign rework" (CRR §14) had no entry point at all.
     */
    myInspections: (page = 1, perPage = 20, q?: string) => {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      // Omitted rather than sent empty: the server treats a blank q as "no
      // search", but sending one anyway makes every request look like a query
      // in the logs and invites a future reader to add a needless branch.
      if (q && q.trim()) qs.set('q', q.trim());
      return request<OwnInspectionsPage>(`/quality/my-inspections?${qs.toString()}`);
    },

    /** Every check recorded against one shift — the worker's shift screen. */
    checksForAssignment: (assignmentId: string) =>
      request<{ assignment_id: string; checks: OwnInspection[] }>(
        `/quality/assignments/${encodeURIComponent(assignmentId)}/checks`
      ),

    /** One check, in the shape both the worker and the checker see. */
    getCheck: (checkId: string) =>
      request<OwnInspection>(`/quality/checks/${encodeURIComponent(checkId)}`),

    verificationPhotos: (verificationId: string) =>
      request<{
        verification_id: string;
        /** The CHECKER's own photographs. */
        photos: { key: string; url: string | null }[];
        /** One group per rework attempt, each with that attempt's evidence. */
        rework_rounds: ReworkRoundPhotos[];
      }>(
        `/quality/verifications/${encodeURIComponent(verificationId)}/photos`
      ),

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
    // `reason` is REQUIRED by the backend for VACATION and optional for SICK
    // (MarkAbsenceSchema). It was missing entirely here, so every vacation
    // request came back 422.
    markAbsence: (input: { day: string; kind: CalendarAbsenceKind; reason?: string }) =>
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
    // screen has no use for get()/export() (both exist on
    // frontend/lib/api.ts's documentsApi); add whichever is needed when a
    // screen actually consumes it, rather than porting the full contract
    // speculatively.
    list: (workerId: string, category?: DocumentCategory) =>
      request<WorkerDocument[]>(
        `/documents/workers/${workerId}/documents${category ? `?category=${category}` : ''}`
      ),
    // Added with the onboarding flow (ADR-065 is universal for non-Admin
    // roles): the checklist needs the server's own completeness verdict,
    // which owns the ID_CARD-or-PASSPORT and work-permit rules.
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
  },
  employee: {
    /**
     * Resolves this user's EmploymentRecord, or null when none exists yet
     * (null, not a 404). ADR-065 makes onboarding universal for non-Admin
     * roles, so a checker reads their own record exactly as a worker does.
     *
     * Required before submitForReview: the lifecycle endpoints are keyed by
     * the human-facing `employee_id` (e.g. "EMP-C-001"), which is NOT the user
     * id and is not returned by /auth/me.
     */
    getByUserId: (userId: string) =>
      request<EmploymentRecordDto | null>(`/employees/by-user/${encodeURIComponent(userId)}`),

    /** `employeeId` is the EmploymentRecord's `employee_id`, never the user id. */
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

    requestPayslip: (input: CreatePayslipRequestRequest) =>
      request<PayslipRequestDto>('/hr/payslip-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
};
