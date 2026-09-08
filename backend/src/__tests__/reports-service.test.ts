import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Reporting and export.
 *
 * The property this module lives or dies by is the SPLIT between two rights
 * that look similar and are not:
 *
 *   - reporting on a TEAM is a management capability, because the rows are
 *     other people's hours, absences and names;
 *   - exporting YOUR OWN data is a GDPR Article 15/20 right held by every
 *     role, and gating it like a management feature would be gating a right.
 *
 * A bug that let the first collapse into the second would hand a worker their
 * colleagues' records. A bug the other way would deny someone a legal right.
 * Both directions are tested.
 */

const mockListAssignments = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListAttendance = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockOwnAbsences = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListAbsences = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListMyRooms = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpload = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockPresign = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { list: mockListAssignments },
}));
jest.mock('../modules/attendance/service.js', () => ({
  attendanceService: { list: mockListAttendance },
}));
jest.mock('../modules/calendar/service.js', () => ({
  calendarService: { getOwnAbsences: mockOwnAbsences, listAbsences: mockListAbsences },
}));
jest.mock('../modules/rooms/service.js', () => ({
  roomService: { listMyRooms: mockListMyRooms },
}));
jest.mock('../modules/documents/storage.js', () => ({
  getStorageClient: async () => ({
    upload: mockUpload,
    getPresignedUrl: mockPresign,
  }),
}));
jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    warn: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    debug: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    error: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
  },
}));
jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({ auditLog: { create: async () => ({}) } }),
}));

import ExcelJS from 'exceljs';
import { ReportService, buildWorkbook, eachDay, isTeamScopedRole } from '../modules/reports/service.js';
import { DateRangeSchema, MAX_REPORT_ROWS } from '../modules/reports/types.js';
import { ForbiddenError } from '../lib/errors.js';

const RANGE = { from: '2026-08-01', to: '2026-08-31' };

const actor = (role: string) => ({ userId: 'u1', role, scope: null });

