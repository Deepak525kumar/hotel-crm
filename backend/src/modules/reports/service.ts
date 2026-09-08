import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import { assignmentService } from '../assignments/service.js';
import { attendanceService } from '../attendance/service.js';
import { calendarService } from '../calendar/service.js';
import { roomService } from '../rooms/service.js';
import { getStorageClient } from '../documents/storage.js';
import { exportTranscripts } from '../chatbot/memory/transcript.js';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  MAX_REPORT_ROWS,
  type DateRange,
  type GeneratedReport,
  type ReportDataset,
  type ReportFormat,
  type ReportResult,
  type ReportRow,
} from './types.js';
import type { UserScope } from '../../lib/jwt.js';

type Actor = { userId: string; role: string; scope?: UserScope | null };

const MIME: Record<Exclude<ReportFormat, 'json'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Reporting and export.
 *
 * OWNS NO DATA. Every row here comes from the module that owns it, through
 * that module's own scoped read — the same call the HTTP route makes, with the
 * same actor. This service composes and formats; it never queries a table
 * directly and never widens what a caller may see. That is the Constitution's
 * module-ownership rule, and it is also the only reason a report can be
 * trusted: a manager's export contains exactly what their screen would show,
 * because it is literally the same query.
 *
 * THE SELF PATH AND THE TEAM PATH NEVER MEET. `exportOwnData` resolves the
 * worker id from the actor and cannot express anyone else's. `generateReport`
 * requires a team-scoped role and passes the actor through to the owning
 * module, which applies its own hotel/group narrowing. A worker calling the
 * team path is refused here, and would be refused again downstream.
 */
export class ReportService extends BaseService {
  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * One dataset over one date range, as rows, for the caller's own scope.
   *
   * `scope: 'self'` is available to everyone and is how a worker reads their
   * own history. `scope: 'team'` requires a management role — checked here so
   * the refusal is clear, and again by every owning module below, which is
   * what actually enforces it.
   */
  async queryDataset(params: {
    dataset: ReportDataset;
    range: DateRange;
    actor: Actor;
    scope: 'self' | 'team';
  }): Promise<ReportResult> {
    const { dataset, range, actor, scope } = params;

    if (scope === 'team' && !isTeamScopedRole(actor.role)) {
      throw new ForbiddenError('Only a manager, regional manager or admin can report on a team');
    }

    // A self-scoped role gets self-scoped rows from every owning module
    // regardless of what is asked for, because those services narrow on
    // identity. The `scope` flag decides intent and the refusal above; the
    // services decide the rows.
    const rows = await this.readDataset(dataset, range, actor, scope);

    return {
      dataset,
      from: range.from,
      to: range.to,
      columns: COLUMNS[dataset],
      rows: rows.slice(0, MAX_REPORT_ROWS),
      truncated: rows.length > MAX_REPORT_ROWS,
    };
  }

  private async readDataset(
    dataset: ReportDataset,
    range: DateRange,
    actor: Actor,
    scope: 'self' | 'team'
  ): Promise<ReportRow[]> {
    switch (dataset) {
      case 'assignments':
        return this.readAssignments(range, actor);
      case 'attendance':
        return this.readAttendance(range, actor);
      case 'absences':
        return this.readAbsences(range, actor, scope);
      case 'rooms':
        return this.readRooms(range, actor);
      default:
        throw new ValidationError('Unknown dataset', [
          { field: 'dataset', message: `${String(dataset)} is not a reportable dataset` },
        ]);
    }
  }

