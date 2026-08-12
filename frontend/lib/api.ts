/**
 * This module (and API_BASE_URL, lib/config.ts) is written for BROWSER/
 * client-side use only, reached through the Next.js rewrite proxy
 * (next.config.ts's rewrites()) so auth cookies stay same-origin (Security
 * #4, 2026-08-09). Every current caller is a client component/hook.
 *
 * API_BASE_URL is deliberately a bare relative path ("/api/v1") — that only
 * resolves correctly when `fetch` runs in a browser (or anywhere else with
 * an ambient request/origin to resolve against). If this module is ever
 * imported from a Server Component or other Node-side code, a relative URL
 * will fail there (Node's fetch requires an absolute URL unless a request
 * context supplies one) — that caller would need its own absolute-URL
 * fetch to the backend directly, not this file's apiFetch/buildUrl.
 */
import { API_BASE_URL } from "@/lib/config";
import { useAuthStore } from "@/stores/auth";
import type {
  AcceptBroadcastInput,
  AcceptBroadcastResultDto,
  ApiEnvelope,
  Assignment,
  Attendance,
  AuthUser,
  UpdateProfileInput,
  Availability,
  BroadcastEligibilityDto,
  CalendarAbsence,
  CalendarEntryDto,
  CheckInInput,
  ConsentNotice,
  ConsentRecord,
  ConsentStatus,
  CreateCalendarEntryInput,
  CreateHotelGroupInput,
  CreateHotelInput,
  CreateContractInput,
  CreatePayslipRequestInput,
  CreateRatingInput,
  CreateUserInput,
  CreateVerificationInput,
  CreateWorkRequestInput,
  DashboardStats,
  HotelAnalyticsSummary,
  LeaderboardEntry,
  GeoCheckin,
  Hotel,
  HotelGroup,
  Contract,
  ListAbsencesQuery,
  ListAssignmentsQuery,
  ListAttendanceQuery,
  ListCalendarEntriesQuery,
  ListGeoCheckinsQuery,
  ListHotelGroupsQuery,
  ListHotelsQuery,
  ListPayslipRequestsQuery,
  ListUsersQuery,
  ListWorkRequestsQuery,
  LoginResponse,
  LogRoomsCompletedInput,
  MarkAbsenceInput,
  MarkAbsenceForWorkerInput,
  Notification,
  PayslipRequest,
  RaiseBroadcastInput,
  Rating,
  RecordConsentDecisionInput,
  RoomsCompletedEntry,
  QualityVerification,
  UpdateAssignmentInput,
  UpdateAttendanceInput,
  UpdateHotelGroupInput,
  UpdateHotelInput,
  UpdateUserInput,
  UpdateUserRoleInput,
  UpdateWorkRequestInput,
  UserDetail,
  UserSummary,
  WorkerStats,
  WorkRequest,
  WorkerDocument,
  DocumentCategory,
  DocumentCompleteness,
  UploadDocumentInput,
  EmployeeBlocklistEntry,
  EmploymentRecord,
  OrgChart,
  CreateEmploymentInput,
  ApproveEmploymentInput,
  AssignEmploymentInput,
  RejectEmploymentInput,
  DeactivateEmploymentInput,
  DeleteEmploymentInput,
  SetBlocklistInput,
  SubjectRightsBundle,
} from "@/lib/types";

/** Error thrown by {@link apiFetch} for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /**
   * ADR-031 D-6/PR-4a: seconds to wait before retrying, parsed from the
   * edge's (Nginx/Cloudflare) `Retry-After` header on a 429. `undefined`
   * when absent or unparseable — the edge is the sole source of rate
   * limiting (no app-layer limiter per TREQ-AUTH-008), so this is passed
   * through, never computed.
   */
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Retry-After (RFC 7231 §7.1.3) is either delay-seconds ("30") or an
 * HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"). Nginx emits delay-seconds
 * today, but the header format is a property of the edge, not this app —
 * an HTTP-date is handled defensively in case the edge/CDN ever changes.
 */
function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
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

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body, or a `FormData` instance for a
   * multipart upload (e.g. document upload) — see the `body` handling in
   * {@link apiFetch}, which skips JSON serialisation and the
   * `Content-Type` override for `FormData` so the browser can set the
   * correct multipart boundary itself. */
  body?: unknown;
  /** Attach the bearer access token. Defaults to `true`. */
  auth?: boolean;
  /** Internal: prevents infinite refresh recursion. */
  _retried?: boolean;
}

function buildUrl(path: string): string {
  return path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const text = await res.text();
  if (!text) {
    return { status: "success", data: undefined as unknown as T };
  }
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(res.status, "INVALID_RESPONSE", text || res.statusText);
  }
}

/**
 * ADR-031 D-3/C-7: the backend distinguishes an ordinary expired/absent
 * token (any other 401) from a revoked one (`TOKEN_REVOKED` — the account
 * was demoted, deactivated, deleted, had its password reset, or had all
 * sessions explicitly revoked by an admin since the token was issued).
 * A revoked token must never be sent through the refresh flow: the refresh
 * token itself may still be cryptographically valid, but re-issuing an
 * access token for an account in that state is exactly the stale-privilege
 * window this record exists to close. Mirrors the backend's
 * `ERROR_CODES.TOKEN_REVOKED` (`config/constants.ts`).
 */
