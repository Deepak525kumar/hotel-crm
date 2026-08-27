import type { BadgeTone } from '@/components/ui';

/**
 * One status -> colour mapping for attendance, shared by every screen.
 *
 * The queue screen previously carried a `statusColor()` returning raw hexes
 * (#22c55e / #f59e0b / #ef4444) painted as badge fills with white text. That
 * is the pattern constants/theme.ts exists to stop: the fills ignored the
 * colour scheme entirely, and white-on-amber fails contrast in either.
 */
export const ATTENDANCE_STATUS_TONE: Record<string, BadgeTone> = {
  PRESENT: 'success',
  EXCUSED: 'success',
  LATE: 'warning',
  PARTIAL: 'warning',
  ABSENT: 'danger',
  EXPECTED: 'neutral',
};

/** Falls back to neutral for a status this build does not know about. */
export function attendanceStatusTone(status: string): BadgeTone {
  return ATTENDANCE_STATUS_TONE[status] ?? 'neutral';
}