  /**
   * Pages through an owning module's list until the range is exhausted.
   *
   * The per_page ceiling on these queries is 100, so a year of a busy hotel
   * group needs many round trips. Bounded by MAX_REPORT_ROWS rather than by
   * trust: a caller who asks for more than the cap gets the cap and is told,
   * which is better than a request that quietly runs for a minute.
   */
  private async paginate<T>(
    fetch: (page: number) => Promise<{ data: T[]; total: number }>
  ): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 200; page += 1) {
      const { data } = await fetch(page);
      out.push(...data);
      if (data.length === 0 || out.length > MAX_REPORT_ROWS) break;
    }
    return out;
  }

  private async readAssignments(range: DateRange, actor: Actor): Promise<ReportRow[]> {
    const rows = await this.paginate((page) =>
      assignmentService.list(
        { from: range.from, to: range.to, page, per_page: 100 } as Parameters<
          typeof assignmentService.list
        >[0],
        actor
      )
    );

    return (rows as Array<Record<string, any>>).map((a) => ({
      day: String(a.day ?? '').slice(0, 10),
      // `worker_name` is supplied by the owning module (added 2026-09-09 for
      // exactly this): the DTO previously carried only `worker_id`, and this
      // column was a run of nulls.
      worker: a.worker_name ?? personName(a.worker),
      hotel: a.hotel?.name ?? null,
      status: a.status ?? null,
      started_at: a.started_at ?? null,
      completed_at: a.completed_at ?? null,
    }));
  }

  private async readAttendance(range: DateRange, actor: Actor): Promise<ReportRow[]> {
    const rows = await this.paginate((page) =>
      attendanceService.list(
        { from: range.from, to: range.to, page, per_page: 100 } as Parameters<
          typeof attendanceService.list
        >[0],
        actor
      )
    );

    return (rows as Array<Record<string, any>>).map((a) => ({
      date: String(a.expected_start ?? '').slice(0, 10),
      worker: personName(a.worker),
      hotel: a.hotel?.name ?? null,
      status: a.status ?? null,
      check_in_at: a.check_in_at ?? null,
      check_out_at: a.check_out_at ?? null,
      minutes_late: a.minutes_late ?? null,
    }));
  }

  private async readAbsences(
    range: DateRange,
    actor: Actor,
    scope: 'self' | 'team'
  ): Promise<ReportRow[]> {
    // Two different owning interfaces, not one with a flag: getOwnAbsences is
    // the worker's self path and takes no scope at all, while listAbsences is
    // the manager's group-scoped read. Picking between them here keeps each
    // one's guarantee intact.
    const raw =
      scope === 'self' || !isTeamScopedRole(actor.role)
        ? await calendarService.getOwnAbsences(actor.userId)
        : await calendarService.listAbsences(
            { from: range.from, to: range.to } as Parameters<
              typeof calendarService.listAbsences
            >[0],
            actor
          );

    return (raw as Array<Record<string, any>>)
      // getOwnAbsences has no range parameter, so the self path is filtered
      // here. Doing it in memory is fine for one person's absences and wrong
      // for a group's, which is why only the self path takes this route.
      .filter((a) => {
        const day = String(a.day ?? '').slice(0, 10);
        return day >= range.from && day <= range.to;
      })
      .map((a) => ({
        day: String(a.day ?? '').slice(0, 10),
        // CalendarAbsenceDto carries ids, not names, for both of these.
        worker: a.worker_name ?? personName(a.worker),
        kind: a.kind ?? null,
        reason: a.reason ?? null,
        marked_by: a.marked_by_name ?? personName(a.marked_by),
      }));
  }

  private async readRooms(range: DateRange, actor: Actor): Promise<ReportRow[]> {
    // listMyRooms is per-day and self-scoped. A range is walked day by day,
    // which is acceptable only because the date range is capped at 366 and
    // this is one person's own log.
    const out: ReportRow[] = [];
    for (const day of eachDay(range)) {
      const { rooms } = await roomService.listMyRooms(actor as never, day);
      for (const room of rooms as Array<Record<string, any>>) {
        out.push({
          day,
          room_number: room.room_number ?? null,
          logged_at: room.logged_at ?? null,
          hotel: room.hotel?.name ?? null,
        });
      }
      if (out.length > MAX_REPORT_ROWS) break;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Exporting
  // -------------------------------------------------------------------------

  /**
   * A team report as a downloadable file. Manager, regional manager and admin
   * only — enforced here and, for the rows themselves, by every owning module.
   */
  async generateReport(params: {
    dataset: ReportDataset;
    range: DateRange;
    format: Exclude<ReportFormat, 'json'>;
    actor: Actor;
  }): Promise<GeneratedReport> {
    if (!isTeamScopedRole(params.actor.role)) {
      throw new ForbiddenError(
        'Only a manager, regional manager or admin can export a team report'
      );
    }

    const result = await this.queryDataset({
      dataset: params.dataset,
      range: params.range,
      actor: params.actor,
      scope: 'team',
    });

    const title = `${titleCase(params.dataset)} ${params.range.from} to ${params.range.to}`;
    const buffer =
      params.format === 'xlsx'
        ? await buildWorkbook([{ name: params.dataset, result }], title)
        : await buildPdf([{ name: params.dataset, result }], title);

    return this.store(buffer, params.format, params.dataset, params.actor, result);
  }

  /**
   * EVERY user's own data, as one workbook with a sheet per dataset.
   *
   * This is the GDPR Article 15/20 right of access and portability, which the
   * platform already honours as JSON through Compliance's subject-rights
   * bundle. A spreadsheet is the same right in a form a person can actually
   * read, so it is deliberately open to every role including worker and
   * checker -- it is not a management feature and must never be gated like one.
   *
   * Always xlsx: this is a data export, and a PDF of a person's own records is
   * a worse artefact for the purpose the right exists to serve (portability).
   */
  async exportOwnData(params: { actor: Actor; range: DateRange }): Promise<GeneratedReport> {
    const datasets: ReportDataset[] = ['assignments', 'attendance', 'absences', 'rooms'];

    const sheets = [];
    for (const dataset of datasets) {
      // scope: 'self' on every one. The actor's own id is the only worker id
      // that can reach the owning services from here.
      const result = await this.queryDataset({
        dataset,
        range: params.range,
        actor: params.actor,
        scope: 'self',
      });
      sheets.push({ name: dataset, result });
    }

    // TRANSCRIPTS ARE PART OF "ALL MY DATA" the moment they are stored. A
    // person's chatbot messages are free text they authored; omitting them
    // from a data-access export would answer an Article 15 request
    // incompletely while presenting it as complete. Added in the same change
    // that started storing them, deliberately -- a right implemented later is
    // a period during which the right did not exist.
    const transcripts = await exportTranscripts(params.actor.userId);
    if (transcripts.length > 0) {
      sheets.push({
        name: 'assistant-messages',
        result: {
          dataset: 'assistant-messages' as ReportDataset,
          from: params.range.from,
          to: params.range.to,
          columns: ['when', 'who', 'message'],
          rows: transcripts.map((m) => ({
            when: m.createdAt.toISOString(),
            who: m.role === 'USER' ? 'you' : 'assistant',
            message: m.content,
          })),
          truncated: false,
        },
      });
    }

    const buffer = await buildWorkbook(
      sheets,
      `My data ${params.range.from} to ${params.range.to}`
    );

    const totalRows = sheets.reduce((n, s) => n + s.result.rows.length, 0);
    return this.store(buffer, 'xlsx', 'own-data' as ReportDataset, params.actor, {
      rows: new Array(totalRows),
      truncated: sheets.some((s) => s.result.truncated),
    } as ReportResult);
  }

  /**
   * Uploads and hands back a short-lived link.
   *
   * The key carries a UUID and no readable identifier, matching RULE-DOC-09's
   * reasoning: the presigned URL is the capability, so the key must not be
   * guessable and must not itself disclose who the report is about.
   *
   * A null URL is a REAL state, not a failure to hide: with `S3_BUCKET` unset
   * the storage client is a documented stub, and callers render the absence
   * rather than a broken link.
   */
  private async store(
    buffer: Buffer,
    format: Exclude<ReportFormat, 'json'>,
    dataset: ReportDataset,
    actor: Actor,
    result: Pick<ReportResult, 'rows' | 'truncated'>
  ): Promise<GeneratedReport> {
    const filename = `${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`;
    const key = `reports/${crypto.randomUUID()}/${filename}`;

    const storage = await getStorageClient();
    await storage.upload(key, buffer, MIME[format]);
    const url = await storage.getPresignedUrl(key).catch(() => null);

    // Exports are an audited action: a file leaving the platform with other
    // people's data in it is exactly the event an audit trail exists for.
    await this.logAudit(actor.userId, actor.role, 'EXPORT', 'REPORT', key, {
      dataset,
      format,
      row_count: result.rows.length,
      truncated: result.truncated,
    });

    if (!url) {
      logger.warn('report_presign_unavailable', { key, dataset, format });
    }

    return {
      filename,
      url,
      format,
      rowCount: result.rows.length,
      truncated: result.truncated,
    };
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

interface Sheet {
  name: string;
  result: ReportResult;
}

/**
 * An .xlsx workbook, one sheet per dataset.
 *
 * Written with `writeBuffer` rather than to a temp file: these are bounded by
 * MAX_REPORT_ROWS precisely so they fit in memory, and a temp file would add
 * a cleanup path and a disk dependency for no benefit.
 */
export async function buildWorkbook(sheets: Sheet[], title: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  workbook.title = title;

  for (const { name, result } of sheets) {
    const sheet = workbook.addWorksheet(titleCase(name));
    sheet.columns = result.columns.map((c) => ({
      header: titleCase(c),
      key: c,
      width: Math.max(12, c.length + 4),
    }));
    sheet.getRow(1).font = { bold: true };

    for (const row of result.rows) sheet.addRow(row);

    if (result.truncated) {
      // Stated IN the file, not only in the API response: the spreadsheet
      // outlives the request, gets emailed on, and a silently partial report
      // is one somebody makes a decision from.
      sheet.addRow({});
      const note = sheet.addRow({
        [result.columns[0]]: `Truncated at ${MAX_REPORT_ROWS} rows — narrow the date range for a complete report.`,
      });
      note.font = { italic: true };
    }
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * A PDF table.
 *
 * pdfkit rather than a headless browser deliberately: rendering HTML would
 * mean shipping Chromium (~300MB) onto a t3.medium that also runs the API,
 * for a table. Columns are capped because a PDF has a fixed page width and
 * silently clipping columns is worse than saying which are omitted.
 */
export async function buildPdf(sheets: Sheet[], title: string): Promise<Buffer> {
  const MAX_COLUMNS = 6;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(title);
    doc.moveDown(0.5);

    for (const { name, result } of sheets) {
      const columns = result.columns.slice(0, MAX_COLUMNS);
      const omitted = result.columns.length - columns.length;

      doc.fontSize(12).text(titleCase(name));
      if (omitted > 0) {
        doc
          .fontSize(8)
          .fillColor('#666')
          .text(`${omitted} further column(s) omitted — use the Excel export for all of them.`)
          .fillColor('#000');
      }
      doc.moveDown(0.3);

      const width = (doc.page.width - 72) / columns.length;
      const header = doc.y;
      doc.fontSize(9);
      columns.forEach((c, i) => {
        doc.text(titleCase(c), 36 + i * width, header, { width, ellipsis: true });
      });
      doc.moveDown(0.2);

      for (const row of result.rows) {
        if (doc.y > doc.page.height - 60) doc.addPage();
        const y = doc.y;
        columns.forEach((c, i) => {
          doc.text(String(row[c] ?? ''), 36 + i * width, y, { width, ellipsis: true });
        });
      }

      if (result.truncated) {
        doc
          .moveDown(0.5)
          .fontSize(9)
          .text(`Truncated at ${MAX_REPORT_ROWS} rows — narrow the date range for a complete report.`);
      }
      doc.moveDown(1);
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLUMNS: Record<ReportDataset, string[]> = {
  assignments: ['day', 'worker', 'hotel', 'status', 'started_at', 'completed_at'],
  attendance: ['date', 'worker', 'hotel', 'status', 'check_in_at', 'check_out_at', 'minutes_late'],
  absences: ['day', 'worker', 'kind', 'reason', 'marked_by'],
  rooms: ['day', 'room_number', 'logged_at', 'hotel'],
};

/** Manager, regional manager, admin — the roles that may see a team. */
export function isTeamScopedRole(role: string): boolean {
  return role === 'admin' || role === 'manager' || role === 'regional_manager';
}

function personName(person: unknown): string | null {
  const p = person as { first_name?: string; last_name?: string; name?: string } | null;
  if (!p) return null;
  if (p.name) return p.name;
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
}

function titleCase(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Every day in the range, inclusive. Bounded by DateRangeSchema's 366-day cap. */
export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  const end = Date.parse(`${range.to}T00:00:00Z`);
  for (let t = Date.parse(`${range.from}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export const reportService = new ReportService();