const TOKEN_REVOKED_CODE = "TOKEN_REVOKED";

/**
 * Calls the backend refresh endpoint. The refresh token travels via the
 * httpOnly cookie -- on success the backend's Set-Cookie response updates
 * both cookies directly, nothing to write into the store. On failure the
 * session is cleared. Returns whether the refresh succeeded.
 *
 * A module-level promise de-duplicates concurrent refreshes so a burst
 * of 401s only triggers a single refresh request.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      // Security #4: no body, no stored refresh token to read -- the
      // refresh token travels in the httpOnly cookie automatically via
      // `credentials: 'include'`. On success the backend's Set-Cookie
      // response updates both cookies directly; there is nothing to write
      // into the store here (compare to the old setTokens() call this
      // replaced).
      const res = await fetch(buildUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        useAuthStore.getState().clear();
        return false;
      }
      return true;
    } catch {
      useAuthStore.getState().clear();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Typed fetch wrapper around the backend API.
 *
 * - Serialises `body` as JSON and sets the matching `Content-Type`.
 * - Sends `credentials: 'include'` so the browser attaches the httpOnly
 *   auth cookies automatically (Security #4, 2026-08-09) -- there is no
 *   token to read or attach as a header here anymore. `auth` stays as a
 *   no-op option (kept so the ~40 existing call sites passing `auth: false`
 *   for public endpoints don't all need touching); it no longer changes
 *   what's sent, only whether a 401 triggers the refresh-and-retry below.
 * - On a 401, transparently refreshes the access token once and retries.
 * - Unwraps the success envelope, returning `data`; throws {@link ApiError}
 *   on any error response.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, auth = true, _retried = false, headers, ...rest } = options;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const finalHeaders = new Headers(headers);
  // A FormData body must NOT get an explicit Content-Type: the browser sets
  // one itself (multipart/form-data; boundary=...), which fetch can only
  // compute from the actual FormData instance it sends.
  if (body !== undefined && !isFormData && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }

  const res = await fetch(buildUrl(path), {
    ...rest,
    credentials: "include",
    headers: finalHeaders,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  // TOKEN_REVOKED (ADR-031 C-7) is checked regardless of `_retried`: a
  // revocation can just as easily land on the post-refresh retry request
  // (a race between the refresh call succeeding and the retry completing)
  // as on the first attempt, and must clear credentials either way rather
  // than falling through to a generic error on the retried call.
  if (res.status === 401 && auth) {
    const peeked = await parseEnvelope<T>(res.clone());
    const isRevoked =
      peeked.status === "error" && peeked.error.code === TOKEN_REVOKED_CODE;

    if (isRevoked) {
      useAuthStore.getState().clear();
      throw new ApiError(
        res.status,
        peeked.error.code,
        peeked.error.message,
        peeked.error.details,
      );
    }

    // Attempt a single transparent refresh + retry on unauthorized.
    if (!_retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return apiFetch<T>(path, { ...options, _retried: true });
      }
    }
  }

  // ADR-031 D-6/PR-4a: a 429 is produced by the Nginx/Cloudflare edge, not
  // the application (no app-layer rate limiter — TREQ-AUTH-008), so its
  // body is not guaranteed to be the app's JSON envelope. Handle it before
  // attempting to parse as an envelope, carrying Retry-After through
  // unconditionally.
  if (res.status === 429) {
    throw new ApiError(
      res.status,
      "RATE_LIMITED",
      "Too many requests. Please wait before trying again.",
      undefined,
      parseRetryAfter(res),
    );
  }

  const envelope = await parseEnvelope<T>(res);

  if (!res.ok || envelope.status === "error") {
    const err =
      envelope.status === "error"
        ? envelope.error
        : { code: "HTTP_ERROR", message: res.statusText };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return envelope.data;
}

/** High-level auth API matching the backend `/auth/*` routes. */
export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    }),

  me: () => apiFetch<AuthUser>("/auth/me"),

  /**
   * `PUT /auth/profile` (auth/routes.ts). The endpoint has existed since the
   * auth module was built but no client method called it, so the profile page
   * was read-only with no way to edit your own name or phone.
   */
  updateProfile: (input: UpdateProfileInput) =>
    apiFetch<AuthUser>("/auth/profile", {
      method: "PUT",
      body: input,
    }),

  // Security #4: no refresh token to pass -- it travels via the httpOnly
  // cookie, which the backend reads to identify and delete the right
  // session, then clears both cookies in its response.
  logout: () => apiFetch<{ message: string }>("/auth/logout", { method: "POST" }),

  requestPasswordReset: (email: string) =>
    apiFetch<{ message: string }>("/auth/password-reset", {
      method: "POST",
      auth: false,
      body: { email },
    }),

  confirmPasswordReset: (token: string, new_password: string) =>
    apiFetch<{ message: string }>("/auth/password-reset/confirm", {
      method: "POST",
      auth: false,
      body: { token, new_password },
    }),
};

/**
 * Serialises a query object into a URL search string, skipping
 * `undefined`/empty values. Returns `""` (no `?`) when nothing is set.
 */
