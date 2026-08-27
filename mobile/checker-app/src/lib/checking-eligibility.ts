import type { AttendanceRecord } from '@/types/api';

/**
 * Whether a checker may start inspecting rooms right now.
 *
 * The rule (owner decision, 2026-08-27): a checker must be checked in to a
 * shift to inspect, and once they check out of it they must not be able to
 * inspect any more. Checking is work, done on shift, and a room inspected by
 * someone who is off shift has no attendance behind it to account for.
 *
 * Pure and separate from the screen so it is testable: this project's jest
 * config collects logic from `.test.ts`, so a rule left inside a component is
 * untested by construction — and this one is a gate, not a detail.
 *
 * `NO_SHIFT_TODAY` and `NOT_CHECKED_IN` are deliberately distinct outcomes
 * even though both block. They need different words on screen: one is "you
 * are not scheduled", which nothing the checker does will fix, and the other
 * is "check in first", which is one tap away.
 */
export type CheckingBlockReason = 'NO_SHIFT_TODAY' | 'NOT_CHECKED_IN' | 'CHECKED_OUT';

export interface CheckingEligibility {
  allowed: boolean;
  reason: CheckingBlockReason | null;
  /** The attendance row backing the decision, so the caller can offer check-out. */
  attendanceId: string | null;
}

/** The local calendar day of an ISO timestamp, as YYYY-MM-DD. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * @param records rows from GET /attendance
 * @param today    YYYY-MM-DD in the device's local timezone
 * @param selfId   the signed-in checker's user id
 *
 * `selfId` is not optional, and the filtering it drives is the point.
 * GET /attendance is NOT self-scoped for a checker: the endpoint backs the
 * attendance-verification queue, so it returns other workers' rows too —
 * confirmed live, where a checker's own list came back holding a worker's row
 * alongside their own. Without this filter the gate reads someone else's
 * check-in as the checker's own and unlocks Start checking for a checker who
 * never checked in.
 */
export function resolveCheckingEligibility(
  records: readonly AttendanceRecord[],
  today: string,
  selfId: string
): CheckingEligibility {
  const own = records.filter((r) => r.worker_id === selfId);
  // Checked in *today*, not merely at some point: a check_in_at from a
  // previous shift that was never checked out would otherwise keep the
  // button live indefinitely.
  const todays = own.filter(
    (r) => r.check_in_at !== null && localDay(r.check_in_at) === today
  );

  if (todays.length === 0) {
    // Distinguish "no shift at all today" from "scheduled but not yet checked
    // in": an EXPECTED row exists for a scheduled shift before check-in.
    const scheduledToday = own.some(
      (r) => r.expected_start !== null && localDay(r.expected_start) === today
    );
    return {
      allowed: false,
      reason: scheduledToday ? 'NOT_CHECKED_IN' : 'NO_SHIFT_TODAY',
      attendanceId: null,
    };
  }

  // Still open wins over a closed one: a checker who checked out of a morning
  // shift and into an afternoon one is on shift, and the order rows arrive in
  // is not guaranteed.
  const open = todays.find((r) => r.check_out_at === null);
  if (open) {
    return { allowed: true, reason: null, attendanceId: open.id };
  }

  return { allowed: false, reason: 'CHECKED_OUT', attendanceId: todays[0].id };
}
