import { API_BASE_URL } from "@/lib/config";
import { useAuthStore } from "@/stores/auth";
import type {
  ApiEnvelope,
  Assignment,
  Attendance,
  AuthUser,
  Availability,
  CalendarAbsence,
  CheckInInput,
  CreateHotelGroupInput,
  CreateHotelInput,
  CreateContractInput,
  CreatePayslipRequestInput,
  CreateUserInput,
  CreateWorkRequestInput,
  DashboardStats,
  HotelAnalyticsSummary,
  LeaderboardEntry,
  GeoCheckin,
  Hotel,
  HotelGroup,
  Contract,
  ListAssignmentsQuery,
  ListAttendanceQuery,
  ListGeoCheckinsQuery,
  ListHotelGroupsQuery,
  ListHotelsQuery,
  ListPayslipRequestsQuery,
  ListUsersQuery,
  ListWorkRequestsQuery,
  LoginResponse,
  LogRoomsCompletedInput,
  MarkAbsenceInput,
  Notification,
  PayslipRequest,
  RefreshResponse,
  RoomsCompletedEntry,
  UpdateAssignmentInput,
  UpdateAttendanceInput,
  UpdateHotelGroupInput,
  UpdateHotelInput,
  UpdateUserInput,
  UpdateWorkRequestInput,
  UserDetail,
  UserSummary,
  WorkRequest,
  WorkerDocument,
  DocumentCategory,
  DocumentCompleteness,
  UploadDocumentInput,
  EmployeeBlocklistEntry,
  SetBlocklistInput,
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
 * Calls the backend refresh endpoint with the stored refresh token.
 * On success the new tokens are written to the store; on failure the
 * session is cleared. Returns the new access token, or `null`.
 *
 * A module-level promise de-duplicates concurrent refreshes so a burst
 * of 401s only triggers a single refresh request.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const { refreshToken, setTokens, clear } = useAuthStore.getState();
    if (!refreshToken) {
      clear();
      return null;
    }

    try {
      const res = await fetch(buildUrl("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const envelope = await parseEnvelope<RefreshResponse>(res);
      if (!res.ok || envelope.status === "error") {
        clear();
        return null;
      }
      setTokens(envelope.data);
      return envelope.data.access_token;
    } catch {
      clear();
      return null;
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
 * - Attaches the bearer access token unless `auth: false`.
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
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(buildUrl(path), {
    ...rest,
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
      const newToken = await refreshAccessToken();
      if (newToken) {
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

  logout: (refreshToken: string | null) =>
    apiFetch<{ message: string }>("/auth/logout", {
      method: "POST",
      body: refreshToken ? { refresh_token: refreshToken } : {},
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
  list: (query: ListWorkRequestsQuery = {}) =>
    apiFetch<WorkRequest[]>(`/work-requests${toQuery({ ...query })}`),

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
   * assignment. No GET counterpart exists backend-side — the created entry
   * is only ever known from this call's own response, not re-fetchable.
   * A second call for the same assignment 409s (ConflictError).
   */
  logRoomsCompleted: (id: string, input: LogRoomsCompletedInput) =>
    apiFetch<RoomsCompletedEntry>(`/assignments/${id}/rooms-completed`, {
      method: "POST",
      body: input,
    }),
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
export const calendarApi = {
  getAvailability: (workerId: string) =>
    apiFetch<Availability>(`/calendar/availability${toQuery({ worker_id: workerId })}`),

  /** REQ-CAL-T02: the caller's own absences (self-scoped, no worker_id param). */
  listOwnAbsences: () => apiFetch<CalendarAbsence[]>("/calendar/my-absences"),

  /** REQ-CAL-T03/T04/T08: marks the caller absent for one day (self-scoped). */
  markOwnAbsence: (input: MarkAbsenceInput) =>
    apiFetch<CalendarAbsence>("/calendar/my-absences", { method: "POST", body: input }),
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
  remove: (id: string) =>
    apiFetch<void>(`/crm/hotels/${id}`, { method: "DELETE" }),
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

  remove: (id: string) =>
    apiFetch<void>(`/crm/hotel-groups/${id}`, { method: "DELETE" }),
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
};

/** Users API matching the backend `/users/*` routes. */
export const usersApi = {
  list: (query: ListUsersQuery = {}) =>
    apiFetch<UserSummary[]>(`/users${toQuery({ ...query })}`),

  get: (id: string) => apiFetch<UserDetail>(`/users/${id}`),

  create: (input: CreateUserInput) =>
    apiFetch<UserDetail>("/users", { method: "POST", body: input }),

  /** Update a user. The backend route is a PUT, not a PATCH. */
  update: (id: string, input: UpdateUserInput) =>
    apiFetch<UserDetail>(`/users/${id}`, { method: "PUT", body: input }),

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
 * Employee Management — Blocklist API matching the backend
 * `/employees/hotels/:hotel_id/blocklist` routes (SPEC-EMP-001, REQ-EMP-005 /
 * RULE-EMP-07). `employee_id` is employee-management's own human-facing
 * identifier, not a `User.id` — no lookup endpoint resolves one from the
 * other today, so callers must already know it.
 */
export const employeesApi = {
  listBlocklist: (hotelId: string) =>
    apiFetch<EmployeeBlocklistEntry[]>(`/employees/hotels/${hotelId}/blocklist`),

  /** Manager/Admin blocks an employee from assignment at this hotel; `reason` is required. */
  setBlocklist: (hotelId: string, input: SetBlocklistInput) =>
    apiFetch<EmployeeBlocklistEntry>(`/employees/hotels/${hotelId}/blocklist`, {
      method: "POST",
      body: input,
    }),
};
