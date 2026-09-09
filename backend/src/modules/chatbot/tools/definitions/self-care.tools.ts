import { z } from 'zod';
import { assignmentService } from '../../../assignments/service.js';
import { calendarService } from '../../../calendar/service.js';
import { analyticsService } from '../../../analytics/service.js';
import { hrService } from '../../../hr/service.js';
import { toServiceActor } from '../actor.js';
import { APPROVED_2026_09_09 } from '../approvals.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { isoDate } from '../schema-primitives.js';
import { resolveMyShift, describeUnresolvedShift, todayIso } from './daily-operations.tools.js';
import type { ActorContext } from '../actor.js';

/**
 * THINGS A PERSON DOES ABOUT THEIR OWN WORKING LIFE.
 *
 * Filling four gaps found by mapping the platform's 130-odd routes against the
 * registry, rather than by guessing at what might be useful:
 *
 *  - finishing a shift, which had a permission token and NO TOOL;
 *  - withdrawing a sick day you no longer need;
 *  - asking for a payslip;
 *  - asking how you are doing.
 *
 * All four are self-scoped by identity in the owning service, and none accepts
 * an identifier: the shift and the absence are both resolved from the caller's
 * own records by DAY, the same shape every other resolver here uses.
 *
 * DELIBERATELY NOT BUILT, from the same survey, each for a checkable reason:
 *
 *  - `quality.complete_rework` -- `completeRework()` requires PHOTO EVIDENCE.
 *    A chatbot has no camera, so the tool could only ever fail. Structurally
 *    impossible, exactly like clocking in at a geofenced hotel.
 *  - `consent.*` -- consent must be informed and explicit, and a one-line chat
 *    confirmation is not a defensible vehicle for a GDPR lawful basis. The
 *    consent gate has its own screen for a reason.
 *  - `auth.*` -- credentials never belong in a tool a model can select.
 *  - `users.*` writes, and hotel/group CRUD -- these MINT authority rather
 *    than exercise it, so "the person could do it by hand" does not transfer.
 *  - `analytics` leaderboards and `/stats` -- `OQ-ANALYTICS-01` records those
 *    routes as missing `requireRole`/`checkHotelAccess`. Wrapping a route with
 *    a known authorization gap would industrialise it. `my-stats` is exempt
 *    and is built below: its own comment says it is "worker-scoped, self-only
 *    ... deliberately does not ride /stats' guard".
 */

// ---------------------------------------------------------------------------

const NoArgs = z.object({}).strict();
type NoArgs = z.infer<typeof NoArgs>;

