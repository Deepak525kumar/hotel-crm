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
  creator_name?: string | null;
  manager_name?: string | null;
  /**
   * Chosen UI language, or null when never chosen — in which case the app
   * negotiates from the device's own languages instead of assuming German.
   */
  preferred_language?: string | null;
  employment_status?: string | null;
  /**
   * The actor's RESOLVED scope, as the login response carries it
   * (`backend/src/modules/auth/service.ts`). Present on the wire all along;
   * simply absent from this type because the worker app never had a use for
   * it.
   *
   * These are what a manager surface must branch on -- NOT `role`. A hotel
   * manager has `scope_hotel_id` set and no choice to make; an admin AND a
   * regional manager both have it null, which is why `role === 'admin'` is
   * the wrong test and puts an RM in the admin branch. An RM's own group is
   * `scope_hotel_group_id`; an admin has neither and sees everything.
   *
   * Server-derived at token issuance from `Hotel.manager_user_id` /
   * `HotelGroup.regional_manager_user_id`. Never client-writable, and never
   * a permission by itself -- every endpoint re-derives authorization.
   */
  scope_hotel_id?: string | null;
  scope_hotel_group_id?: string | null;
  /**
   * Never the raw S3 key -- just whether one exists. The bytes come from the
   * stable, cacheable `GET /users/:id/photo` route (components/UserAvatar.tsx).
   */
  has_profile_photo?: boolean;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * The quality state of a room the worker logged. Derived server-side from the
 * room's inspection -- never stored -- so this app and the checker's app can
 * never disagree about a room. Mirrors backend `modules/rooms/types.ts`.
 */
export type RoomState =
  /** Logged, not yet inspected. */
  | 'AWAITING_CHECK'
  /** Inspected and accepted. */
  | 'PASSED'
  /** Sent back by the checker; the worker has to fix it and upload evidence. */
  | 'NEEDS_REWORK'
  /** Fix submitted, room auto-passed; the checker may still reopen it. */
  | 'REWORK_SUBMITTED';

export interface RoomLog {
  id: string;
  assignment_id: string;
  hotel_id: string;
  hotel_name: string | null;
  worker_id: string;
  worker_name: string | null;
  day: string;
  room_number: string;
  state: RoomState;
  logged_at: string;
  verification_id: string | null;
  score: number | null;
  /**
   * The rework shift to open when this room needs fixing -- rework is a
   * separate assignment, not a state on the original one. Null unless the
   * state is NEEDS_REWORK.
   */
  rework_assignment_id: string | null;
  /** False once a checker has inspected the room: the log is then frozen. */
  editable: boolean;
}

export interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: { code: string; message: string };
  meta: { timestamp: string; request_id: string };
}

export type WorkRequestStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
export type AssignmentStatus = 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'REASSIGNED';
export type AttendanceStatus = 'EXPECTED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'PARTIAL' | 'EXCUSED';

export interface WorkRequest {
  id: string;
  hotel_id: string;
  hotel?: { id: string; name: string; address?: string };
  /** Which account role this request/broadcast is for (2026-08-27). */
  target_role: 'WORKER' | 'CHECKER';
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
}

/**
 * The hotel fields the API nests inside an assignment.
 *
 * Served this way because /crm/hotels/:id is scoped by the caller's hotel claim
 * and 403s for a worker assigned to that hotel, and /crm/hotels returns an
 * empty list for them — so this is the only way a worker can see where their
 * shift is. latitude/longitude are null for every hotel today, so map links
 * fall back to the address.
 */
