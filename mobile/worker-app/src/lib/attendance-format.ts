import type { Attendance } from '@/types/api';

/** Worked duration in whole minutes, or null while a shift is still open. */
export function workedMinutes(a: Attendance): number | null {
  if (!a.check_in_at || !a.check_out_at) return null;
  const ms = new Date(a.check_out_at).getTime() - new Date(a.check_in_at).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

/** "7h 30m" / "45m". Null durations render as an em dash by the caller. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
