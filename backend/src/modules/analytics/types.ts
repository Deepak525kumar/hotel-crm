export interface LeaderboardEntry {
  worker_id: string;
  name: string;
  total_tasks: number;
  completed_tasks: number;
  average_rating: number;
  position: number;
}

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
  // ADR-028 (OQ-ANALYTICS-03): basic-analytics "rooms completed per worker"
  // metric, derived from RoomsCompletedEntry (manager-entered, one row per
  // worker's full-day WorkerAssignment) — no room-level task layer implied.
  rooms_completed: {
    total: number;
    entries: number;
  };
}

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
  // ADR-028 (OQ-ANALYTICS-03): basic-analytics "rooms completed per worker"
  // metric for this hotel, derived from RoomsCompletedEntry.
  rooms_completed: {
    total: number;
    entries: number;
  };
  top_workers: LeaderboardEntry[];
}
