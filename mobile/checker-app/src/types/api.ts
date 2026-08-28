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
   * The checker's chosen UI language, or null when they have never chosen
   * one. Null is meaningful: it means negotiate from the device's own
   * locales rather than assume the platform default. Mirrors the worker
   * app's identical field and the backend's `User.preferred_language`.
   */
  preferred_language?: string | null;
  /**
   * ADR-065: the onboarding gate is universal for non-Admin roles, checkers
   * included. Absent for admins, who hold no EmploymentRecord by design.
   */
  employment_status?: string | null;
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

// Kept in step with the backend's own enums (schema.prisma). Both of these
// were short of a value the API can actually return: AttendanceStatus was
// missing EXCUSED and AssignmentStatus was missing NO_SHOW and REASSIGNED.
// A missing member is not a compile error at the call site — it is a status
// arriving at runtime that every exhaustive map and badge silently has no
// case for. worker-app's copies already carried the full sets.
export type AttendanceStatus =
  | 'EXPECTED'
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'PARTIAL'
  | 'EXCUSED';

export interface AttendanceRecord {
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
  /**
   * Nested by the API on the read paths. Before this the DTO carried only ids
   * and the queue screen rendered `Worker ···{worker_id.slice(-6)}` — the tail
   * of a cuid — so a checker could not tell whose attendance they were
   * verifying, or at which hotel. Optional because the mutation responses
   * (verify/check-in) do not populate them.
   */
  worker?: { id: string; first_name: string; last_name: string } | null;
  hotel?: { id: string; name: string; city: string } | null;
  verified_by_name?: string | null;
}

export type AssignmentStatus =
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'REASSIGNED';