function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Work requests API matching the backend `/work-requests/*` routes. */
export const workRequestsApi = {
  list: (query: ListWorkRequestsQuery = {}) => {
    const { is_broadcast, ...rest } = query;
    return apiFetch<WorkRequest[]>(
      `/work-requests${toQuery({
        ...rest,
        // The backend accepts only the literal strings "true"/"false".
        is_broadcast: is_broadcast === undefined ? undefined : is_broadcast ? "true" : "false",
      })}`,
    );
  },

  get: (id: string) => apiFetch<WorkRequest>(`/work-requests/${id}`),

  create: (input: CreateWorkRequestInput) =>
    apiFetch<WorkRequest>("/work-requests", { method: "POST", body: input }),

  update: (id: string, input: UpdateWorkRequestInput) =>
    apiFetch<WorkRequest>(`/work-requests/${id}`, {
      method: "PATCH",
      body: input,
    }),

  /** Publish a DRAFT request by transitioning it to OPEN. */
  publish: (id: string) =>
    apiFetch<WorkRequest>(`/work-requests/${id}`, {
      method: "PATCH",
      body: { status: "OPEN" },
    }),

  /** Cancel a DRAFT/OPEN/PARTIALLY_FILLED request by transitioning it to CANCELLED. */
  cancel: (id: string, reason?: string) =>
    apiFetch<WorkRequest>(`/work-requests/${id}`, {
      method: "PATCH",
      body: {
        status: "CANCELLED",
        ...(reason ? { cancellation_reason: reason } : {}),
      },
    }),

  /**
   * Job Dispatch Phase 2 (Epic 9 PR 9.7, admin/manager only): raise a
   * standalone broadcast specifying skill x headcount lines. Published
   * immediately (OPEN) — there is no DRAFT step for a broadcast. Gated
   * server-side by FEATURE_JOBDISPATCH_PHASE2 (404 while disabled).
   */
  raiseBroadcast: (input: RaiseBroadcastInput) =>
    apiFetch<WorkRequest>("/work-requests/broadcasts", {
      method: "POST",
      body: input,
    }),

  /** Job Dispatch Phase 2 (Epic 9 PR 9.7): per-skill-slot eligible-worker breakdown. */
  getBroadcastEligibility: (id: string) =>
    apiFetch<BroadcastEligibilityDto>(`/work-requests/broadcasts/${id}/eligibility`),

  /**
   * Job Dispatch Phase 2 (Epic 9 PR 9.9, any authenticated role): worker
   * accepts one skill slot. First-accept-wins; a lost race returns
   * `{status: 'requirement_fulfilled'}`, not an error.
   */
  acceptBroadcast: (id: string, input: AcceptBroadcastInput) =>
    apiFetch<AcceptBroadcastResultDto>(`/work-requests/broadcasts/${id}/accept`, {
      method: "POST",
      body: input,
    }),

  /** Job Dispatch Phase 2 (Epic 9 PR 9.10, admin/manager only): close an unfilled broadcast early. */
  manualCloseBroadcast: (id: string) =>
    apiFetch<WorkRequest>(`/work-requests/broadcasts/${id}/close`, {
      method: "POST",
    }),
};

/** Assignments API matching the backend `/assignments/*` routes. */
export const assignmentsApi = {
  list: (query: ListAssignmentsQuery = {}) =>
    apiFetch<Assignment[]>(`/assignments${toQuery({ ...query })}`),

  get: (id: string) => apiFetch<Assignment>(`/assignments/${id}`),

  update: (id: string, input: UpdateAssignmentInput) =>
    apiFetch<Assignment>(`/assignments/${id}`, { method: "PATCH", body: input }),

  /** Transition a CONFIRMED assignment to IN_PROGRESS (start the shift). */
  start: (id: string) =>
    assignmentsApi.update(id, { status: "IN_PROGRESS" }),

  /** Transition an IN_PROGRESS assignment to COMPLETED. */
  complete: (id: string) => assignmentsApi.update(id, { status: "COMPLETED" }),

  /** Cancel a CONFIRMED or IN_PROGRESS assignment with an optional reason. */
  cancel: (id: string, reason?: string) =>
    assignmentsApi.update(id, {
      status: "CANCELLED",
      ...(reason ? { cancellation_reason: reason } : {}),
    }),

  /**
   * ADR-028: logs the manager-entered rooms-completed count for this
   * assignment. Only valid once the assignment is COMPLETED (409 otherwise,
   * 2026-08-09). Strict create — a second call for the same assignment 409s
   * (ConflictError); use updateRoomsCompleted() below to correct an existing
   * entry instead. The logged entry is also readable via
   * `assignmentsApi.get(id).rooms_completed` (AssignmentDto), not just from
   * this call's own response.
   */
  logRoomsCompleted: (id: string, input: LogRoomsCompletedInput) =>
    apiFetch<RoomsCompletedEntry>(`/assignments/${id}/rooms-completed`, {
      method: "POST",
      body: input,
    }),

  /**
   * Correction path for an already-logged rooms-completed entry (2026-08-09).
   * Separate from logRoomsCompleted() above so POST's existing create-once/
   * 409-on-repeat contract is untouched. 404s if nothing has been logged yet.
   */
  updateRoomsCompleted: (id: string, input: LogRoomsCompletedInput) =>
    apiFetch<RoomsCompletedEntry>(`/assignments/${id}/rooms-completed`, {
      method: "PATCH",
      body: input,
    }),

  /**
   * Job Dispatch Phase 2 (Epic 9 PR 9.5, admin/manager/regional_manager):
   * places a worker directly on the calendar for a hotel+day — no broadcast/
   * accept cycle. Gated server-side by FEATURE_JOBDISPATCH_PHASE2 (404 while
   * disabled).
   */
  createCalendarEntry: (input: CreateCalendarEntryInput) =>
    apiFetch<CalendarEntryDto>("/assignments/calendar-entries", {
      method: "POST",
      body: input,
    }),

  listCalendarEntries: (query: ListCalendarEntriesQuery = {}) =>
    apiFetch<CalendarEntryDto[]>(`/assignments/calendar-entries${toQuery({ ...query })}`),

  /**
   * Calendar grid view (drag/drop scheduling): moves a placement to a new
   * day. Day-only — hotel and worker are unchanged (product decision,
   * 2026-08-05). Same flag/role gate as createCalendarEntry above.
   */
  moveCalendarEntry: (id: string, day: string) =>
    apiFetch<CalendarEntryDto>(`/assignments/calendar-entries/${id}/move`, {
      method: "PATCH",
      body: { day },
    }),

  /**
   * Atomic reassign (2026-08-05, admin/manager/regional_manager): replaces
   * the worker on a CONFIRMED/IN_PROGRESS assignment with a new one in one
   * request. hotel/day/job_request_id carry over unchanged from the old
   * assignment — this cannot move the shift to a different hotel or day,
   * only change who's staffing it.
   */
  reassign: (id: string, workerId: string) =>
    apiFetch<{ old_assignment: Assignment; new_assignment: Assignment }>(
      `/assignments/${id}/reassign`,
      { method: "POST", body: { worker_id: workerId } },
    ),
};

