import type { AssignmentStatus, BadgeTone } from '@hotel-crm/mobile-shared';

/** Assignment status colour. CANCELLED and NO_SHOW are not the same fact. */
export function assignmentTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'IN_PROGRESS':
      return 'primary';
    case 'NO_SHOW':
      return 'danger';
    case 'CANCELLED':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * The status filter chips, and the ONLY list of them.
 *
 * The assignments screen declared its own array starting with 'ASSIGNED'
 * (2026-09-23). That is not a member of `AssignmentStatus` -- the stored
 * default is CONFIRMED -- so tapping the FIRST chip 400'd the whole list.
 * Typed against `AssignmentStatus` and pinned by a test, so the next
 * invented member fails at compile time rather than in a manager's hand.
 */
export const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'REASSIGNED',
];

/**
 * Localised label for an assignment status.
 *
 * Every surface rendered the raw enum -- "NO_SHOW", "IN_PROGRESS" -- which is
 * a database value, not a sentence, and is English-only in an app shipped in
 * six languages. `status.*` already carried confirmed/inProgress/completed/
 * cancelled; `noShow` and `reassigned` were added across all four catalogues
 * with them (2026-09-23).
 *
 * Unknown values fall through to the raw string rather than to a blank: an
 * enum nobody has translated yet still identifies the row.
 */
export function assignmentStatusLabel(
  status: string,
  t: (key: string) => string
): string {
  switch (status) {
    case 'CONFIRMED':
      return t('status.confirmed');
    case 'IN_PROGRESS':
      return t('status.inProgress');
    case 'COMPLETED':
      return t('status.completed');
    case 'CANCELLED':
      return t('status.cancelled');
    case 'NO_SHOW':
      return t('status.noShow');
    case 'REASSIGNED':
      return t('status.reassigned');
    default:
      return status;
  }
}

/**
 * An ISO timestamp as "YYYY-MM-DD HH:mm", in the DEVICE's zone.
 *
 * Several screens render the raw ISO string ("2026-09-23T04:12:07.881Z"),
 * which is unreadable and, worse, UTC: a manager reading 04:12 for a shift
 * that started at 06:12 Berlin time has been told the wrong thing.
 *
 * Local getters rather than `toLocaleString(..., { timeZone })`: Hermes ships
 * a trimmed Intl and a named zone is not reliably available on every device
 * this app runs on. Every user of this app is in `CALENDAR_TIMEZONE`
 * (Europe/Berlin), which is what their device is set to, so local IS Berlin
 * here -- stated explicitly because it is an assumption, not a guarantee.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/**
 * Localised label for a WORK REQUEST status.
 *
 * Distinct enum from `AssignmentStatus` and deliberately a separate function:
 * they share CANCELLED and nothing else, and one switch covering both is how
 * a shift ends up labelled "Partially filled".
 */
export function workRequestStatusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'DRAFT':
      return t('status.draft');
    case 'OPEN':
      return t('status.open');
    case 'PARTIALLY_FILLED':
      return t('status.partiallyFilled');
    case 'FILLED':
      return t('status.filled');
    case 'CANCELLED':
      return t('status.cancelled');
    case 'EXPIRED':
      return t('status.expired');
    default:
      return status;
  }
}
