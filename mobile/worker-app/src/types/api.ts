// regional_manager added (ADR-030 PR-3, §6): the role exists at the backend
// (M-1) but is not yet promoted into for any user (M-3 gated by
// FEATURE_RM_ROLE, default off). Widened here so a future regional manager
// isn't rejected by this app's type surface.
export type UserRole = 'worker' | 'checker' | 'manager' | 'admin' | 'regional_manager';

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: { code: string; message: string };
  meta: { timestamp: string; request_id: string };
}

export type WorkRequestStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
export type ApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
export type AssignmentStatus = 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'REASSIGNED';
export type AttendanceStatus = 'EXPECTED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'PARTIAL' | 'EXCUSED';

// Lightweight projection of the requesting worker's own application, as
// (optionally) embedded on a WorkRequest payload. Intentionally narrower than
// WorkApplication: only the fields the worker-app consumes (apply state,
// status banner, withdraw action) are modeled here.
export interface MyApplicationSummary {
  id: string;
  status: ApplicationStatus;
  created_at: string;
}

export interface WorkRequest {
  id: string;
  hotel_id: string;
  hotel?: { id: string; name: string; address?: string };
  position: string;
  description?: string;
  workers_needed: number;
  workers_confirmed: number;
  shift_date: string; // ISO date string
  shift_start_time: string; // HH:mm
  shift_end_time: string; // HH:mm
  hourly_rate?: number;
  status: WorkRequestStatus;
  created_at: string;
  // Present only when the backend embeds the requesting worker's application.
  // Optional/null until the work-requests endpoint projects it.
  my_application?: MyApplicationSummary | null;
}

export interface WorkApplication {
  id: string;
  work_request_id: string;
  worker_id: string;
  status: ApplicationStatus;
  created_at: string;
  work_request?: WorkRequest;
}

export interface WorkerAssignment {
  id: string;
  work_request_id: string;
  worker_id: string;
  application_id: string;
  status: AssignmentStatus;
  created_at: string;
  work_request?: WorkRequest;
  attendance?: Attendance | null;
}

export interface Attendance {
  id: string;
  assignment_id: string;
  worker_id: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
  status: AttendanceStatus;
  notes?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
}

// Epic 7 PR 7.7: device push-token registration. Mirrors the backend's
// PushPlatform/PushApp enums (backend/prisma/schema.prisma). `app` identifies
// which mobile application minted the token — the Platform Worker needs it to
// pick the correct APNs topic, since the two apps have distinct bundle IDs
// (PR 7.8). Android ignores it; it is sent unconditionally so the backend row
// is complete regardless of platform.
export type PushPlatform = 'IOS' | 'ANDROID';
export type PushApp = 'WORKER' | 'CHECKER';

export interface PushToken {
  id: string;
  token: string;
  platform: PushPlatform;
  app: PushApp;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  worker_id: string;
  worker?: { id: string; first_name: string; last_name: string };
  average_rating: number;
  total_ratings: number;
  shifts_completed: number;
}

export interface DashboardStats {
  total_shifts: number;
  completed_shifts: number;
  upcoming_shifts: number;
  average_rating?: number;
  pending_applications: number;
}

// GD-06: matches backend WorkerStats (analytics/types.ts) exactly — the
// response shape of GET /analytics/my-stats.
export interface WorkerStats {
  completed_assignments: number;
  rooms_completed: number;
  average_rating: number | null;
  attendance: {
    total: number;
    present: number;
    late: number;
    absent: number;
  };
}

// GD-18 narrow slice (SPEC-CALENDAR-001 REQ-CAL-T02/T03/T04/T08) — matches
// backend CalendarAbsenceDto (calendar/types.ts) exactly. The response shape
// of GET/POST /calendar/my-absences.
export type CalendarAbsenceKind = 'SICK' | 'VACATION';

export interface CalendarAbsence {
  id: string;
  worker_id: string;
  day: string; // YYYY-MM-DD
  kind: CalendarAbsenceKind;
  created_at: string;
  updated_at: string;
}

// GD-14 (SPEC-GEO-001 TREQ-GEO-001/003/004) — matches backend GeoCheckinDto
// (geo/types.ts) exactly. The response shape of POST/GET /geo/checkins.
// Deliberately has no latitude/longitude fields: OD-GEO-005/RULE-GEO-003 --
// the backend never returns raw coordinates to any caller, worker included.
export interface GeoCheckin {
  id: string;
  worker_id: string;
  hotel_id: string;
  distance_meters: number;
  inside_radius: boolean;
  checked_at: string;
}

// Backend list endpoints return the array directly in body.data.
// Pagination metadata (page, per_page, total) is in body.pagination but
// is not extracted by the request() helper — use T[] for list calls.
export interface BackendPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}