/**
 * Quality API matching the backend `/quality/*` routes. `status` on a
 * verification is always server-derived from `score`, never sent by this
 * client. One entry per assignment for each endpoint — a second POST 409s.
 */
export const qualityApi = {
  createVerification: (input: CreateVerificationInput) =>
    apiFetch<QualityVerification>("/quality/verifications", {
      method: "POST",
      body: input,
    }),

  createRating: (input: CreateRatingInput) =>
    apiFetch<Rating>("/quality/ratings", { method: "POST", body: input }),
};

/** Attendance API matching the backend `/attendance/*` routes. */
export const attendanceApi = {
  list: (query: ListAttendanceQuery = {}) =>
    apiFetch<Attendance[]>(
      `/attendance${toQuery({
        ...query,
        // `toQuery` skips booleans; serialise the verification filter explicitly.
        is_verified:
          query.is_verified === undefined
            ? undefined
            : String(query.is_verified),
      })}`,
    ),

  get: (id: string) => apiFetch<Attendance>(`/attendance/${id}`),

  /** Worker check-in for an assignment (backend RBAC: workers only). */
  checkIn: (input: CheckInInput) =>
    apiFetch<Attendance>("/attendance", { method: "POST", body: input }),

  update: (id: string, input: UpdateAttendanceInput) =>
    apiFetch<Attendance>(`/attendance/${id}`, { method: "PATCH", body: input }),

  /** Worker check-out: records the check-out time (defaults to now). */
  checkOut: (id: string, checkOutAt: string = new Date().toISOString()) =>
    attendanceApi.update(id, { check_out_at: checkOutAt }),

  /** Manager/checker verification: confirm the record, optionally set status. */
  verify: (id: string, status?: UpdateAttendanceInput["status"]) =>
    attendanceApi.update(id, {
      is_verified: true,
      ...(status ? { status } : {}),
    }),

  /** Manager/checker: set the attendance status (e.g. mark ABSENT/EXCUSED). */
  setStatus: (id: string, status: NonNullable<UpdateAttendanceInput["status"]>) =>
    attendanceApi.update(id, { status }),
};

/**
 * Geo check-ins API matching the backend `/geo/checkins/*` routes
 * (SPEC-GEO-001, GD-14). Read-only from the frontend: check-in itself is
 * worker-mobile-only. RBAC/hotel scoping (admin sees all, manager sees
 * hotels in their own scope) is enforced entirely backend-side.
 */
export const geoCheckinsApi = {
  list: (query: ListGeoCheckinsQuery = {}) =>
    apiFetch<GeoCheckin[]>(`/geo/checkins${toQuery({ ...query })}`),

  get: (id: string) => apiFetch<GeoCheckin>(`/geo/checkins/${id}`),
};

/**
 * Calendar API matching the backend `/calendar/*` routes (SPEC-CALENDAR-001,
 * ADR-021). Only the availability read-model is consumed here — sick/
 * vacation self-marking is a worker-mobile-only capability with no web
 * consumer. RBAC/group scoping (self always allowed; admin all; manager/
 * regional_manager via the worker's Hotel Group; checker denied) is enforced
 * entirely backend-side.
 */

