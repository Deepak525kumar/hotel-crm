import { z } from 'zod';
import { isoDate } from '../schema-primitives.js';
import { reportService } from '../../../reports/service.js';
import { toServiceActor } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';

/**
 * The commissioning human's approval of the seven tools added after the
 * 2026-09-08 batch, granted the same day under `ADR-053` item 4 and recorded
 * separately because it is a separate decision about a separate set.
 *
 * Granted after a LIVE routing test against the real model rather than on the
 * code alone: 32 realistic phrases in English and German, covering tool
 * selection, argument extraction, permission filtering and prompt injection.
 * All 32 routed correctly -- including a worker asking to "export the whole
 * team attendance", which selected no tool at all because the manifest is
 * filtered by permission before the model ever sees it.
 *
 * Same scope limit as the first approval: it covers these tools AS REGISTERED
 * on this date. Widening a tool's scope, risk tier or permission makes it a
 * different capability and returns it to PENDING.
 */
const APPROVED_2026_09_08_SHIFT_AND_REPORTS =
  'APPROVED 2026-09-08 by the commissioning human under ADR-053 item 4, after a ' +
  'live routing test against the real model (32/32 phrases routed correctly). ' +
  'Covers this tool as registered on that date; a later change to its scope, ' +
  'risk tier or permission requires re-approval.';

/**
 * Asking about data over a date range, and taking it away as a file.
 *
 * THREE TOOLS, TWO RIGHTS. Reading and exporting a TEAM's data is a
 * management capability -- it contains other people's hours, absences and
 * names. Exporting YOUR OWN data is a legal right under GDPR Article 15/20,
 * held by every role, and gating it like a management feature would be gating
 * a right. The registry expresses that split with two different tokens, and
 * the service refuses across it a second time.
 *
 * NO ROW IS READ HERE. Every one comes from the module that owns it, through
 * that module's own scoped read, with the caller's own actor -- so a manager's
 * report contains exactly what their screen would show, because it is the same
 * query. The reports module composes and formats; it never touches a table.
 *
 * WHY THE DATE RANGE IS CAPPED AT 366 DAYS. "Show me everything" reachable
 * from a chat message is a self-service table scan against tables that grow
 * with every shift. A year covers every real reporting question and refuses
 * the one nobody needs. Row count is capped separately, and a truncated report
 * says so INSIDE the file as well as in the reply -- a spreadsheet outlives
 * the conversation and gets decided from.
 */

const DAY = isoDate;

const DATASETS = ['assignments', 'attendance', 'absences', 'rooms'] as const;

const QueryArgs = z
  .object({
    dataset: z.enum(DATASETS),
    from: DAY,
    to: DAY,
  })
  .strict()
  .refine((r) => r.from <= r.to, { message: 'from must not be after to', path: ['from'] });

type QueryArgs = z.infer<typeof QueryArgs>;

export const queryTeamData = registerTool<QueryArgs>({
  name: 'reports.query_team',
  description:
    "Read the caller's TEAM data for any date range: assignments, attendance, absences " +
    'or rooms. Use for "how many shifts did we cover in August", "show me attendance ' +
    'from 2026-08-01 to 2026-08-31", "who was absent last month". Manager, regional ' +
    'manager and admin only. Dates must be YYYY-MM-DD and the range at most 366 days.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-RPT-QueryDataset (reports/service.ts queryDataset())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    "Reads other people's rows; the first READ tool gated on a management token rather than self-scope.",

  args: QueryArgs,
  permission: 'reports:read-team',
  // 'none': there is no scope ARGUMENT to pre-check. The actor's own scope is
  // applied by each owning module, which is the same narrowing their HTTP
  // routes rely on.
  scopeCheck: 'none',

  invoke: async (args, actor) =>
    reportService.queryDataset({
      dataset: args.dataset,
      range: { from: args.from, to: args.to },
      actor: toServiceActor(actor),
      scope: 'team',
    }),

  compress: (raw: unknown): CompactResult => {
    const r = raw as
      | { dataset?: string; from?: string; to?: string; rows?: unknown[]; truncated?: boolean }
      | null;
    if (!r) return { summary: 'No data.', data: null };

    const count = r.rows?.length ?? 0;
    const trunc = r.truncated ? ' (truncated — narrow the range for all of it)' : '';
    return {
      summary: `${count} ${r.dataset} row${count === 1 ? '' : 's'} from ${r.from} to ${r.to}${trunc}.`,
      // A SAMPLE, not the whole set. A year of assignments would blow the
      // turn's token budget and tell the model nothing the summary does not;
      // the file export exists for the full data.
      data: { count, sample: (r.rows ?? []).slice(0, 20), truncated: r.truncated ?? false },
    };
  },
  maxResultTokens: 1200,
});

