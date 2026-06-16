export type UserRole = 'worker' | 'checker' | 'manager' | 'admin';

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
  my_application?: WorkApplication | null;
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
  check_in_time?: string;
  check_out_time?: string;
  status: AttendanceStatus;
  notes?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
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
