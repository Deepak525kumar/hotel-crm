import { z } from 'zod';
import { reportService } from '../../../reports/service.js';
import { toServiceActor } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';

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

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

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
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. Reads ' +
    "other people's rows, so it is the first READ tool gated on a management token " +
    'rather than self-scope.',

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
    'the August roster". Manager, regional manager and admin only.',
  // A file leaving the platform with other people's names, hours and absences
  // in it is not a read -- it is a disclosure, and one nobody can recall once
  // the link is shared. Confirmation makes the actor see the exact dataset,
  // range and format before it is produced.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-RPT-GenerateReport (reports/service.ts generateReport())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. It ' +
    "produces a file containing other people's personal data and a link that leaves " +
    'the platform, so it warrants the closest review of any read-shaped tool here.',

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
    'to the last 12 months if no dates are given.',
  // Self-scoped and reversible in the only sense that matters -- it discloses
  // nothing to anyone but the person asking, about themselves. Confirmation
  // would put a speed bump in front of a legal right.
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-RPT-ExportOwnData (reports/service.ts exportOwnData())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. ' +
    'Self-scoped: it can only ever produce the caller\'s own records.',

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