const ExportArgs = z
  .object({
    dataset: z.enum(DATASETS),
    from: DAY,
    to: DAY,
    format: z.enum(['xlsx', 'pdf']),
  })
  .strict()
  .refine((r) => r.from <= r.to, { message: 'from must not be after to', path: ['from'] });

type ExportArgs = z.infer<typeof ExportArgs>;

export const exportTeamReport = registerTool<ExportArgs>({
  name: 'reports.export_team',
  description:
    'Produce a downloadable Excel or PDF report of TEAM data for a date range. Use for ' +
    '"export that to Excel", "give me a PDF of last month\'s attendance", "download ' +
    'the August roster". Dates must be YYYY-MM-DD and the range at most 366 days. ' +
    'Manager, regional manager and admin only. Returns a download link that expires ' +
    'shortly.',
  // A file leaving the platform with other people's names, hours and absences
  // in it is not a read -- it is a disclosure, and one nobody can recall once
  // the link is shared. Confirmation makes the actor see the exact dataset,
  // range and format before it is produced.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-RPT-GenerateReport (reports/service.ts generateReport())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    "Produces a file containing other people's personal data and a link that leaves the platform. HIGH_RISK despite being read-shaped, because a shared link cannot be recalled.",

  args: ExportArgs,
  permission: 'reports:export-team',
  scopeCheck: 'none',

  invoke: async (args, actor) =>
    reportService.generateReport({
      dataset: args.dataset,
      range: { from: args.from, to: args.to },
      format: args.format,
      actor: toServiceActor(actor),
    }),

  compress: compressReport,
  maxResultTokens: 150,
});

const ExportMineArgs = z
  .object({
    from: DAY.optional(),
    to: DAY.optional(),
  })
  .strict();

type ExportMineArgs = z.infer<typeof ExportMineArgs>;

export const exportMyData = registerTool<ExportMineArgs>({
  name: 'reports.export_my_data',
  description:
    "Export ALL of the authenticated user's own data as an Excel workbook: their " +
    'shifts, attendance, absences and rooms logged. Use for "export my data", "download ' +
    'all my information", "meine Daten exportieren". Available to every user. Defaults ' +
    'to the last 12 months if no dates are given; give any other range as YYYY-MM-DD. ' +
    'Returns a download link that expires shortly.',
  // Self-scoped and reversible in the only sense that matters -- it discloses
  // nothing to anyone but the person asking, about themselves. Confirmation
  // would put a speed bump in front of a legal right.
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-RPT-ExportOwnData (reports/service.ts exportOwnData())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    "Self-scoped: it can only ever produce the caller's own records. Held by every role because GDPR Article 15/20 is a right, not a feature.",

  args: ExportMineArgs,
  permission: 'reports:export-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    return reportService.exportOwnData({
      actor: toServiceActor(actor),
      range: { from: args.from ?? yearAgo, to: args.to ?? today },
    });
  },

  compress: compressReport,
  maxResultTokens: 150,
});

/**
 * A produced file, described for a person.
 *
 * A NULL URL IS A REAL STATE, not an error to paper over: with `S3_BUCKET`
 * unset the storage client is a documented stub, and the honest answer is that
 * the report was built but cannot be handed over -- never a broken link.
 */
function compressReport(raw: unknown): CompactResult {
  const r = raw as
    | { filename?: string; url?: string | null; rowCount?: number; truncated?: boolean }
    | null;
  if (!r) return { summary: 'No report was produced.', data: null };

  if (!r.url) {
    return {
      summary:
        'The report was generated but file storage is not configured, so there is no ' +
        'download link. Please tell an administrator.',
      data: { rows: r.rowCount ?? 0 },
    };
  }

  const trunc = r.truncated ? ' It was truncated — narrow the dates for the full set.' : '';
  return {
    summary: `Your report is ready: ${r.filename} (${r.rowCount ?? 0} rows). The link expires shortly.${trunc}`,
    data: { filename: r.filename, url: r.url, rows: r.rowCount ?? 0 },
  };
}
