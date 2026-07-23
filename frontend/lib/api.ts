import { API_BASE_URL } from "@/lib/config";
import { useAuthStore } from "@/stores/auth";
import type {
  ApiEnvelope,
  Assignment,
  Attendance,
  AuthUser,
  CheckInInput,
  CreateHotelGroupInput,
  CreateHotelInput,
  CreateUserInput,
  CreateWorkRequestInput,
  DashboardStats,
  HotelAnalyticsSummary,
  LeaderboardEntry,
  Hotel,
  HotelGroup,
  ListApplicationsQuery,
  ListAssignmentsQuery,
  ListAttendanceQuery,
  ListHotelGroupsQuery,
  ListHotelsQuery,
  ListUsersQuery,
  ListWorkRequestsQuery,
  LoginResponse,
  Notification,
  RefreshResponse,
  UpdateApplicationInput,
  UpdateAssignmentInput,
  UpdateAttendanceInput,
  UpdateHotelGroupInput,
  UpdateHotelInput,
  UpdateUserInput,
  UpdateWorkRequestInput,
  UserDetail,
  UserSummary,
  WorkApplication,
  WorkRequest,
} from "@/lib/types";

/** Error thrown by {@link apiFetch} for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body. */
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

  const finalHeaders = new Headers(headers);
  if (body !== undefined && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(buildUrl(path), {
    ...rest,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Attempt a single transparent refresh + retry on unauthorized.
  if (res.status === 401 && auth && !_retried) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
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

/**
 * Work applications API, nested under a work request and matching the
 * backend `/work-requests/:id/applications/*` routes.
 */
export const workApplicationsApi = {
  list: (workRequestId: string, query: ListApplicationsQuery = {}) =>
    apiFetch<WorkApplication[]>(
      `/work-requests/${workRequestId}/applications${toQuery({ ...query })}`,
    ),

  update: (
    workRequestId: string,
    applicationId: string,
    input: UpdateApplicationInput,
  ) =>
    apiFetch<WorkApplication>(
      `/work-requests/${workRequestId}/applications/${applicationId}`,
      { method: "PATCH", body: input },
    ),

  /** Accept a PENDING application (claims a slot via the backend transaction). */
  accept: (workRequestId: string, applicationId: string) =>
    workApplicationsApi.update(workRequestId, applicationId, {
      status: "ACCEPTED",
    }),

  /** Reject a PENDING application with an optional reason. */
  reject: (workRequestId: string, applicationId: string, reason?: string) =>
    workApplicationsApi.update(workRequestId, applicationId, {
      status: "REJECTED",
      ...(reason ? { rejection_reason: reason } : {}),
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
};