describe('the date range', () => {
  it('accepts a normal reporting window', () => {
    expect(DateRangeSchema.safeParse(RANGE).success).toBe(true);
  });

  it('refuses a reversed range rather than returning nothing', () => {
    // Silently empty is the wrong answer: a manager reads it as "no data".
    expect(DateRangeSchema.safeParse({ from: '2026-08-31', to: '2026-08-01' }).success).toBe(false);
  });

  /**
   * An unbounded range is an unbounded query against tables that grow with
   * every shift, reachable from a chat message. "Show me everything" would be
   * a self-service table scan.
   */
  it('refuses a range wider than a year', () => {
    expect(DateRangeSchema.safeParse({ from: '2020-01-01', to: '2026-01-01' }).success).toBe(false);
    // 366 days exactly is still allowed — a leap year is a real question.
    expect(DateRangeSchema.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(true);
  });

  it('refuses a malformed date instead of coercing it', () => {
    for (const from of ['01/08/2026', 'august', '2026-8-1', '']) {
      expect(DateRangeSchema.safeParse({ from, to: '2026-08-31' }).success).toBe(false);
    }
  });
});

describe('who may report on a team', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportService();
    mockListAssignments.mockResolvedValue({ data: [], total: 0 });
    mockListAttendance.mockResolvedValue({ data: [], total: 0 });
    mockOwnAbsences.mockResolvedValue([]);
    mockListAbsences.mockResolvedValue([]);
    mockListMyRooms.mockResolvedValue({ rooms: [], needs_rework: [] });
    mockUpload.mockResolvedValue(undefined);
    mockPresign.mockResolvedValue('https://example.test/report.xlsx');
  });

  it.each([['admin'], ['manager'], ['regional_manager']])('admits %s', (role) => {
    expect(isTeamScopedRole(role)).toBe(true);
  });

  it.each([['worker'], ['checker']])('refuses %s a team query, with no rows read', async (role) => {
    await expect(
      service.queryDataset({
        dataset: 'assignments',
        range: RANGE,
        actor: actor(role),
        scope: 'team',
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Refused BEFORE any owning module was asked.
    expect(mockListAssignments).not.toHaveBeenCalled();
  });

  it.each([['worker'], ['checker']])('refuses %s a team EXPORT too', async (role) => {
    await expect(
      service.generateReport({
        dataset: 'attendance',
        range: RANGE,
        format: 'xlsx',
        actor: actor(role),
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('lets every role export their OWN data — it is a right, not a feature', async () => {
    for (const role of ['worker', 'checker', 'manager', 'regional_manager', 'admin']) {
      const report = await service.exportOwnData({ actor: actor(role), range: RANGE });
      expect({ role, url: Boolean(report.url) }).toEqual({ role, url: true });
    }
  });
});

describe('reading through the owning modules', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportService();
    mockListAssignments.mockResolvedValue({ data: [], total: 0 });
    mockListAttendance.mockResolvedValue({ data: [], total: 0 });
    mockOwnAbsences.mockResolvedValue([]);
    mockListAbsences.mockResolvedValue([]);
    mockListMyRooms.mockResolvedValue({ rooms: [], needs_rework: [] });
    mockUpload.mockResolvedValue(undefined);
    mockPresign.mockResolvedValue('https://example.test/report.xlsx');
  });

  it('passes the date range down rather than filtering after the fact', async () => {
    await service.queryDataset({
      dataset: 'assignments',
      range: RANGE,
      actor: actor('manager'),
      scope: 'team',
    });

    const [query] = mockListAssignments.mock.calls[0] as [Record<string, unknown>];
    expect(query.from).toBe('2026-08-01');
    expect(query.to).toBe('2026-08-31');
  });

  it('passes the CALLER as the actor, so the module applies its own scope', async () => {
    const manager = actor('manager');
    await service.queryDataset({
      dataset: 'attendance',
      range: RANGE,
      actor: manager,
      scope: 'team',
    });

    const [, passedActor] = mockListAttendance.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(passedActor.userId).toBe('u1');
    expect(passedActor.role).toBe('manager');
  });

  /**
   * Two different owning interfaces, deliberately. `getOwnAbsences` is the
   * worker's self path and takes no scope at all; `listAbsences` is the
   * manager's group-scoped read. Using the wrong one would either leak or
   * under-report.
   */
  it('uses the self absence interface for a self report', async () => {
    await service.queryDataset({
      dataset: 'absences',
      range: RANGE,
      actor: actor('worker'),
      scope: 'self',
    });
    expect(mockOwnAbsences).toHaveBeenCalled();
    expect(mockListAbsences).not.toHaveBeenCalled();
  });

  it('uses the scoped absence interface for a team report', async () => {
    await service.queryDataset({
      dataset: 'absences',
      range: RANGE,
      actor: actor('manager'),
      scope: 'team',
    });
    expect(mockListAbsences).toHaveBeenCalled();
    expect(mockOwnAbsences).not.toHaveBeenCalled();
  });

  it('never routes a self-scoped role to the team absence interface', async () => {
    // Even asking for 'team', a worker is refused before this point — but if
    // that guard ever moved, this must not become the leak.
    await service.queryDataset({
      dataset: 'absences',
      range: RANGE,
      actor: actor('worker'),
      scope: 'self',
    });
    expect(mockListAbsences).not.toHaveBeenCalled();
  });

  it('filters the self absence path by date, since that interface has no range', async () => {
    mockOwnAbsences.mockResolvedValue([
      { day: '2026-07-15', kind: 'SICK' },
      { day: '2026-08-10', kind: 'SICK' },
      { day: '2026-09-20', kind: 'VACATION' },
    ]);

    const result = await service.queryDataset({
      dataset: 'absences',
      range: RANGE,
      actor: actor('worker'),
      scope: 'self',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].day).toBe('2026-08-10');
  });

  it('stops paginating instead of looping forever on an empty page', async () => {
    mockListAssignments.mockResolvedValue({ data: [], total: 0 });
    await service.queryDataset({
      dataset: 'assignments',
      range: RANGE,
      actor: actor('admin'),
      scope: 'team',
    });
    expect(mockListAssignments).toHaveBeenCalledTimes(1);
  });
});

describe('the generated files', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportService();
    mockListAssignments.mockResolvedValue({ data: [], total: 0 });
    mockListAttendance.mockResolvedValue({ data: [], total: 0 });
    mockOwnAbsences.mockResolvedValue([]);
    mockListAbsences.mockResolvedValue([]);
    mockListMyRooms.mockResolvedValue({ rooms: [], needs_rework: [] });
    mockUpload.mockResolvedValue(undefined);
    mockPresign.mockResolvedValue('https://example.test/report.xlsx');
  });

  it('produces a real, openable workbook', async () => {
    const buffer = await buildWorkbook(
      [
        {
          name: 'attendance',
          result: {
            dataset: 'attendance',
            from: RANGE.from,
            to: RANGE.to,
            columns: ['date', 'worker', 'status'],
            rows: [{ date: '2026-08-01', worker: 'Anna Schmidt', status: 'PRESENT' }],
            truncated: false,
          },
        },
      ],
      'Test'
    );

    // Parsed back rather than trusting the byte count: a corrupt workbook has
    // a plausible length too.
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = read.getWorksheet('Attendance');
    expect(sheet).toBeDefined();
    expect(sheet?.getRow(1).getCell(1).value).toBe('Date');
    expect(sheet?.getRow(2).getCell(2).value).toBe('Anna Schmidt');
  });

  /**
   * A truncated report must say so INSIDE the file. The spreadsheet outlives
   * the request, gets emailed on, and a silently partial report is one
   * somebody makes a decision from.
   */
  it('writes the truncation warning into the sheet, not just the response', async () => {
    const buffer = await buildWorkbook(
      [
        {
          name: 'assignments',
          result: {
            dataset: 'assignments',
            from: RANGE.from,
            to: RANGE.to,
            columns: ['day', 'worker'],
            rows: [{ day: '2026-08-01', worker: 'A' }],
            truncated: true,
          },
        },
      ],
      'Test'
    );

    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer as unknown as ArrayBuffer);
    let found = false;
    read.getWorksheet('Assignments')?.eachRow((row) => {
      if (String(row.getCell(1).value ?? '').includes('Truncated')) found = true;
    });
    expect(found).toBe(true);
  });

  it('gives every dataset its own sheet in a personal export', async () => {
    await service.exportOwnData({ actor: actor('worker'), range: RANGE });

    const [key, body, mime] = mockUpload.mock.calls[0] as [string, Buffer, string];
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(body as unknown as ArrayBuffer);

    for (const name of ['Assignments', 'Attendance', 'Absences', 'Rooms']) {
      expect({ sheet: name, present: Boolean(read.getWorksheet(name)) }).toEqual({
        sheet: name,
        present: true,
      });
    }
    expect(mime).toContain('spreadsheetml');
    expect(key).toMatch(/^reports\//);
  });

  /**
   * The presigned URL is the capability, so the key must not be guessable and
   * must not itself say who the report is about.
   */
  it('uses an unguessable key that names nobody', async () => {
    await service.exportOwnData({ actor: actor('worker'), range: RANGE });
    const [key] = mockUpload.mock.calls[0] as [string];

    expect(key).toMatch(
      /^reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//
    );
    expect(key).not.toContain('u1');
  });

  /**
   * A null URL is a real state — `S3_BUCKET` unset makes storage a documented
   * stub — and must surface as an absent link, never a broken one.
   */
  it('reports no link rather than a broken one when storage is stubbed', async () => {
    mockPresign.mockResolvedValue(null);
    const report = await service.exportOwnData({ actor: actor('worker'), range: RANGE });
    expect(report.url).toBeNull();
    expect(report.filename).toMatch(/\.xlsx$/);
  });

  it('produces a PDF that actually starts with a PDF header', async () => {
    const report = await service.generateReport({
      dataset: 'attendance',
      range: RANGE,
      format: 'pdf',
      actor: actor('manager'),
    });

    const [, body, mime] = mockUpload.mock.calls[0] as [string, Buffer, string];
    expect(body.subarray(0, 4).toString()).toBe('%PDF');
    expect(mime).toBe('application/pdf');
    expect(report.filename).toMatch(/\.pdf$/);
  });
});