export interface Assignment {
  id: string;
  work_request_id: string;
  worker_id: string;
  hotel_id: string;
  assigned_by_id: string;
  status: AssignmentStatus;
  confirmed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export type VerificationStatus = 'PASSED' | 'FAILED' | 'NEEDS_REWORK';

export interface QualityVerification {
  id: string;
  assignment_id: string;
  hotel_id: string;
  verified_by_id: string;
  score: number;
  status: VerificationStatus;
  notes: string | null;
  created_at: string;
  // CRR §14 rework state. Present on the record fetched by
  // api.quality.getVerification(); the evidence screen reads these to decide
  // whether "Assign rework" is still offered.
  rework_required?: boolean;
  rework_notes?: string | null;
  rework_completed_at?: string | null;
  rework_escalated_at?: string | null;
  /**
   * Whose work, where, when, and who inspected it — nested by
   * GET /quality/verifications/:id.
   *
   * The evidence screen previously showed a score, a status and photos with no
   * indication of any of it, and could not resolve the names itself:
   * /crm/hotels/:id is scoped and 403s for a checker.
   */
  assignment?: {
    worker_id: string;
    day: string;
    worker?: { id: string; first_name: string; last_name: string } | null;
  } | null;
  hotel?: { id: string; name: string; city: string } | null;
  verified_by?: { id: string; first_name: string; last_name: string } | null;
}

export interface Rating {
  id: string;
  assignment_id: string;
  hotel_id: string;
  worker_id: string;
  rated_by_id: string;
  score: number;
  comment: string | null;
  created_at: string;
}

/**
 * One row of the checker's own inspection history
 * (GET /quality/my-inspections).
 *
 * Keyed by the SHIFT, not by either record: `Rating` and `QualityVerification`
 * are separate 1:1 records on the same assignment, written by two different
 * actions (the checklist score and the pass/fail check), so a shift may carry
 * either or both. Either field being null means "this checker did not record
 * that kind of inspection for this shift" — the server filters both by the
 * caller's own authorship, so a colleague's record on the same shift arrives
 * as null rather than as the caller's own.
 *
 * Photo COUNTS, not keys: the presigned URLs live 15 minutes, so they are
 * fetched per record by the evidence screens rather than carried in a list.
 */
export interface OwnInspection {
  assignment_id: string;
  day: string;
  worker: { id: string; first_name: string; last_name: string } | null;
  hotel: { id: string; name: string; city: string } | null;
  rating: {
    id: string;
    score: number;
    comment: string | null;
    criteria_scores: Record<string, number> | null;
    photo_count: number;
    created_at: string;
  } | null;
  verification: {
    id: string;
    score: number;
    status: VerificationStatus;
    notes: string | null;
    photo_count: number;
    rework_required: boolean;
    rework_notes: string | null;
    rework_completed_at: string | null;
    created_at: string;
  } | null;
}

export interface OwnInspectionsPage {
  inspections: OwnInspection[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
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
  // A plain count, not a rate, and excluded from completion_rate on purpose --
  // a self-declared absence is not a failed shift.
  worker_cancellations: number;
  worker: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  };
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

/**
 * Self-declared sick/vacation day. The backend's /calendar/my-absences
 * endpoints carry no role gate -- self-scope IS the authorization -- so a
 * Checker has always been permitted to declare one; only this client was
 * missing. `worker_id` is the backend's field name for the absence's owner
 * whatever their role, not a claim that the owner is a Worker.
 */
export type CalendarAbsenceKind = 'SICK' | 'VACATION';

export interface CalendarAbsence {
  id: string;
  worker_id: string;
  day: string; // YYYY-MM-DD
  kind: CalendarAbsenceKind;
  created_at: string;
  updated_at: string;
}


// --- Ported from worker-app (2026-08-18): the consent/documents/hr screens
// in this app imported these types, which had never existed here. They were
// invisible because tsconfig.test.json never included src/app/** — see the
// CI include fix in the same change.
export const DAILY_ACCESS_GATE_INSTANCE = 'daily-access-gate';

export interface ConsentNotice {
  consent_instance: string;
  notice_version: string;
  notice_content: string;
  language: string;
  rtl: boolean;
}

export type ConsentStatus =
  | { status: 'granted'; notice_version: string; decided_at: string }
  | { status: 'declined'; notice_version: string; decided_at: string }
  | { status: 'absent' };

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

// Must equal the server's Prisma enum -- guarded by
// __tests__/document-categories-match-server.test.ts. This union carried
// GENERAL, RESIDENCE_PERMIT and DRIVERS_LICENSE, none of which the server
// accepts, and was missing the four it requires.
export type DocumentCategory = 'WORK_PERMIT' | 'TAX_NUMBER' | 'SOCIAL_SECURITY_NUMBER' | 'HEALTH_INSURANCE' | 'ID_CARD' | 'PASSPORT' | 'ADDRESS' | 'CONTRACT_SCAN';

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

export type ContractStatusType = 'PENDING' | 'ACTIVE' | 'EXTENDED' | 'PERMANENT';


export interface ConsentRecord {
  id: string;
  worker_id: string;
  consent_instance: string;
  notice_version: string;
  decision: 'GRANTED' | 'DECLINED' | 'WITHDRAWN' | 'RENEWED';
  decided_at: string;
}

export interface RecordConsentDecisionInput {
  consent_instance: string;
  decision: 'GRANTED' | 'DECLINED';
  notice_version: string;
}

export interface CreatePayslipRequestRequest {
  period_start: string;
  period_end: string;
}

export interface EmploymentRecordDto {
  id: string;
  user_id: string;
  employee_id: string;
  job_title: string;
  start_date: string;
  status: string;
  submitted_for_review_at?: string | null;
}

export interface DocumentCompleteness {
  worker_id: string;
  work_permit_required: boolean;
  is_complete: boolean;
  missing_categories: DocumentCategory[];
  categories: Record<DocumentCategory, boolean>;
  document_count: number;
}

// --- Ported from worker-app (2026-08-27) ---
// A checker works a shift exactly as a worker does: the same assignments, the
// same attendance, the same stats. These types were worker-app-only because
// the checker app had no Home, Schedule or Attendance screen to need them.
// Kept identical to worker-app's copies deliberately — the two apps read the
// same endpoints, and a divergent local shape here would be a silent decoding
// bug rather than a compile error.
//
// worker-app's `Attendance` is deliberately NOT ported: this app already had
// `AttendanceRecord` for the same payload, and the two disagreed (`notes` is
// nullable in one and optional in the other). One shape per endpoint.
export type WorkRequestStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';

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
  /** AttendanceRecord, not a second local shape — see the note above. */
  attendance?: AttendanceRecord | null;
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

/** A row in the Start-checking worker picker (ADR-072 §2.5). */
export interface InspectableWorker {
  assignment_id: string;
  worker_id: string;
  /** Null when the user record no longer resolves — render a label, never an id fragment. */
  worker_name: string | null;
  hotel_id: string;
  hotel_name: string | null;
  status: AssignmentStatus;
}