export const completeMyShift = registerTool<NoArgs>({
  name: 'assignments.complete_my_shift',
  description:
    'Close the shift RECORD for the caller\'s own shift today, marking the work itself ' +
    'as complete. Use for "mark my shift complete", "close my shift record", "set my ' +
    'shift to completed", "Schicht als erledigt markieren" -- phrasings that name the ' +
    'shift or the record explicitly. Returns confirmation that the shift is closed.\n\n' +
    'This is NOT clocking out and does not record a time. "I am done for today", "I am ' +
    'finished", "Feierabend" and anything about leaving, going home or stopping work ' +
    'mean the time clock: use attendance.check_out. A worker clocks out every shift; ' +
    'closing the record is a separate, deliberate act.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-ASG-UpdateAssignment (assignments/service.ts update())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    'consumes `assignments:status-write`, which was added on 2026-09-09 for exactly ' +
    'this and had no tool using it until now.',

  args: NoArgs,
  // The token added with the daily-operations batch. It had NO consumer until
  // this tool: a permission that grants nothing to anything is a loose end,
  // and the honest resolutions were to build the tool or remove the token.
  permission: 'assignments:status-write',
  scopeCheck: 'self',

  invoke: async (_args, actor) => {
    const day = todayIso();
    const resolved = await resolveMyShift(actor, day);
    if (resolved.status !== 'RESOLVED') {
      return refuse(
        resolved.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NOT_FOUND',
        describeUnresolvedShift(resolved)
      );
    }

    const serviceActor = toServiceActor(actor);
    try {
      const updated = await assignmentService.update(
        resolved.shift.id,
        { status: 'COMPLETED' } as Parameters<typeof assignmentService.update>[1],
        serviceActor.userId,
        serviceActor.role,
        serviceActor.scope ?? null
      );
      return { completed: true, day, status: (updated as { status?: string }).status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // "already completed" is the state having moved past the ask, not a
      // failure -- re-running changes nothing, so the caller should stop.
      if (/already|cannot/i.test(message)) return refuse('ALREADY_DONE', message);
      throw error;
    }
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { day?: string } | null;
    return { summary: `Your shift on ${r?.day} is marked complete.`, data: { day: r?.day } };
  },
  maxResultTokens: 80,
});

// ---------------------------------------------------------------------------

const WithdrawArgs = z
  .object({
    // A DAY, not an absence id. Resolved against the caller's own absences.
    day: isoDate,
  })
  .strict();

type WithdrawArgs = z.infer<typeof WithdrawArgs>;

export const withdrawMyAbsence = registerTool<WithdrawArgs>({
  name: 'calendar.withdraw_my_absence',
  description:
    "Cancel one of the authenticated user's OWN sick or vacation days that they no " +
    'longer need. Use for "I am better, cancel tomorrow\'s sick day", "remove my ' +
    'absence on the 12th", "ich bin wieder gesund". Give the day as YYYY-MM-DD. ' +
    'Returns confirmation that the day is cleared.',
  // Withdrawing an absence can put the person back on a shift, and the
  // platform may re-staff around it. Not something to do by accident.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-CAL-DeleteAbsence (calendar/service.ts deleteAbsence())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    "Self-scoped: it resolves only within the caller's own absences, and deleteAbsence " +
    'applies its own ownership check on top.',

  args: WithdrawArgs,
  permission: 'calendar:absence:write-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const serviceActor = toServiceActor(actor);

    // The candidate set is the caller's OWN absences -- scope before match, so
    // a day that is somebody else's absence is indistinguishable from a day
    // with none.
    const mine = (await calendarService.getOwnAbsences(serviceActor.userId)) as Array<{
      id: string;
      day?: string;
      kind?: string;
    }>;
    const onDay = mine.filter((a) => String(a.day ?? '').slice(0, 10) === args.day);

    if (onDay.length === 0) {
      return refuse('NOT_FOUND', `You have no absence recorded on ${args.day}.`);
    }
    if (onDay.length > 1) {
      // Should not occur -- one absence per worker per day is a unique
      // constraint -- but guessing between two would clear the wrong one.
      return refuse('AMBIGUOUS', `You have more than one absence on ${args.day}.`);
    }

    try {
      await calendarService.deleteAbsence(onDay[0].id, serviceActor);
      return { withdrawn: args.day, kind: onDay[0].kind ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The service refuses withdrawing a PAST absence: the day happened, and
      // removing the record would rewrite history rather than change a plan.
      if (/past|cannot/i.test(message)) return refuse('ALREADY_DONE', message);
      throw error;
    }
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { withdrawn?: string; kind?: string | null } | null;
    return {
      summary: `Your ${String(r?.kind ?? 'absence').toLowerCase()} on ${r?.withdrawn} is cancelled.`,
      data: { day: r?.withdrawn },
    };
  },
  maxResultTokens: 80,
});

// ---------------------------------------------------------------------------

const PayslipArgs = z
  .object({
    // Free text, optional: "for August", "the last three months". Recorded as
    // a note for whoever fulfils it rather than parsed into a period, because
    // a wrong month silently produces the wrong document.
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

type PayslipArgs = z.infer<typeof PayslipArgs>;

export const requestMyPayslip = registerTool<PayslipArgs>({
  name: 'hr.request_payslip',
  description:
    'Raise a request for the authenticated user\'s own payslip. Use for "send me my ' +
    'payslip", "I need my Lohnabrechnung", "can I get last month\'s payslip". Optionally ' +
    'pass a short note saying which period. Returns confirmation that the request was ' +
    'raised; HR fulfils it separately.',
  // Reversible in the sense that matters: it creates a request somebody
  // actions, not a document or a payment. Nothing is disclosed by raising it.
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-HR-RequestPayslip (hr/service.ts requestPayslip())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    'Self-scoped and LOW_RISK: it raises a request against the caller, discloses ' +
    'nothing, and is fulfilled by a person.',

  args: PayslipArgs,
  // The token the route itself enforces, alongside requireRole(worker|checker).
  permission: 'hr:payslip:request',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const serviceActor = toServiceActor(actor);
    // worker_id is the ACTOR's, constructed here and not expressible as an
    // argument -- the same guarantee the HTTP route states in its own comment.
    const request = await hrService.requestPayslip({
      worker_id: serviceActor.userId,
      ...(args.note ? { notes: args.note } : {}),
    } as Parameters<typeof hrService.requestPayslip>[0]);

    return { requested: true, status: (request as { status?: string }).status ?? null };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    return {
      summary: 'Your payslip request has been raised. HR will action it.',
      data: null,
    };
  },
  maxResultTokens: 60,
});

// ---------------------------------------------------------------------------

export const myStats = registerTool<NoArgs>({
  name: 'analytics.my_stats',
  description:
    "Show the authenticated user's own work statistics: shifts completed, hours, " +
    'punctuality and quality scores. Use for "how am I doing", "what are my stats", ' +
    '"wie sind meine Zahlen", "how many shifts have I done". Only ever the caller\'s ' +
    'own figures. Returns a summary of their recent performance.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ANL-GetWorkerStats (analytics/service.ts getWorkerStats())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    'Self-scoped + READ_ONLY. Deliberately the ONLY analytics tool: the leaderboard ' +
    'and /stats routes carry the OQ-ANALYTICS-01 authorization gap, and /my-stats ' +
    "does not ride their guard -- its route comment says so explicitly.",

  args: NoArgs,
  // GET /analytics/my-stats carries no requirePermission and no requireRole:
  // its comment records that as deliberate ("worker-scoped, self-only -- any
  // authenticated role"), with self-scope as the whole control. READ_ONLY and
  // self-scoped is exactly the envelope the registry permits `null` for.
  permission: null,
  permissionRationale:
    'GET /analytics/my-stats enforces no token and no role by design (GD-06): it is ' +
    "worker-scoped and self-only, and the controller passes req.auth.userId to " +
    'getWorkerStats. The caller id is not expressible as a tool argument, so the ' +
    'tool can only ever return the caller\'s own figures.',
  scopeCheck: 'self',

  invoke: async (_args, actor) =>
    analyticsService.getWorkerStats(toServiceActor(actor).userId),

  compress: (raw: unknown): CompactResult => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const pick = (...keys: string[]) => {
      for (const k of keys) if (s[k] !== undefined && s[k] !== null) return s[k];
      return null;
    };

    const shifts = pick('completed_shifts', 'shifts_completed', 'total_shifts');
    const rating = pick('average_rating', 'avg_rating', 'quality_score');
    const onTime = pick('on_time_rate', 'punctuality', 'on_time_percentage');

    const parts = [
      shifts !== null ? `${shifts} shifts completed` : null,
      rating !== null ? `average rating ${rating}` : null,
      onTime !== null ? `${onTime} on time` : null,
    ].filter(Boolean);

    return {
      summary: parts.length > 0 ? `Your figures: ${parts.join(', ')}.` : 'No statistics yet.',
      // The whole stats object, which is already the caller's own and carries
      // no other person's data.
      data: s,
    };
  },
  maxResultTokens: 300,
});

/** Re-exported for tests; the resolver lives with the shift tools. */
export type { ActorContext };