describe('eachDay', () => {
  it('is inclusive of both ends', () => {
    expect(eachDay({ from: '2026-08-01', to: '2026-08-03' })).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('handles a single day and a month boundary', () => {
    expect(eachDay({ from: '2026-08-31', to: '2026-08-31' })).toEqual(['2026-08-31']);
    expect(eachDay({ from: '2026-08-31', to: '2026-09-01' })).toEqual(['2026-08-31', '2026-09-01']);
  });

  it('stays bounded by the range cap', () => {
    expect(eachDay({ from: '2024-01-01', to: '2024-12-31' }).length).toBe(366);
    expect(MAX_REPORT_ROWS).toBeGreaterThan(0);
  });
});

/**
 * The HTTP path must reject an impossible date exactly as the tool does. It
 * did not, before review: `2026-02-30` passed the shape regex, JavaScript
 * rolled it to March 2, and a report came back for a day nobody asked about.
 */
describe('the reports date range is validated semantically', () => {
  it('rejects dates that exist only as strings', () => {
    for (const bad of ['2026-13-45', '2026-02-30', '2026-04-31']) {
      expect({ date: bad, ok: DateRangeSchema.safeParse({ from: bad, to: '2026-12-31' }).success })
        .toEqual({ date: bad, ok: false });
    }
  });

  it('still accepts a real leap day', () => {
    expect(DateRangeSchema.safeParse({ from: '2024-02-29', to: '2024-03-01' }).success).toBe(true);
  });
});