export interface DailyShiftSummary {
  id: string;
  hotel_id: string;
  date: string;
  total_rooms: number;
  stay_over_rooms: number;
  checkout_rooms: number;
  total_people_working: number;
  notes: string | null;
  created_by_id: string;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export type DailyShiftSummaryPayload = Omit<
  DailyShiftSummary,
  "id" | "hotel_id" | "date" | "created_by_id" | "updated_by_id" | "created_at" | "updated_at"
>;
export const calendarApi = {
  getAvailability: (workerId: string) =>
    apiFetch<Availability>(`/calendar/availability${toQuery({ worker_id: workerId })}`),

  /** REQ-CAL-T02: the caller's own absences (self-scoped, no worker_id param). */
  listOwnAbsences: () => apiFetch<CalendarAbsence[]>("/calendar/my-absences"),

  /** REQ-CAL-T03/T04/T08: marks the caller absent for one day (self-scoped). */
  markOwnAbsence: (input: MarkAbsenceInput) =>
    apiFetch<CalendarAbsence>("/calendar/my-absences", { method: "POST", body: input }),

  /**
   * Calendar grid view (admin/manager/regional_manager): absences across the
   * caller's scoped team for a bounded date range.
   */
  listAbsences: (query: ListAbsencesQuery) =>
    apiFetch<CalendarAbsence[]>(`/calendar/absences${toQuery({ ...query })}`),

  /**
   * Manager/RM/admin marks or corrects an absence on a worker's behalf
   * (2026-08-08 feature) -- group-scoped server-side via
   * isWorkerInGroupScope, distinct from markOwnAbsence's self-service path.
   */
  markAbsenceForWorker: (input: MarkAbsenceForWorkerInput) =>
    apiFetch<CalendarAbsence>("/calendar/absences", { method: "POST", body: input }),

  /**
   * Drag-to-move on the calendar grid (2026-08-08 feature). Self-service
   * (the owning worker) or a manager/RM/admin acting on the worker's
   * behalf -- the backend's own ownership/group-scope check is the real
   * gate (no route-level role restriction beyond authentication).
   */
  moveAbsence: (id: string, day: string) =>
    apiFetch<CalendarAbsence>(`/calendar/absences/${id}/move`, {
      method: "PATCH",
      body: { day },
    }),

  /** Daily Shift Summary: list for a date range */
  listShiftSummaries: (hotelId: string, startDate: string, endDate: string) =>
    apiFetch<DailyShiftSummary[]>(
      `/calendar/hotels/${hotelId}/shift-summaries${toQuery({ start_date: startDate, end_date: endDate })}`
    ),

  /** Daily Shift Summary: upsert for a specific date */
  upsertShiftSummary: (hotelId: string, date: string, payload: DailyShiftSummaryPayload) =>
    apiFetch<DailyShiftSummary>(`/calendar/hotels/${hotelId}/shift-summaries/${date}`, {
      method: "PUT",
      body: payload,
    }),
};

/** Notifications API matching the backend `/notifications/*` routes. */
export const notificationsApi = {
  /** List the current user's notifications (newest first, backend-capped at 50). */
  list: () => apiFetch<Notification[]>("/notifications"),

  /** Mark a single notification as read; returns the updated record. */
  markAsRead: (id: string) =>
    apiFetch<Notification>(`/notifications/${id}/read`, { method: "POST" }),
};

/** Hotels API matching the backend `/crm/hotels/*` routes. */
export const hotelsApi = {
  list: (query: ListHotelsQuery = {}) =>
    apiFetch<Hotel[]>(`/crm/hotels${toQuery({ ...query })}`),

  get: (id: string) => apiFetch<Hotel>(`/crm/hotels/${id}`),

  create: (input: CreateHotelInput) =>
    apiFetch<Hotel>("/crm/hotels", { method: "POST", body: input }),

  update: (id: string, input: UpdateHotelInput) =>
    apiFetch<Hotel>(`/crm/hotels/${id}`, { method: "PATCH", body: input }),

  /** Soft-delete (deactivate) a hotel. Admin-only backend-side; returns 204. */
  /**
   * Soft delete: removes the hotel from operations but preserves history and
   * leaves it restorable. Never destroys the row -- a true purge, if ever
   * needed, is a separate operation.
   */
  remove: (id: string) =>
    apiFetch<void>(`/crm/hotels/${id}`, { method: "DELETE" }),

  // Entity lifecycle (2026-08-07). Deactivate/reactivate are the temporary,
  // reversible pair; restore is the inverse of remove().
  deactivate: (id: string) =>
    apiFetch<Hotel>(`/crm/hotels/${id}/deactivate`, { method: "POST" }),
  reactivate: (id: string) =>
    apiFetch<Hotel>(`/crm/hotels/${id}/reactivate`, { method: "POST" }),
  restore: (id: string) =>
    apiFetch<Hotel>(`/crm/hotels/${id}/restore`, { method: "POST" }),
};

/** Hotel Groups API matching the backend `/crm/hotel-groups/*` routes. */
export const hotelGroupsApi = {
  list: (query: ListHotelGroupsQuery = {}) =>
    apiFetch<HotelGroup[]>(`/crm/hotel-groups${toQuery({ ...query })}`),

  get: (id: string) => apiFetch<HotelGroup>(`/crm/hotel-groups/${id}`),

  create: (input: CreateHotelGroupInput) =>
    apiFetch<HotelGroup>("/crm/hotel-groups", { method: "POST", body: input }),

  update: (id: string, input: UpdateHotelGroupInput) =>
    apiFetch<HotelGroup>(`/crm/hotel-groups/${id}`, {
      method: "PATCH",
      body: input,
    }),

  /** Soft delete, as of 2026-08-07 -- previously destroyed the row. */
  remove: (id: string) =>
    apiFetch<void>(`/crm/hotel-groups/${id}`, { method: "DELETE" }),

  deactivate: (id: string) =>
    apiFetch<HotelGroup>(`/crm/hotel-groups/${id}/deactivate`, { method: "POST" }),
  reactivate: (id: string) =>
    apiFetch<HotelGroup>(`/crm/hotel-groups/${id}/reactivate`, { method: "POST" }),
  restore: (id: string) =>
    apiFetch<HotelGroup>(`/crm/hotel-groups/${id}/restore`, { method: "POST" }),
};

/** Analytics API matching the backend `/analytics/*` routes (manager/admin). */
export const analyticsApi = {
  /** Aggregate stats, optionally scoped to a single hotel. */
  stats: (hotelId?: string) =>
    apiFetch<DashboardStats>(`/analytics/stats${toQuery({ hotel_id: hotelId })}`),

  /** Worker leaderboard, optionally scoped to a single hotel. */
  leaderboard: (hotelId?: string) =>
    apiFetch<LeaderboardEntry[]>(
      `/analytics/leaderboard${toQuery({ hotel_id: hotelId })}`,
    ),

  /** Operational summary for a single hotel. */
  hotelSummary: (hotelId: string) =>
    apiFetch<HotelAnalyticsSummary>(`/analytics/hotel-summary/${hotelId}`),

  /**
   * GD-06: the caller's own stats (self-scoped, any authenticated role, no
   * `analytics:read` gate). A distinct shape from `stats()`, not the same
   * data filtered — resolves the mobile-worker dashboard's previously-
   * silent 403 against the admin/manager-only /stats route.
   */
  myStats: () => apiFetch<WorkerStats>("/analytics/my-stats"),
};

/** Users API matching the backend `/users/*` routes. */
export const usersApi = {
  list: (query: ListUsersQuery = {}) =>
    apiFetch<UserSummary[]>(`/users${toQuery({ ...query })}`),

  get: (id: string) => apiFetch<UserDetail>(`/users/${id}`),

  create: (input: CreateUserInput) =>
    apiFetch<UserDetail>("/users", { method: "POST", body: input }),

  /** Update a user's profile fields. The backend route is a PUT, not a PATCH. */
  update: (id: string, input: UpdateUserInput) =>
    apiFetch<UserDetail>(`/users/${id}`, { method: "PUT", body: input }),

  /**
   * Assign/change a user's role — the dedicated Admin-only endpoint
   * (ADR-030 D-4a). Distinct from `update()`: sending `role` to `PUT /users/:id`
   * is rejected at the backend's schema boundary once FEATURE_GD02_MATRIX is
   * on, and doesn't reach `regional_manager` even when it's off.
   */
  updateRole: (id: string, input: UpdateUserRoleInput) =>
    apiFetch<UserDetail>(`/users/${id}/role`, { method: "PUT", body: input }),

  /** Soft-delete (deactivate) a user account. Admin-only backend-side. */
  remove: (id: string) =>
    apiFetch<void>(`/users/${id}`, { method: "DELETE" }),

  /**
   * ADR-031 D-4: admin-only incident-response action. Bumps the account's
   * token_generation so every existing access/refresh token stops
   * validating — deliberately distinct from `remove()` (deactivate), which
   * this leaves untouched. Doesn't touch Session rows; that's logout's job.
   */
  revokeSessions: (id: string) =>
    apiFetch<{ message: string }>(`/users/${id}/revoke-sessions`, {
      method: "POST",
    }),
};

/**
 * Documents API matching the backend `/documents/*` routes
 * (SPEC-DOCUMENTS-001 @0.1.4 FROZEN, GD-16). GD-16's RBAC model: self-upload
 * (worker) + manager-upload only, hotel-scoped read via `checkWorkerScope()`
 * — enforced backend-side; this client passes `worker_id` through, never a
 * client-declared actor identity.
 */
export const documentsApi = {
  list: (workerId: string, category?: DocumentCategory) =>
    apiFetch<WorkerDocument[]>(
      `/documents/workers/${workerId}/documents${toQuery(category ? { category } : {})}`,
    ),

  get: (documentId: string) =>
    apiFetch<WorkerDocument>(`/documents/documents/${documentId}`),

  /**
   * `work_permit_required` has no backend source of truth (no field records
   * whether a worker needs one) — the caller declares it at query time, same
   * as the backend's own `IF-DOC-GetDocumentCompleteness` contract.
   */
  completeness: (workerId: string, workPermitRequired: boolean) =>
    apiFetch<DocumentCompleteness>(
      `/documents/workers/${workerId}/documents/completeness${toQuery({ work_permit_required: String(workPermitRequired) })}`,
    ),

  /**
   * Uploads a file for a worker. `file` is attached as the multipart `file`
   * field the backend's `upload.single('file')` middleware expects
   * (documents/routes.ts, PR #247); every other field in `input` is sent as
   * an accompanying form field. `file_size_bytes` is never sent — the
   * backend derives it server-side from the parsed file (RULE-DOC-09).
   */
  upload: (workerId: string, file: File, input: UploadDocumentInput) => {
    const form = new FormData();
    form.set("file", file);
    form.set("category", input.category);
    form.set("original_filename", input.original_filename);
    form.set("mime_type", input.mime_type);
    if (input.is_work_permit !== undefined) {
      form.set("is_work_permit", String(input.is_work_permit));
    }
    if (input.expires_at) form.set("expires_at", input.expires_at);

    return apiFetch<WorkerDocument>(`/documents/workers/${workerId}/documents`, {
      method: "POST",
      body: form,
    });
  },

  /**
   * 2026-08-13 (worker edit/replace fix): self-only on the backend
   * (documentService.deleteDocument — a worker may delete only their own
   * document; no other role is granted this route at all, so reviewers stay
   * view-only by construction). Delete-then-reupload is how "editing" works
   * for this immutable-file-object storage model.
   */
  delete: (documentId: string) =>
    apiFetch<{ deleted: boolean }>(`/documents/documents/${documentId}`, { method: "DELETE" }),
};

/**
 * HR — Payslip Requests API matching the backend `/hr/payroll` and
 * `/hr/payroll/:request_id/fulfil` routes (SPEC-HR-001 REVIEW @0.2.9,
 * ADR-039: request-tracking only, no payroll computation).
 */
export const hrApi = {
  listPayrollRequests: (query: ListPayslipRequestsQuery = {}) =>
    apiFetch<PayslipRequest[]>(`/hr/payroll${toQuery({ ...query })}`),

  /** Manager/Admin creates a payslip request on a worker's behalf. */
  createPayrollRequest: (input: CreatePayslipRequestInput) =>
    apiFetch<PayslipRequest>("/hr/payroll", { method: "POST", body: input }),

  /**
   * Worker self-service (POST /hr/payslip-requests, requireRole('worker')):
   * worker_id is always req.auth.userId server-side, never client-supplied
   * -- only the period is sent. Distinct endpoint from createPayrollRequest
   * above, which is the manager/admin-initiated equivalent.
   */
  requestPayslip: (input: { period_start: string; period_end: string }) =>
    apiFetch<PayslipRequest>("/hr/payslip-requests", { method: "POST", body: input }),

  /** Marks a REQUESTED payslip request as fulfilled (payslip emailed). */
  fulfilPayrollRequest: (requestId: string) =>
    apiFetch<PayslipRequest>(`/hr/payroll/${requestId}/fulfil`, {
      method: "POST",
    }),

  /**
   * IF-HR-GetContractStatus: the worker's most recent contract, or `null`
   * if none has been created yet. Worker self-access and Manager group-scope
   * are both enforced backend-side (OD-HR-10 / FIND-SEC-HR-03).
   */
  getContractStatus: (workerId: string) =>
    apiFetch<Contract | null>(`/hr/workers/${workerId}/contract-status`),

  /** Manager/Admin creates a contract (REQ-HR-001); requires a recorded Personalfragebogen. */
  createContract: (input: CreateContractInput) =>
    apiFetch<Contract>("/hr/contracts", { method: "POST", body: input }),

  /**
   * 2026-08-13 contract feature: URL for the single default contract PDF
   * (GET /hr/workers/:worker_id/contract-download). Not fetched as JSON —
   * `API_BASE_URL` is same-origin (lib/config.ts), so a direct navigation
   * (`window.open`/`<a href>`) carries the session cookie automatically and
   * the backend's `Content-Disposition: attachment` header triggers a
   * native browser download with no blob/fetch handling needed client-side.
   * Same worker-self / manager-RM-group-scope / admin-unscoped read gate as
   * getContractStatus (hr/routes.ts's requireContractReadAccess()).
   */
  defaultContractDownloadUrl: (workerId: string) =>
    `${API_BASE_URL}/hr/workers/${workerId}/contract-download`,

  /** IF-HR-UploadSignedContract: attaches the scanned signed contract file. */
  uploadSignedContract: (workerId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return apiFetch<Contract>(`/hr/workers/${workerId}/contract-scan`, {
      method: "POST",
      body: form,
    });
  },

  /** IF-HR-ConfirmContractSigned: Manager/Admin confirms the scanned contract, activating it. */
  confirmContractSigned: (workerId: string) =>
    apiFetch<Contract>(`/hr/workers/${workerId}/contract-confirm`, {
      method: "POST",
    }),

  /** RULE-HR-06/ADR-040: confirms continuation/permanence (PENDING/ACTIVE → EXTENDED/PERMANENT). */
  extendContract: (workerId: string) =>
    apiFetch<Contract>(`/hr/workers/${workerId}/contract-extend`, {
      method: "POST",
    }),

  /** RULE-HR-07/ADR-040 path (a): explicit manager "do not continue" action. */
  lapseContract: (workerId: string) =>
    apiFetch<Contract>(`/hr/workers/${workerId}/contract-lapse`, {
      method: "POST",
    }),
};

/**
 * Employee Management API (SPEC-EMP-001). `employee_id` is
 * employee-management's own human-facing identifier, distinct from a
 * `User.id` — `getByUserId` is the one lookup that resolves a `User.id` to
 * its `EmploymentRecord` (or `null` if the worker hasn't been onboarded yet);
 * every other method here is keyed by `employee_id`, which callers must
 * already know (e.g. from a prior `getByUserId`/`create` response).
 */
export const employeesApi = {
  /** Resolves a user's EmploymentRecord, or `null` if none exists yet (not a 404). Any role holding `employees:read` may call this; per-record visibility (self / group-scope / admin) is enforced service-side. */
  getByUserId: (userId: string) =>
    apiFetch<EmploymentRecord | null>(`/employees/by-user/${userId}`),

  /** Fetches the review queue for the current manager/admin (ADR-065). */
  getReviewQueue: () =>
    apiFetch<EmploymentRecord[]>('/employees/review-queue'),

  /** Creates the EmploymentRecord for an existing worker `User` (Admin-only). Starts `PENDING`. */
  create: (input: CreateEmploymentInput) =>
    apiFetch<EmploymentRecord>(`/employees`, { method: "POST", body: input }),

  /*
   * Lifecycle actions (REQ-EMP-002 rework, 2026-08-06). Replaces the old
   * single `lifecycleSignal` endpoint — see the ApproveEmploymentInput etc.
   * doc comments in lib/types.ts for why one endpoint per action.
   *
   * Permission split (ADR-030 §3 C-16 amendment): submit/approve/reject/
   * deactivate/reactivate/rehire admit Admin or a scoped Manager/Regional
   * Manager (their own hotel group). delete/restore stay Admin-only — they
   * cross the account boundary (soft-deletes/restores the User too).
   */

  /** PENDING -> PENDING (sets submitted_for_review_at; not a status change). */
  submitForReview: (employeeId: string) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/submit-for-review`, { method: "POST" }),

  /** PENDING -> ACTIVE. Fails if the record was never submitted for review. */
  approve: (employeeId: string, input: ApproveEmploymentInput = {}) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/approve`, { method: "POST", body: input }),

