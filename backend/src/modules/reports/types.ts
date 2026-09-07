import { z } from 'zod';

/**
 * Reporting: arbitrary date-range reads across the platform, and downloadable
 * exports of them.
 *
 * TWO AUDIENCES, TWO DIFFERENT RIGHTS, and the distinction is the whole
 * authorization model of this module:
 *
 *  - A MANAGER, REGIONAL MANAGER or ADMIN may report on THEIR TEAM, inside
 *    the scope they already hold, and may take that away as a file.
 *  - EVERY user, worker and checker included, may export THEIR OWN data.
 *    That is not a courtesy feature -- it is the GDPR Article 15/20 right of
 *    access and portability, which the platform already honours in JSON via
 *    Compliance's subject-rights bundle. This gives the same right a
 *    spreadsheet a person can actually read.
 *
 * The two never share a code path. `scope: 'self'` reports resolve the worker
 * id from the actor and cannot express anyone else's; `scope: 'team'` reports
 * go through each owning module's own scoped read, so a manager sees exactly
 * what they would see by hand and a worker cannot request one at all.
 */

/** What can be reported on. Each maps to one owning module's scoped read. */
export const ReportDatasetSchema = z.enum([
  'assignments',
  'attendance',
  'absences',
  'rooms',
]);

export type ReportDataset = z.infer<typeof ReportDatasetSchema>;

/** Output formats. `json` is the in-conversation answer; the others are files. */
export const ReportFormatSchema = z.enum(['json', 'xlsx', 'pdf']);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * A date range, bounded on both ends and capped in width.
 *
 * THE CAP IS NOT TASTE. An unbounded range is an unbounded query against
 * tables that grow with every shift on the platform, reachable from a chat
 * message -- "show me everything" would be a self-service table scan. 366 days
 * covers every real reporting question (a year, a quarter, a payroll period)
 * and refuses the one nobody actually needs.
 */
export const DateRangeSchema = z
  .object({ from: DAY, to: DAY })
  .refine((r) => r.from <= r.to, {
    message: 'from must not be after to',
    path: ['from'],
  })
  .refine(
    (r) => {
      const days =
        (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000;
      return days <= 366;
    },
    { message: 'range must be 366 days or fewer', path: ['to'] }
  );

export type DateRange = z.infer<typeof DateRangeSchema>;

export interface ReportRow {
  [column: string]: string | number | boolean | null;
}

export interface ReportResult {
  dataset: ReportDataset;
  from: string;
  to: string;
  /** Column order, so a spreadsheet is not at the mercy of key iteration. */
  columns: string[];
  rows: ReportRow[];
  /** True when the row cap trimmed the result, so callers can say so. */
  truncated: boolean;
}

export interface GeneratedReport {
  filename: string;
  /** Presigned, short-lived. Null when storage is stubbed (S3_BUCKET unset). */
  url: string | null;
  format: ReportFormat;
  rowCount: number;
  truncated: boolean;
}

/**
 * The row cap for a single report.
 *
 * Separate from the date cap and doing a different job: a 366-day range on a
 * busy hotel group is legitimately large, and this bounds the MEMORY of
 * building a workbook in-process. Exceeding it truncates and says so, rather
 * than silently returning a partial answer a manager might act on.
 */
export const MAX_REPORT_ROWS = 10_000;
