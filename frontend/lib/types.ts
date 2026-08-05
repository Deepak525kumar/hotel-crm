/**
 * Shared API types mirroring the backend response contract.
 *
 * The backend wraps every response in an envelope:
 *   success: { status: "success", data, meta }
 *   error:   { status: "error", error: { code, message } }
 */

/**
 * Roles emitted by the backend (always lower-cased on the wire).
 * `regional_manager` added for ADR-030 PR-3 (§6): the enum value itself
 * shipped in PR-2 (M-1), but no user holds it yet — M-3's promotion is
 * still behind `FEATURE_RM_ROLE` (default off). This widening exists so the
 * frontend doesn't reject/misrender a regional manager once one appears.
 */
export type Role = "worker" | "checker" | "manager" | "admin" | "regional_manager";

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  profile_photo_url?: string;
  role: Role;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  /** Access-token lifetime in seconds. */
  expires_in: number;
}

/** Payload of `POST /auth/login`. */
export type LoginResponse = AuthTokens & { user: AuthUser };

/** Payload of `POST /auth/refresh`. */
export type RefreshResponse = AuthTokens;

export interface ApiMeta {
  timestamp: string;
  request_id?: string;
}

export interface ApiSuccess<T> {
  status: "success";
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorBody {
  status: "error";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiErrorBody;

/**
 * Pagination metadata returned by the backend in a sibling envelope field.
 * `apiFetch` unwraps `data` only, so paging in the UI is driven client-side
 * (advance `page`, treat a full page as "there may be more").
 */
export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Users (directory-lite, used for manager/regional-manager selectors)       */
/* -------------------------------------------------------------------------- */

/**
 * A user as returned by `GET /users` (role lower-cased on the wire). Reused for
 * the CRM regional-manager selector and any future directory view. Mirrors the
 * backend user list DTO; `AuthUser` is the richer self-shape from `/auth/me`.
 */
export interface UserSummary {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  profile_photo_url: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/** A user with permissions, as returned by `GET /users/:id`. */
export interface UserDetail extends UserSummary {
  permissions: string[];
}

/** Body of `POST /users` (admin/manager). */
export interface CreateUserInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  /** Defaults to "worker" backend-side. */
  role?: Role;
}

/**
 * Body of `PUT /users/:id` (admin/manager/regional_manager, profile fields
 * only). `role` is NOT sent here: backend/src/modules/users/types.ts's
 * ADR-030 D-4a split makes this the profile-only route — under
 * FEATURE_GD02_MATRIX it validates against UpdateUserProfileSchema.strict(),
 * which rejects a `role` key at the schema boundary (400) rather than
 * silently ignoring it. Use `usersApi.updateRole()` for a role change.
 */
export interface UpdateUserInput {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Body of `PUT /users/:id/role` (admin-only, ADR-030 D-4a). */
export interface UpdateUserRoleInput {
  role: Role;
}

/** Query params accepted by `GET /users`. */
export interface ListUsersQuery {
  role?: Role;
  hotel_id?: string;
  search?: string;
  is_active?: "true" | "false";
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/*  CRM — Hotels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A hotel as returned by `GET /crm/hotels/:id`. List responses
 * (`GET /crm/hotels`) omit the contact/group/manager/deleted fields — the
 * backend `select` is narrower there — so treat those as present only on the
 * detail endpoint (same list-vs-detail split as {@link WorkRequest}).
 */
export interface Hotel {
  id: string;
  name: string;
  city: string;
  country: string;
  address: string;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  /** GD-05: per-hotel "pause new jobs" toggle, distinct from is_active. */
  accepting_jobs: boolean;
  hotel_group_id: string | null;
  manager_user_id: string | null;
  /** GD-14/OD-GEO-001 (SPEC-GEO-001): hotel-coordinate source of truth for
   * backend-geo's distance-check. Null until an admin sets it (OD-GEO-004). */
  latitude: number | null;
  longitude: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /crm/hotels`. */
export interface CreateHotelInput {
  name: string;
  city: string;
  address: string;
  /** Defaults to "Germany" backend-side. */
  country?: string;
  /** Defaults to "Europe/Berlin" backend-side. */
  timezone?: string;
  /** GD-14/OD-GEO-001/004: hotel-coordinate source of truth for the geofence check. */
  latitude?: number;
  longitude?: number;
}

/** Body of `PATCH /crm/hotels/:id`. */
export interface UpdateHotelInput {
  name?: string;
  city?: string;
  country?: string;
  address?: string;
  timezone?: string;
  is_active?: boolean;
  /** GD-05: per-hotel "pause new jobs" toggle, distinct from is_active. */
  accepting_jobs?: boolean;
  /** Group assignment is update-only (assigned after creation, ADR-023). */
  hotel_group_id?: string;
  /** GD-14/OD-GEO-004: admin-only manual entry, no geocoding service. */
  latitude?: number;
  longitude?: number;
}

/** Query params accepted by `GET /crm/hotels`. */
export interface ListHotelsQuery {
  search?: string;
  is_active?: "true" | "false";
  country?: string;
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/*  CRM — Hotel Groups                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A hotel group as returned by `GET /crm/hotel-groups` and `/:id`. Each group
 * has exactly one Regional Manager (ADR-023). The manager relation is not
 * embedded by the backend, so the UI resolves the name from the users list.
 */
export interface HotelGroup {
  id: string;
  name: string;
  billing_info: string | null;
  regional_manager_user_id: string;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /crm/hotel-groups` (admin-only). */
export interface CreateHotelGroupInput {
  name: string;
  regional_manager_user_id: string;
  billing_info?: string;
}

/** Body of `PATCH /crm/hotel-groups/:id` (admin-only). */
export interface UpdateHotelGroupInput {
  name?: string;
  regional_manager_user_id?: string;
  billing_info?: string;
}

/** Query params accepted by `GET /crm/hotel-groups`. */
export interface ListHotelGroupsQuery {
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/*  Analytics (manager/admin)                                                  */
/* -------------------------------------------------------------------------- */

/** A worker leaderboard row from `GET /analytics/leaderboard`. */
export interface LeaderboardEntry {
  worker_id: string;
  name: string;
  total_tasks: number;
  completed_tasks: number;
  average_rating: number;
  position: number;
}

/**
 * Aggregate platform (or per-hotel) statistics from `GET /analytics/stats`.
 * Mirrors the backend `DashboardStats` shape exactly.
 */
export interface DashboardStats {
  work_requests: {
    total: number;
    open: number;
    partially_filled: number;
    filled: number;
    cancelled: number;
    expired: number;
  };
  assignments: {
    total: number;
    completed: number;
    in_progress: number;
    no_show: number;
    cancelled: number;
  };
  attendance: {
    total: number;
    present: number;
    late: number;
    absent: number;
    on_time_rate: number;
  };
  quality: {
    total_verifications: number;
    average_score: number | null;
    pass_rate: number;
  };
  ratings: {
    total: number;
    average_score: number | null;
  };
  rooms_completed: {
    total: number;
    entries: number;
  };
}

/**
 * Matches backend `WorkerStats` (analytics/types.ts) exactly, GD-06. A
 * distinct shape from `DashboardStats`, not a filtered subset — the fields
 * available at worker scope aren't the same as at hotel/admin scope.
 * Warning counts and sick/vacation counts are explicitly deferred
 * (need GD-04's tiers and GD-18's Calendar respectively).
 */
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

/** Per-hotel operational summary from `GET /analytics/hotel-summary/:id`. */
export interface HotelAnalyticsSummary {
  hotel_id: string;
  open_requests: {
    count: number;
    workers_needed: number;
    workers_confirmed: number;
  };
  active_assignments: number;
  today_attendance: {
    expected: number;
    present: number;
    late: number;
    absent: number;
  };
  quality: {
    average_score: number | null;
    recent_pass_rate: number;
  };
  rooms_completed: {
    total: number;
    entries: number;
  };
  top_workers: LeaderboardEntry[];
}

/* -------------------------------------------------------------------------- */
/*  Work Requests                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Work request lifecycle. Mirrors the backend `WorkRequestStatus` enum
 * (PRISMA_SCHEMA_V2_FREEZE). DRAFT and OPEN are the only states the UI sets
 * directly; the rest are driven by the assignment pipeline or scheduled jobs
 * and are read-only here.
 */
export type WorkRequestStatus =
  | "DRAFT"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED";

/** A work request as returned by `GET /work-requests` and `/:id`. */
export interface WorkRequest {
  id: string;
  hotel_id: string;
  created_by_id: string;
  position: string;
  workers_needed: number;
  workers_confirmed: number;
  shift_date: string; // YYYY-MM-DD
  shift_start_time: string; // HH:MM
  shift_end_time: string; // HH:MM
  hourly_rate: number | null;
  currency: string;
  description: string | null;
  requirements: string | null;
  status: WorkRequestStatus;
  published_at: string | null;
  expires_at: string | null;
  filled_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  /** Present only for worker/checker roles on the detail endpoint. */
  my_application?: { id: string; status: string; created_at: string } | null;
  /**
   * Present (non-empty) only for a broadcast JobRequest raised via
   * `POST /work-requests/broadcasts` (Epic 9 PR 9.7); absent for a
   * marketplace publish/apply row.
   */
  skill_slots?: JobRequestSkillSlotDto[];
}

/** Body of `POST /work-requests`. */
export interface CreateWorkRequestInput {
  hotel_id: string;
  position: string;
  workers_needed: number;
  shift_date: string;
  shift_start_time: string;
  shift_end_time: string;
  hourly_rate?: number;
  currency?: string;
  description?: string;
  requirements?: string;
  /** A request may be created as a DRAFT or published straight to OPEN. */
  status?: "DRAFT" | "OPEN";
  expires_at?: string;
}

/** Body of `PATCH /work-requests/:id`. */
export interface UpdateWorkRequestInput {
  status?: WorkRequestStatus;
  cancellation_reason?: string;
}

/** Query params accepted by `GET /work-requests`. */
export interface ListWorkRequestsQuery {
  hotel_id?: string;
  status?: WorkRequestStatus;
  position?: string;
  shift_date?: string;
  /** Filters to broadcast rows only (true) or marketplace rows only (false). */
  is_broadcast?: boolean;
  page?: number;
  per_page?: number;
}

/* -------------------------------------------------------------------------- */
/*  Job Dispatch Phase 2 — Broadcasts (SPEC-JOB-DISPATCH-001@0.3.8,           */
/*  Epic 9 PRs 9.7-9.10; gated by FEATURE_JOBDISPATCH_PHASE2, default off)     */
/* -------------------------------------------------------------------------- */

/** Mirrors the backend `SkillTag` enum (prisma/schema.prisma). */
export type SkillTag = "CLEANER" | "PUBLIC_SERVICE" | "KITCHEN_DISHWASHER" | "WAITER";

/** Matches backend `JobRequestSkillSlotDto` (job-requests/types.ts) exactly. */
export interface JobRequestSkillSlotDto {
  id: string;
  skill: SkillTag;
  headcount: number;
  confirmed_count: number;
}

/** Body of `POST /work-requests/broadcasts` (admin/manager only). */
export interface RaiseBroadcastInput {
  hotel_id: string;
  shift_date: string; // YYYY-MM-DD
  shift_start_time: string; // HH:MM
  shift_end_time: string; // HH:MM
  hourly_rate?: number;
  currency?: string;
  description?: string;
  skills: { skill: SkillTag; headcount: number }[];
}

/**
 * Matches backend `SkillSlotEligibilityDto` (job-requests/types.ts) exactly —
 * `GET /work-requests/broadcasts/:id/eligibility`'s per-skill-slot breakdown.
 * Role-scoped: the backend route has no requireRole gate, so the response
 * itself never carries other workers' user ids (no `eligible_worker_ids`
 * field exists on the wire at all) — only an aggregate `eligible_count`
 * (present for every caller) and, for a worker/checker caller only, their
 * own `eligible` inclusion.
 */
export interface SkillSlotEligibilityDto {
  skill: SkillTag;
  headcount: number;
  confirmed_count: number;
  eligible_count: number;
  eligible?: boolean;
}

/** Matches backend `BroadcastEligibilityDto` exactly. */
export interface BroadcastEligibilityDto {
  job_request_id: string;
  hotel_id: string;
  shift_date: string; // YYYY-MM-DD
  slots: SkillSlotEligibilityDto[];
}

/** Body of `POST /work-requests/broadcasts/:id/accept` (any authenticated role — worker-initiated). */
export interface AcceptBroadcastInput {
  skill: SkillTag;
}

/**
 * Discriminated response of `POST /work-requests/broadcasts/:id/accept`,
 * mirrors backend `AcceptBroadcastResultDto` exactly. `requirement_fulfilled`
 * is a lost first-accept race (TREQ-005) — not an error, no assignment created.
 */
export type AcceptBroadcastResultDto =
  | { status: "accepted"; assignment_id: string; job_request_id: string; skill: SkillTag }
  | { status: "requirement_fulfilled"; job_request_id: string; skill: SkillTag };

/* -------------------------------------------------------------------------- */
/*  Assignments                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Assignment lifecycle. Mirrors the backend `AssignmentStatus` enum
 * (prisma/schema.prisma). The UI only ever drives the transitions the
 * backend allows: CONFIRMED → IN_PROGRESS/CANCELLED and
 * IN_PROGRESS → COMPLETED/CANCELLED. NO_SHOW and REASSIGNED are produced
 * by other backend flows and are read-only here.
 */
export type AssignmentStatus =
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED"
  | "REASSIGNED";

/**
 * A worker assignment as returned by `GET /assignments` and `/assignments/:id`.
 * Shape mirrors the backend `AssignmentDto`.
 */
export interface Assignment {
  id: string;
  work_request_id: string;
  worker_id: string;
  hotel_id: string;
  assigned_by_id: string;
  status: AssignmentStatus;
  confirmed_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  updated_at: string;
}

/** Query params accepted by `GET /assignments`. */
export interface ListAssignmentsQuery {
  hotel_id?: string;
  work_request_id?: string;
  worker_id?: string;
  status?: AssignmentStatus;
  page?: number;
  per_page?: number;
}

/** Body of `PATCH /assignments/:id`. */
export interface UpdateAssignmentInput {
  status?: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  cancellation_reason?: string;
}

/**
 * Matches backend `RoomsCompletedEntryDto` (assignments/types.ts) exactly,
 * ADR-028: manager-entered count for a worker's full-day assignment — not a
 * per-room/per-task record. One entry per assignment (backend enforces via a
 * unique constraint; a second POST 409s).
 */
export interface RoomsCompletedEntry {
  id: string;
  assignment_id: string;
  hotel_id: string;
  worker_id: string;
  entered_by_id: string;
  rooms_completed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /assignments/:id/rooms-completed`. */
export interface LogRoomsCompletedInput {
  rooms_completed: number;
  notes?: string;
}

/**
 * Job Dispatch Phase 2 (Epic 9 PR 9.5, TREQ-001/MIG-GAP-03): manager places a
 * worker directly on the calendar for a hotel+day — no broadcast/accept
 * cycle. Gated by FEATURE_JOBDISPATCH_PHASE2 (default off).
 */
export interface CreateCalendarEntryInput {
  worker_id: string;
  hotel_id: string;
  day: string; // YYYY-MM-DD
}

/** Query params accepted by `GET /assignments/calendar-entries`. */
export interface ListCalendarEntriesQuery {
  worker_id?: string;
  hotel_id?: string;
  /** Calendar grid view: bounded day range (YYYY-MM-DD), both or neither. */
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

/** Matches backend `CalendarEntryDto` (assignments/types.ts) exactly. */
export interface CalendarEntryDto {
  id: string;
  assignment_id: string;
  worker_id: string;
  hotel_id: string;
  day: string; // YYYY-MM-DD
  placed_by_id: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/*  Quality — Verifications & Ratings                                         */
/* -------------------------------------------------------------------------- */

export type VerificationStatus = "PASSED" | "FAILED" | "NEEDS_REWORK";

/**
 * Matches backend `QualityVerification` (Prisma model) exactly, returned
 * raw (no DTO wrapper). `status` is derived server-side from `score`
 * (>=70 PASSED, >=40 NEEDS_REWORK, else FAILED) — never client-supplied.
 * One entry per assignment; a second POST 409s (ConflictError).
 */
export interface QualityVerification {
  id: string;
  assignment_id: string;
  hotel_id: string;
  verified_by_id: string;
  score: number;
  status: VerificationStatus;
  notes: string | null;
  photo_urls: string[];
  rework_required: boolean;
  rework_notes: string | null;
  rework_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /quality/verifications`. */
export interface CreateVerificationInput {
  assignment_id: string;
  score: number;
  notes?: string;
}

/** Sub-scores schema per the backend's own `Rating.criteria_scores` comment (Prisma model). */
export interface RatingCriteriaScores {
  punctuality?: number;
  quality?: number;
  attitude?: number;
}

/**
 * Matches backend `Rating` (Prisma model) exactly, returned raw. `score` is
 * 0-100 (rescaled from 1-5 stars by ADR-026). One entry per assignment; a
 * second POST 409s (ConflictError).
 */
export interface Rating {
  id: string;
  assignment_id: string;
  hotel_id: string;
  worker_id: string;
  rated_by_id: string;
  score: number;
  comment: string | null;
  criteria_scores: RatingCriteriaScores | null;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /quality/ratings`. */
export interface CreateRatingInput {
  assignment_id: string;
  worker_id: string;
  score: number;
  comment?: string;
  criteria_scores?: RatingCriteriaScores;
}

/* -------------------------------------------------------------------------- */
/*  Attendance                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Attendance lifecycle. Mirrors the backend `AttendanceStatus` enum
 * (prisma/schema.prisma). EXPECTED is the pre-shift state set when the
 * record is created; check-in moves it to PRESENT or LATE. Managers may
 * additionally set ABSENT, PARTIAL or EXCUSED during verification.
 */
export type AttendanceStatus =
  | "EXPECTED"
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "PARTIAL"
  | "EXCUSED";

/** Statuses a manager may assign during verification (EXPECTED is pre-shift). */
export type AttendanceReviewStatus = Exclude<AttendanceStatus, "EXPECTED">;

/**
 * An attendance record as returned by `GET /attendance` and `/attendance/:id`.
 * Shape mirrors the backend `AttendanceDto`.
 */
export interface Attendance {
  id: string;
  assignment_id: string;
  worker_id: string;
  hotel_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  expected_start: string | null;
  expected_end: string | null;
  minutes_late: number | null;
  minutes_worked: number | null;
  notes: string | null;
  is_verified: boolean;
  verified_by_id: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Query params accepted by `GET /attendance`. */
export interface ListAttendanceQuery {
  hotel_id?: string;
  worker_id?: string;
  assignment_id?: string;
  status?: AttendanceStatus;
  is_verified?: boolean;
  page?: number;
  per_page?: number;
}

/* -------------------------------------------------------------------------- */
/*  Geo check-ins                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A geofence verification event as returned by `GET /geo/checkins` and
 * `/geo/checkins/:id`. Mirrors the backend `GeoCheckinDto` (SPEC-GEO-001,
 * GD-14). RULE-GEO-003/OD-GEO-005: latitude/longitude are never part of this
 * shape, on any endpoint or role — only the computed distance and pass/fail
 * result are ever returned. Do not add coordinate fields here.
 */
export interface GeoCheckin {
  id: string;
  worker_id: string;
  hotel_id: string;
  distance_meters: number;
  inside_radius: boolean;
  checked_at: string;
}

/** Query params accepted by `GET /geo/checkins`. */
export interface ListGeoCheckinsQuery {
  worker_id?: string;
  hotel_id?: string;
  page?: number;
  per_page?: number;
}

/* -------------------------------------------------------------------------- */
/*  Calendar (availability read-model)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Today-only red/green availability for one worker, as returned by
 * `GET /calendar/availability` (SPEC-CALENDAR-001 REQ-CAL-T06/RULE-CAL-08,
 * ADR-021). Independent of any viewed calendar date — there is no `day`
 * field to request or receive; the backend always answers for "today."
 */
export interface Availability {
  worker_id: string;
  available: boolean;
}

export type AbsenceKind = "SICK" | "VACATION";

/** Matches backend `CalendarAbsenceDto` (calendar/types.ts) exactly, REQ-CAL-T08. */
export interface CalendarAbsence {
  id: string;
  worker_id: string;
  day: string;
  kind: AbsenceKind;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /calendar/my-absences` (REQ-CAL-T02/T03: self-scoped, no worker_id field). */
export interface MarkAbsenceInput {
  day: string; // ISO date (YYYY-MM-DD)
  kind: AbsenceKind;
}

/**
 * Query params accepted by `GET /calendar/absences` (calendar grid view,
 * manager/regional_manager/admin, view-only — see calendar/types.ts
 * ListAbsencesQuerySchema).
 */
export interface ListAbsencesQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  worker_id?: string;
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Notification categories. Mirrors the backend `NotificationType` enum
 * (prisma/schema.prisma). Read-only on the web: notifications are produced by
 * backend flows and scheduled jobs; the UI only lists them and marks them read.
 */
export type NotificationType =
  | "WORK_REQUEST_PUBLISHED"
  | "WORK_REQUEST_CANCELLED"
  | "WORK_REQUEST_EXPIRING_SOON"
  | "APPLICATION_RECEIVED"
  | "APPLICATION_ACCEPTED"
  | "APPLICATION_REJECTED"
  | "APPLICATION_WITHDRAWN"
  | "ASSIGNMENT_CONFIRMED"
  | "ASSIGNMENT_CANCELLED"
  | "SHIFT_REMINDER"
  | "CHECK_IN_REMINDER"
  | "ATTENDANCE_VERIFIED"
  | "WORKER_NO_SHOW"
  | "QUALITY_VERIFICATION_SUBMITTED"
  | "RATING_RECEIVED"
  | "REWORK_REQUIRED";

/** Delivery channel. Mirrors the backend `NotificationChannel` enum. */
export type NotificationChannel = "IN_APP" | "EMAIL" | "PUSH" | "SMS";

/**
 * A notification as returned by `GET /notifications` (newest first, capped at
 * 50 by the backend). Shape mirrors the Prisma `Notification` model.
 */
export interface Notification {
  id: string;
  user_id: string;
  hotel_id: string | null;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  message: string;
  /** Resource ids for deep-linking; arbitrary JSON set by the backend. */
  data: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
  created_at: string;
}

/** Body of `POST /attendance` (worker check-in). */
export interface CheckInInput {
  assignment_id: string;
  notes?: string;
}

/**
 * Body of `PATCH /attendance/:id`. Workers may only set `check_out_at` and
 * `notes`; the remaining fields are manager/checker-only verification fields
 * enforced by the backend.
 */
export interface UpdateAttendanceInput {
  check_out_at?: string;
  notes?: string;
  status?: AttendanceReviewStatus;
  minutes_late?: number;
  minutes_worked?: number;
  is_verified?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Documents — SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16)                       */
/* -------------------------------------------------------------------------- */

export type DocumentCategory = "GENERAL" | "WORK_PERMIT";

/** Matches backend `WorkerDocumentDto` (documents/types.ts) exactly. */
export interface WorkerDocument {
  id: string;
  worker_id: string;
  uploaded_by_id: string;
  category: DocumentCategory;
  /** Short-lived S3 presigned GET URL; null if generation is deferred/unavailable. */
  presigned_url: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  expires_at: string | null;
  is_work_permit: boolean;
  created_at: string;
  updated_at: string;
}

/** GD-16 / REQ-DOC-002/005: response of `GET /workers/:id/documents/completeness`. */
export interface DocumentCompleteness {
  worker_id: string;
  work_permit_required: boolean;
  is_complete: boolean;
  missing_categories: DocumentCategory[];
  document_count: number;
}

/**
 * Form fields for `POST /documents/workers/:worker_id/documents` (multipart).
 * The file itself is attached separately as the `file` field — this covers
 * only the accompanying metadata fields the backend's Zod schema validates
 * (documents/validation.ts uploadDocumentSchema). file_size_bytes is
 * deliberately NOT here: the backend derives it server-side from the parsed
 * file (RULE-DOC-09), never from a client-supplied field.
 */
export interface UploadDocumentInput {
  category: DocumentCategory;
  original_filename: string;
  mime_type: string;
  is_work_permit?: boolean;
  expires_at?: string;
}

/* -------------------------------------------------------------------------- */
/*  HR — Payslip Requests (SPEC-HR-001 REVIEW @0.2.9, ADR-039)                 */
/* -------------------------------------------------------------------------- */

export type PayslipRequestStatus = "REQUESTED" | "FULFILLED";

/**
 * Matches backend `PayslipRequestDto` (hr/types.ts) exactly. ADR-039:
 * request-tracking only — backend-hr never computes or stores payroll
 * amounts, so this shape carries no salary/wage field.
 */
export interface PayslipRequest {
  id: string;
  worker_id: string;
  period_start: string;
  period_end: string;
  status: PayslipRequestStatus;
  fulfilled_by_id: string | null;
  fulfilled_at: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Query params accepted by `GET /hr/payroll`. */
export interface ListPayslipRequestsQuery {
  worker_id?: string;
  status?: PayslipRequestStatus;
}

/** Body of `POST /hr/payroll` (Manager/Admin creates a request on a worker's behalf). */
export interface CreatePayslipRequestInput {
  worker_id: string;
  period_start: string;
  period_end: string;
}

/* -------------------------------------------------------------------------- */
/*  HR — Contracts (SPEC-HR-001 REVIEW @0.2.9, ADR-039/ADR-040/ADR-044)        */
/* -------------------------------------------------------------------------- */

export type ContractStatus = "PENDING" | "ACTIVE" | "EXTENDED" | "PERMANENT";

/** Matches backend `ContractDto` (hr/types.ts) exactly. */
export interface Contract {
  id: string;
  worker_id: string;
  template_id: string;
  position: string;
  start_date: string;
  end_date: string | null;
  status: ContractStatus;
  scanned_document_id: string | null;
  confirmed_by_id: string | null;
  confirmed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Body of `POST /hr/contracts` (REQ-HR-001; no salary/compensation field, ADR-039). */
export interface CreateContractInput {
  worker_id: string;
  template_id: string;
  position: string;
  start_date: string;
  end_date?: string;
}

/* -------------------------------------------------------------------------- */
/*  Employee Management — Blocklist (SPEC-EMP-001, REQ-EMP-005/RULE-EMP-07)    */
/* -------------------------------------------------------------------------- */

/**
 * Matches backend `EmployeeBlocklistEntry` (Prisma model) exactly. Keyed by
 * `employee_id` — employee-management's own human-facing identifier
 * (`EmploymentRecord.employee_id`), distinct from a `User.id`. Use
 * `employeesApi.getByUserId` to resolve a `User.id` to its `employee_id` when
 * one is available; this entry shape itself still carries only `employee_id`.
 */
export interface EmployeeBlocklistEntry {
  id: string;
  hotel_id: string;
  employment_record_id: string;
  reason: string;
  created_by_id: string;
  created_at: string;
}

/** Body of `POST /employees/hotels/:hotel_id/blocklist` (RULE-EMP-07: reason required). */
export interface SetBlocklistInput {
  employee_id: string;
  reason: string;
}

/** Mirrors the backend `EmploymentStatus` enum (prisma/schema.prisma). */
export type EmploymentStatus = "INACTIVE" | "UNDER_REVIEW" | "ACTIVE" | "REJECTED" | "DEACTIVATED";

/**
 * General-profile view of `EmploymentRecord` (special-category fields
 * `konfession`/`disability_status` never included — REQ-EMP-007/RULE-EMP-09).
 * Returned by `GET /employees/by-user/:user_id` (`null` when no record exists
 * yet for that user — not a 404, matching `ContractDto | null`'s convention
 * for the same "may legitimately not exist" shape).
 */
export interface EmploymentRecord {
  id: string;
  user_id: string;
  employee_id: string;
  job_title: string;
  start_date: string;
  status: EmploymentStatus;
  marked_suitable: boolean;
  hotel_group_id: string | null;
  skills: SkillTag[];
  created_at: string;
  updated_at: string;
}

/** Minimal user reference shape returned inline by GetOrgChart. */
export interface OrgChartUserRef {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Response of `GET /employees/hotel-groups/:hotel_group_id/org-chart`
 * (REQ-EMP-013/RULE-EMP-08, ADR-060, ADR-030 §3 C-33). Admin + Regional
 * Manager only (own group); gated on `org_chart:read`.
 *
 * Flat, not a reporting tree (ADR-060 — no `reports_to` field is modeled):
 * the group's RM, its hotels each with their Hotel Manager, and its
 * employees, listed once at group grain (REQ-EMP-012 — EmploymentRecord has
 * no hotel_id, so an employee is not nested under any one hotel entry).
 */
export interface OrgChart {
  hotel_group_id: string;
  name: string;
  regional_manager: OrgChartUserRef | null;
  hotels: Array<{
    id: string;
    name: string;
    manager: OrgChartUserRef | null;
  }>;
  employees: Array<{
    employee_id: string;
    job_title: string;
    status: EmploymentStatus;
    user: { id: string; first_name: string; last_name: string };
  }>;
}

/** Body of `POST /employees` (Admin-only, REQ-EMP-001). */
export interface CreateEmploymentInput {
  user_id: string;
  employee_id: string;
  job_title: string;
  start_date: string;
  skills?: SkillTag[];
}

/** Body of `POST /employees/:employee_id/lifecycle-signal`. */
export interface LifecycleSignalInput {
  signal: "submitted_for_review" | "approved" | "rejected";
  /** Explicit fallback only — normally auto-resolved from the approving admin's own scope (ADR-023 §4). */
  hotel_group_id?: string;
}

/* -------------------------------------------------------------------------- */
/*  Consent (SPEC-CONSENT-001@0.2.0 FROZEN, ADR-015/ADR-037, GD-17)             */
/* -------------------------------------------------------------------------- */

/**
 * The recurring daily GDPR access-gate instance (RULE-CONSENT-01). The
 * other named instance, `chatbot-data-processing`, has no consuming module
 * yet (Chatbot is out of MVP scope) and is deliberately not surfaced here.
 */
export const DAILY_ACCESS_GATE_INSTANCE = "daily-access-gate";

/**
 * Matches backend `ConsentStatus` (consent/types.ts) exactly — a
 * discriminated result, not a thrown error for "no decision yet"
 * (RULE-CONSENT-06). `granted`/`declined` reflect the day's own decision;
 * a decision from a prior day or a superseded notice version reads as
 * `absent` again (RULE-CONSENT-02, evaluated server-side).
 */
export type ConsentStatus =
  | { status: "granted"; notice_version: string; decided_at: string }
  | { status: "declined"; notice_version: string; decided_at: string }
  | { status: "absent" };

/** Response of `POST /consent/request` — the current notice to present before a decision. */
export interface ConsentNotice {
  consent_instance: string;
  notice_version: string;
  notice_content: string;
  language: string;
  rtl: boolean;
}

/** Body of `POST /consent/decisions` (self-scoped; worker_id is never client-supplied). */
export interface RecordConsentDecisionInput {
  consent_instance: string;
  decision: "GRANTED" | "DECLINED";
  notice_version: string;
}

/** Matches backend `ConsentRecordDto` (consent/types.ts) exactly, RULE-CONSENT-05. */
export interface ConsentRecord {
  id: string;
  worker_id: string;
  consent_instance: string;
  notice_version: string;
  decision: "GRANTED" | "DECLINED" | "WITHDRAWN" | "RENEWED";
  decided_at: string;
}

/* -------------------------------------------------------------------------- */
/*  Compliance — Subject Rights Export (SPEC-COMPLIANCE-001@0.1.0 REVIEW)      */
/* -------------------------------------------------------------------------- */

/**
 * Matches backend `SubjectRightsSourceResult<T>` (compliance/types.ts)
 * exactly. One source module failing (e.g. storage unavailable) does not
 * fail the whole export — `status: "unavailable"` alongside `data: null` is
 * an expected, displayable outcome, not an error to throw on (OD-COMPLIANCE-005).
 */
export interface SubjectRightsSourceResult<T> {
  status: "ok" | "unavailable";
  data: T | null;
}

/** A single audit-log entry, as embedded in the subject-rights bundle (backend-auth's own DTO). */
export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  old_values: unknown;
  new_values: unknown;
  details: unknown;
  ip_address: string | null;
  timestamp: string;
}

/**
 * Matches backend `SubjectRightsBundle` (compliance/types.ts) exactly.
 * `POST /compliance/subject-rights-export` — self-scoped, no request body.
 * Retention is deliberately absent (it has no per-worker export interface,
 * only category/tier-metadata queries) — not an omission in this type.
 */
export interface SubjectRightsBundle {
  worker_id: string;
  generated_at: string;
  documents: SubjectRightsSourceResult<WorkerDocument[]>;
  consent_history: SubjectRightsSourceResult<{ data: ConsentRecord[]; total: number }>;
  audit_trail: SubjectRightsSourceResult<{ data: AuditLogEntry[]; total: number }>;
}