  /** Assigns an approved record (Manager/Regional Manager) to their target scope. */
  assign: (employeeId: string, input: AssignEmploymentInput) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/assign`, { method: "POST", body: input }),

  /** PENDING -> REJECTED. */
  reject: (employeeId: string, input: RejectEmploymentInput = {}) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/reject`, { method: "POST", body: input }),

  /** ACTIVE -> DEACTIVATED (temporary pause: leave/seasonal/suspension). Cancels future assignments. */
  deactivate: (employeeId: string, input: DeactivateEmploymentInput) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/deactivate`, { method: "POST", body: input }),

  /** DEACTIVATED -> ACTIVE, direct — the paused employee returns, no re-approval. */
  reactivate: (employeeId: string) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/reactivate`, { method: "POST" }),

  /** REJECTED -> ACTIVE, direct — a previously-declined applicant is taken on after all. */
  rehire: (employeeId: string) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/rehire`, { method: "POST" }),

  /** ACTIVE/DEACTIVATED/REJECTED -> DELETED (left the company). Admin-only; also soft-deletes the User account. */
  deleteEmployee: (employeeId: string, input: DeleteEmploymentInput) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/delete`, { method: "POST", body: input }),

  /** DELETED -> PENDING (a true rehire; re-approval required). Admin-only; also restores the User account. */
  restore: (employeeId: string) =>
    apiFetch<EmploymentRecord>(`/employees/${employeeId}/restore`, { method: "POST" }),

  listBlocklist: (hotelId: string) =>
    apiFetch<EmployeeBlocklistEntry[]>(`/employees/hotels/${hotelId}/blocklist`),

  /** Admin + Regional Manager (own group) only, gated on `org_chart:read` (ADR-060). */
  getOrgChart: (hotelGroupId: string) =>
    apiFetch<OrgChart>(`/employees/hotel-groups/${hotelGroupId}/org-chart`),

  /** Manager/Admin blocks an employee from assignment at this hotel; `reason` is required. */
  setBlocklist: (hotelId: string, input: SetBlocklistInput) =>
    apiFetch<EmployeeBlocklistEntry>(`/employees/hotels/${hotelId}/blocklist`, {
      method: "POST",
      body: input,
    }),
};

