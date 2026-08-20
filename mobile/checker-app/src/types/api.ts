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

export type AttendanceStatus = 'EXPECTED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'PARTIAL';

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
}

export type AssignmentStatus = 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

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

export type DocumentCategory = 'GENERAL' | 'WORK_PERMIT';

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
