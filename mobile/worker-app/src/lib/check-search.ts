import type { QualityCheck, WorkerAssignment } from '@/types/api';

/**
 * Filtering for the checks on one shift (owner decision, 2026-08-30: search
 * wherever there are multiple entries).
 *
 * Client-side, unlike the checker's history, and deliberately: one shift's
 * checks are already loaded on the device, so filtering over the network would
 * add a round-trip to every keystroke to search a list we are holding. The
 * checker's history is the opposite case -- it pages over every check they
 * have ever written, which cannot be held on the device.
 */

/**
 * Below this many checks a search box is noise rather than help. A shift with
 * three rooms is read by scrolling; one with a hundred is not.
 */
export const SEARCH_THRESHOLD = 5;

/**
 * Room number, the checker's note, or the outcome -- whichever the worker
 * happens to remember.
 *
 * `statusLabel` is passed in already translated rather than matched against
 * `check.status`: the worker sees "NEEDS REWORK" (or its German or Urdu
 * equivalent) on the row, and typing what is on the screen has to find it.
 * Matching the raw enum would work in English only, by coincidence.
 */
export function matchesCheck(check: QualityCheck, q: string, statusLabel: string): boolean {
  const needle = q.trim().toLowerCase();
  // An empty or whitespace-only box is not a filter that matches nothing; it
  // is no filter at all.
  if (needle === '') return true;
  return (
    check.room_number.toLowerCase().includes(needle) ||
    (check.notes ?? '').toLowerCase().includes(needle) ||
    statusLabel.toLowerCase().includes(needle)
  );
}

/**
 * Filtering for the worker's own shift list (owner decision, 2026-08-30).
 *
 * Same client-side reasoning as matchesCheck: the list is one already-loaded
 * page, so filtering it over the network would add a round-trip per keystroke.
 *
 * `statusLabel` is again passed in translated -- the worker searches for the
 * word printed on the card, not the enum behind it. The hotel may be absent on
 * a calendar-placed shift, and the day may be absent on an older row, so both
 * are treated as empty rather than assumed present.
 */
export function matchesShift(
  shift: WorkerAssignment,
  q: string,
  statusLabel: string
): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  const hotel = shift.hotel;
  return (
    (hotel?.name ?? '').toLowerCase().includes(needle) ||
    (hotel?.city ?? '').toLowerCase().includes(needle) ||
    // The raw YYYY-MM-DD, so "2026-08" finds a month and "08-30" a day. The
    // card shows a formatted date, but the ISO form is what someone scanning
    // for a specific date actually types.
    (shift.day ?? '').toLowerCase().includes(needle) ||
    statusLabel.toLowerCase().includes(needle)
  );
}