/**
 * Consent API matching the backend `/consent/*` routes (SPEC-CONSENT-001@0.2.0
 * FROZEN, ADR-015/ADR-037, GD-17). Every write is self-scoped — worker_id is
 * always the authenticated caller, never a client-supplied field.
 */
export const consentApi = {
  getStatus: (consentInstance: string) =>
    apiFetch<ConsentStatus>(`/consent/status${toQuery({ consent_instance: consentInstance })}`),

  /** Fetches the current notice to present before a decision (no decision is recorded). */
  requestNotice: (consentInstance: string, language?: string) =>
    apiFetch<ConsentNotice>("/consent/request", {
      method: "POST",
      body: { consent_instance: consentInstance, ...(language ? { language } : {}) },
    }),

  recordDecision: (input: RecordConsentDecisionInput) =>
    apiFetch<ConsentRecord>("/consent/decisions", { method: "POST", body: input }),

  /** Immediately supersedes today's grant — the next status check reads as `absent`. */
  withdraw: (consentInstance: string) =>
    apiFetch<ConsentRecord>("/consent/withdraw", {
      method: "POST",
      body: { consent_instance: consentInstance },
    }),
};

/**
 * Compliance API matching the backend `/compliance/*` routes
 * (SPEC-COMPLIANCE-001@0.1.0 REVIEW). Self-scoped only — no Admin/DPO-on-
 * behalf-of-worker caller class exists for this interface.
 */
export const complianceApi = {
  /** GDPR subject-rights export: the caller's own documents, consent history, and audit trail. */
  exportMyData: () =>
    apiFetch<SubjectRightsBundle>("/compliance/subject-rights-export", {
      method: "POST",
    }),
};

