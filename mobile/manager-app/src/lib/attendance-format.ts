import type { Attendance, BadgeTone } from '@hotel-crm/mobile-shared';

/**
 * A person's name for an attendance row.
 *
 * The backend nests `worker` on the read paths specifically so a client does
 * not have to call /users/:id -- which is scoped against some callers and
 * would 403. Before those fields existed the checker app rendered
 * `Worker ···abc123`, the last six characters of a cuid, and a verifier could
 * not tell whose attendance they were looking at.
 *
 * Falls back to the id rather than to an empty string: an id is ugly but
 * identifies the row, and a blank line identifies nothing.
 */
export function personName(row: Attendance): string {
  if (row.worker) return `${row.worker.first_name} ${row.worker.last_name}`.trim();
  return row.worker_id;
}

/** Status colour, shared with the other apps' conventions. */
export function attendanceTone(status: string): BadgeTone {
  switch (status) {
    case 'PRESENT':
      return 'success';
    case 'LATE':
    case 'PARTIAL':
      return 'warning';
    case 'ABSENT':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Localised label for an attendance status.
 *
 * Same defect as the assignment statuses: the raw enum ("NO_SHOW", "PARTIAL")
 * was rendered straight to screen -- a database value, in English, in an app
 * shipped in six languages. `status.partial`, `status.excused` and
 * `status.expected` were added across all four catalogues for this
 * (2026-09-23); present/absent/late already existed.
 *
 * Unknown values fall through to the raw string: an untranslated enum still
 * identifies the row, a blank does not.
 */
export function attendanceStatusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'EXPECTED':
      return t('status.expected');
    case 'PRESENT':
      return t('status.present');
    case 'ABSENT':
      return t('status.absent');
    case 'LATE':
      return t('status.late');
    case 'PARTIAL':
      return t('status.partial');
    case 'EXCUSED':
      return t('status.excused');
    default:
      return status;
  }
}