export interface AssignmentHotel {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export interface WorkerAssignment {
  id: string;
  work_request_id: string;
  // ADR-069: set when this assignment is corrective rework for another one.
  // Both request FKs are null on a rework row, so without this the shift list
  // renders it as a generic "Shift" -- indistinguishable from real work, with
  // a 20-minute escalation clock the worker cannot see running.
  rework_of_assignment_id?: string | null;
  worker_id: string;
  status: AssignmentStatus;
  created_at: string;
  work_request?: WorkRequest;
  attendance?: Attendance | null;
  /**
   * Fields the API now nests on every assignment (list and detail).
   *
   * Before this, the DTO carried only ids and a status, so the shift screen
   * could show neither where nor when the shift was — it rendered hotel, date
   * and time only inside a `work_request` block, and every assignment in the
   * database is calendar-placed with work_request null. A worker opening a
   * shift saw a status and nothing else.
   */
  day?: string; // YYYY-MM-DD
  hotel?: AssignmentHotel | null;
  /** Null for calendar-placed shifts: times live on a JobRequest, and there is none. */
  shift_start_time?: string | null; // HH:mm
  shift_end_time?: string | null; // HH:mm
  assigned_by_name?: string | null;
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
/** Mirrors the backend's VerificationStatus enum. */
export type VerificationStatus = 'PASSED' | 'FAILED' | 'NEEDS_REWORK';

/**
 * One CHECK — a single room the checker inspected on a shift.
 *
 * The worker sees these below their shift detail (owner decision, 2026-08-29),
 * and opens one to the same screen the checker sees.
 */
export interface QualityCheck {
  id: string;
  assignment_id: string;
  day: string | null;
  assignment_status: AssignmentStatus | null;
  room_number: string;
  score: number;
  status: VerificationStatus;
  notes: string | null;
  criteria_scores: Record<string, number> | null;
  photo_count: number;
  rework_required: boolean;
  rework_notes: string | null;
  rework_completed_at: string | null;
  created_at: string;
  worker: { id: string; first_name: string; last_name: string } | null;
  hotel: { id: string; name: string; city: string } | null;
  checked_by: { id: string; first_name: string; last_name: string } | null;
  /**
   * Present when this check sent work back; drives the "go to your rework"
   * button. Points at the shift for the round still OPEN -- not the first
   * round's, which by round 2 is long completed.
   */
  rework_assignment: { id: string; status: AssignmentStatus; day: string } | null;
  /** Every attempt at fixing this room, oldest first (2026-08-30). */
  rework_rounds: ReworkRound[];
}

/**
 * One attempt at fixing a room the checker sent back.
 *
 * Each round owns its evidence. Before rounds, the worker's photos were
 * appended into the checker's own array with nothing marking the boundary, so
 * neither side could tell which pictures proved the fix.
 */
export interface ReworkRound {
  id: string;
  round_number: number;
  notes: string;
  assigned_at: string;
  completed_at: string | null;
  assignment_id: string | null;
  assigned_by?: { id: string; first_name: string; last_name: string } | null;
  photo_count: number;
  timer_started_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

/** A round with its evidence resolved to viewable URLs. */
export interface ReworkRoundPhotos {
  id: string;
  round_number: number;
  notes: string;
  assigned_at: string;
  completed_at: string | null;
  photos: { key: string; url: string | null }[];
  timer_started_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export type PushPlatform = 'IOS' | 'ANDROID';
export type PushApp = 'WORKER' | 'CHECKER' | 'MANAGER';

export interface PushToken {
  id: string;
  token: string;
  platform: PushPlatform;
  app: PushApp;
  user_id: string;
  created_at: string;
  updated_at: string;
}

// Shape of GET /quality/leaderboard (a WorkerOverallRating row), not the older
// /analytics/leaderboard DTO -- that route is admin/manager-only and applies no
// scoping, so this app never had access to it. `email` is deliberately absent:
// the backend strips it for worker and checker callers, who are looking at
// colleagues rather than reports.
/**
 * TREQ-003 tier label, derived server-side from the 0-100 score and never
 * stored. null when the worker has no ratings yet -- unrated is not a tier.
 */
export type RatingTier = 'ELITE' | 'HIGH' | 'STANDARD' | 'LOW' | 'PROBATION';

export interface LeaderboardEntry {
  id: string;
  worker_id: string;
  average_score: number;
  rating_tier: RatingTier | null;
  total_ratings: number;
  total_assignments: number;
  completion_rate: number;
  on_time_rate: number;
  // Shifts the worker stood themselves down from (declared sick/vacation).
  // A count, not a rate, and excluded from completion_rate on purpose.
  worker_cancellations: number;
  worker: {
    id: string;
    first_name: string;
    last_name: string;
    employment_record?: {
      primary_hotel?: { id: string; name: string } | null;
    } | null;
  };
}

/**
 * The subset of EmploymentRecord this app needs. `employee_id` is the
 * human-facing code (e.g. "EMP-W-001") that every /employees lifecycle
 * endpoint is keyed by — distinct from the user id, and not present on
 * /auth/me, so it has to be resolved via /employees/by-user/:userId.
 */
export interface EmploymentRecordDto {
  id: string;
  user_id: string;
  employee_id: string;
  job_title: string;
  start_date: string;
  status: string;
  submitted_for_review_at?: string | null;
}

/**
 * GET /analytics/stats — the manager/admin dashboard shape.
 *
 * CORRECTED 2026-09-22. This interface previously declared
 * `{ total_shifts, completed_shifts, upcoming_shifts, average_rating }`, and
 * not one of those four field names exists in the response. The backend has
 * always returned the nested shape below
 * (`backend/src/modules/analytics/types.ts`).
 *
 * Nothing caught it because nothing could: the type was written by hand to
 * describe an endpoint nobody had read back, so `tsc` cheerfully checked the
 * app against a fiction and every stat card rendered `undefined`. It is the
 * same failure mode as a test that fabricates a permission -- the code agrees
 * with itself and with nothing else.
 *
 * `analytics-contract.test.ts` now pins this against the backend's own
 * declaration at compile time, so the next divergence fails the build.
 *
 * worker-app and checker-app still carry the old, wrong copy. Deliberately
 * not changed here: they are in production, and a worker's call to this route
 * 403s before the shape ever matters (SIR-ANLY-002). Recorded in
 * mobile/shared/MIGRATION.md rather than fixed by reaching into a shipped app.
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
 * A row of GET /analytics/leaderboard.
 *
 * NOT the same as `LeaderboardEntry`, and the difference is not cosmetic.
 * There are two leaderboards in this system behind two different permission
 * tokens: `/quality/leaderboard` (`quality:read`) aggregates WorkerRating
 * rows and is what `LeaderboardEntry` describes, while this one
 * (`analytics:read`) counts tasks. Managers and RMs hold `analytics:read`
 * but NOT `quality:write`, and the two responses share only `worker_id` and
 * `rating_tier` -- so reading one with the other's type yields undefined in
 * every column that matters.
 */
export interface AnalyticsLeaderboardEntry {
  worker_id: string;
  name: string;
  total_tasks: number;
  completed_tasks: number;
  average_rating: number;
  /** TREQ-003 tier label derived from average_rating; null when unrated. */
  rating_tier: RatingTier | null;
  position: number;
}

/** GET /analytics/hotel-summary/:hotel_id */
export interface HotelSummary {
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
  top_workers: AnalyticsLeaderboardEntry[];
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

// Job Dispatch Phase 2 (SPEC-JOB-DISPATCH-001@0.3.8, gated by
// FEATURE_JOBDISPATCH_PHASE2): a broadcast is a WorkRequest that carries
// skill_slots — matches backend SkillTag (prisma/schema.prisma) exactly.
export type SkillTag = 'CLEANER' | 'PUBLIC_SERVICE' | 'KITCHEN_DISHWASHER' | 'WAITER';

export interface JobRequestSkillSlot {
  id: string;
  /** `null` means "no specific skill required" — open to every eligible worker (2026-08-26). */
  skill: SkillTag | null;
  headcount: number;
  confirmed_count: number;
}

// A broadcast row as returned by GET /work-requests (list/get) — same
// WorkRequest shape, plus skill_slots when the row is a broadcast (absent
// on a marketplace row).
export interface Broadcast extends WorkRequest {
  skill_slots?: JobRequestSkillSlot[];
}

// Matches backend SkillSlotEligibilityDto exactly — the response of
// GET /work-requests/broadcasts/:id/eligibility. Role-scoped server-side:
// the route has no requireRole gate, so no eligible_worker_ids field
// exists on the wire at all — a worker/checker caller instead gets
// `eligible`, their own inclusion for this slot only.
export interface SkillSlotEligibility {
  /** `null` means "no specific skill required" — open to every eligible worker (2026-08-26). */
  skill: SkillTag | null;
  headcount: number;
  confirmed_count: number;
  eligible_count: number;
  eligible?: boolean;
}

export interface BroadcastEligibility {
  job_request_id: string;
  hotel_id: string;
  shift_date: string; // YYYY-MM-DD
  slots: SkillSlotEligibility[];
}

// Matches backend AcceptBroadcastResultDto exactly — the discriminated
// response of POST /work-requests/broadcasts/:id/accept. A lost first-accept
// race returns `requirement_fulfilled`, not an error — no assignment is
// created, and the caller must not treat this as a failure.
export type AcceptBroadcastResult =
  | { status: 'accepted'; assignment_id: string; job_request_id: string; skill: SkillTag | null }
  | { status: 'requirement_fulfilled'; job_request_id: string; skill: SkillTag | null };

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

// SPEC-DOCUMENTS-001@0.1.4 FROZEN (GD-16). Matches backend WorkerDocumentDto
// exactly (backend/src/modules/documents/types.ts).
/**
 * Mirrors the backend `DocumentCategory` enum (prisma/schema.prisma) exactly.
 *
 * There is deliberately no `GENERAL` member. One used to exist here and on no
 * server: it was the UploadDocumentCard's DEFAULT selection, so any worker who
 * picked a file and uploaded without touching the category dropdown got a 422
 * ("Invalid enum value ... received 'GENERAL'") every single time. Adding a
 * catch-all here again silently breaks uploads on the default path.
 */
export type DocumentCategory = 'WORK_PERMIT' | 'TAX_NUMBER' | 'SOCIAL_SECURITY_NUMBER' | 'HEALTH_INSURANCE' | 'ID_CARD' | 'PASSPORT' | 'ADDRESS' | 'CONTRACT_SCAN';

export interface WorkerDocument {
  id: string;
  worker_id: string;
  uploaded_by_id: string;
  category: DocumentCategory;
  // null when URL generation is deferred/unavailable in this environment.
  presigned_url: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  expires_at: string | null;
  is_work_permit: boolean;
  created_at: string;
  updated_at: string;
}

// SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015/ADR-037, GD-17). Matches backend
// consent/types.ts exactly. Only the daily-access-gate instance is consumed
// here — chatbot-data-processing has no consuming module yet (Chatbot is
// unbuilt, out of MVP scope), matching frontend/lib/types.ts's identical
// exclusion.
export const DAILY_ACCESS_GATE_INSTANCE = 'daily-access-gate';

// Discriminated result, not a thrown error for "no decision yet"
// (RULE-CONSENT-06). A decision from a prior day or a superseded notice
// version reads as `absent` again (RULE-CONSENT-02, evaluated server-side).
export interface DocumentCompleteness {
  worker_id: string;
  work_permit_required: boolean;
  is_complete: boolean;
  missing_categories: DocumentCategory[];
  categories: Record<DocumentCategory, boolean>;
  document_count: number;
}

export type ConsentStatus =
  | { status: 'granted'; notice_version: string; decided_at: string }
  | { status: 'declined'; notice_version: string; decided_at: string }
  | { status: 'absent' };

// Response of POST /consent/request — the current notice to present before
// a decision (no decision is recorded by this call). notice_content is
// confirmed plain text server-side (no markdown/HTML), rendered verbatim.
export interface ConsentNotice {
  consent_instance: string;
  notice_version: string;
  notice_content: string;
  language: string;
  rtl: boolean;
}

// Body of POST /consent/decisions (self-scoped; worker_id is never
// client-supplied).
export interface RecordConsentDecisionInput {
  consent_instance: string;
  decision: 'GRANTED' | 'DECLINED';
  notice_version: string;
}

export interface ConsentRecord {
  id: string;
  worker_id: string;
  consent_instance: string;
  notice_version: string;
  decision: 'GRANTED' | 'DECLINED' | 'WITHDRAWN' | 'RENEWED';
  decided_at: string;
}

// HR / Payroll / Contract
export type ContractStatusType = 'PENDING' | 'ACTIVE' | 'EXTENDED' | 'PERMANENT';

export interface ContractDto {
  id: string;
  worker_id: string;
  template_id: string;
  position: string;
  start_date: string;
  end_date: string | null;
  status: ContractStatusType;
  scanned_document_id: string | null;
  confirmed_by_id: string | null;
  confirmed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PayslipRequestStatusType = 'REQUESTED' | 'FULFILLED';

export interface PayslipRequestDto {
  id: string;
  worker_id: string;
  period_start: string;
  period_end: string;
  status: PayslipRequestStatusType;
  fulfilled_by_id: string | null;
  fulfilled_at: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePayslipRequestRequest {
  period_start: string;
  period_end: string;
}

// ---------------------------------------------------------------------------
// Chatbot. Behind FEATURE_CHATBOT, off in production — every /chatbot/* route
// 404s until it is enabled, which is a supported state, not an error.
// ---------------------------------------------------------------------------

/** A quick-reply chip. Tapping one costs ZERO model tokens — L0 resolves it. */
export interface ChatbotCommandDto {
  id: string;
  label: string;
  tool: string;
}

export interface ChatbotConversationDto {
  id: string;
  status: string;
}

/**
 * One of the caller's own earlier conversations, for History (2026-09-15).
 * `opening` is their own first message, shortened -- never an assistant reply.
 */
export interface ChatbotConversationSummaryDto {
  id: string;
  started_at: string;
  status: string;
  opening: string | null;
  message_count: number;
}

/** One of the caller's own conversations, both sides, read back. */
export interface ChatbotTranscriptDto {
  id: string;
  messages: { role: 'user' | 'assistant'; text: string; at: string }[];
}

/**
 * One turn.
 *
 * Field names are camelCase because the API returns its TurnResult object
 * as-is. The web client typed these as snake_case at first, which made
 * `pendingConfirmation` permanently undefined and left high-risk writes with
 * no Confirm button — unapprovable, with nothing on screen explaining why.
 */
export interface ChatbotTurnDto {
  reply: string;
  status: string;
  route: 'L0' | 'L1' | 'L3' | 'none';
  toolInvoked?: string;
  pendingConfirmation?: {
    token: string;
    summary: string;
    toolName: string;
  };
}

/**
 * A generated report or personal export.
 *
 * `url` is a short-lived presigned link, and is `null` when file storage is
 * unconfigured on the server -- a real state, not an error, which callers
 * must render rather than turning into a dead link.
 */
export interface GeneratedReportDto {
  filename: string;
  url: string | null;
  format: 'xlsx' | 'pdf';
  rowCount: number;
  truncated: boolean;
}

