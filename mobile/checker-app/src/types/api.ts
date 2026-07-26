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

export interface LeaderboardEntry {
  id: string;
  worker_id: string;
  average_score: number;
  total_ratings: number;
  total_assignments: number;
  completion_rate: number;
  on_time_rate: number;
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
