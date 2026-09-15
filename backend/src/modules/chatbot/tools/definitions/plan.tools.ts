import { z } from 'zod';
import { isoDate } from '../schema-primitives.js';
import { assignmentService } from '../../../assignments/service.js';
import { calendarService } from '../../../calendar/service.js';
import {
  describeUnresolved,
  refuseUnresolvedHotel,
  resolveHotelReference,
  resolveWorkerReference,
  type WorkerReferenceResult,
} from '../worker-reference.js';
import { toServiceActor } from '../actor.js';
import { placeManyOnCalendar } from './self-service.tools.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { APPROVED_2026_09_15_ROTA } from '../approvals.js';

/**
 * A DICTATED PLAN, APPLIED IN ONE CONFIRMED STEP.
 *
 * The owner's original picture of this assistant (recorded 2026-09-04): a
 * manager dictates the week -- "Anna is off sick Monday, put Tomasz on Monday
 * and Tuesday, Maria on holiday Friday" -- and it lands on the calendar. Until
 * now that sentence was two tools, `calendar.mark_worker_absence` once per
 * absence and `assignments.place_many` for the shifts, each with its own
 * confirmation. Four taps for one thought, and a manager who confirmed the
 * first and was interrupted before the second had half a plan on the rota.
 *
 * ABSENCES ARE APPLIED FIRST, and that order is the point. Marking someone
 * sick auto-cancels a shift they already hold that day (calendar/service.ts),
 * which frees the day -- so "Anna sick Monday, put Tomasz on Monday" works in
 * one go instead of failing on the one-active-assignment-per-day rule.
 *
 * EVERY NAME IS RESOLVED BEFORE ANYTHING IS WRITTEN. One unresolvable person
 * refuses the whole plan, as `place_many` does: applying the resolvable half
 * would leave a manager believing a plan is on the calendar that is not. The
 * confirmation precheck has already resolved names inside BOTH lists by the
 * time the manager is asked (reference-precheck.ts).
 *
 * AFTER THAT, ENTRIES FAIL ONE AT A TIME and are reported one at a time: a
 * worker already booked, a past day, an absence the worker marked themselves
 * and which a manager may not overwrite. Each is the owning service's own
 * rule, applied exactly as it is by hand.
 *
 * AUTHORIZATION: both tokens, because the plan does both things. Placing a
 * shift is `staffing:write`; recording another person's absence is
 * `calendar:absence:write-team`. Both are held by admin, manager and regional
 * manager and by no worker or checker, and each service re-checks scope.
 */

const MAX_ENTRIES = 30;

const Placement = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: isoDate,
  })
  .strict();

const Absence = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: isoDate,
    kind: z.enum(['SICK', 'VACATION']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const ApplyPlanArgs = z
  .object({
    hotel_name: z.string().trim().min(2).max(120).optional(),
    placements: z.array(Placement).max(MAX_ENTRIES).optional(),
    absences: z.array(Absence).max(MAX_ENTRIES).optional(),
  })
  .strict()
  .refine((a) => (a.placements?.length ?? 0) + (a.absences?.length ?? 0) > 0, {
    message: 'give at least one shift or one absence',
    path: ['placements'],
  })
  // The service's rule, stated at proposal time so a manager never confirms a
  // holiday that will be refused for having no reason.
  .refine((a) => (a.absences ?? []).every((x) => x.kind !== 'VACATION' || Boolean(x.reason)), {
    message: 'a VACATION absence needs a reason',
    path: ['absences'],
  });

type ApplyPlanArgs = z.infer<typeof ApplyPlanArgs>;

interface EntryOutcome {
  worker: string;
  day: string;
  kind?: string;
  ok: boolean;
  error?: string;
}

export const applyPlan = registerTool<ApplyPlanArgs>({
  name: 'calendar.apply_plan',
  description:
    "Applies a plan the manager dictates for their OWN workers -- sick and holiday days AND " +
    'shifts together -- in one confirmed step. Use when one message names BOTH someone ' +
    'being off (sick or on holiday) AND someone working, and not otherwise: "Anna is off sick Monday, put Tomasz on Monday and Tuesday", "Maria Urlaub am ' +
    'Freitag wegen Hochzeit, Parveen übernimmt Freitag und Samstag". Days are YYYY-MM-DD; each ' +
    'absence is SICK or VACATION, and a holiday needs its reason. Returns what was recorded and ' +
    'anything that could not be. For shifts alone use assignments.place_many; for one absence ' +
    'alone use calendar.mark_worker_absence.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef:
    'IF-CAL-MarkAbsenceForWorker (calendar/service.ts) + IF-ASG-PlaceOnCalendar (assignments/service.ts), per entry',
  approvalRef:
    APPROVED_2026_09_15_ROTA +
    ' Registration note: up to 30 absences and 30 placements in one confirmed call; absences first, all names resolved before any write.',

  args: ApplyPlanArgs,
  permission: ['staffing:write', 'calendar:absence:write-team'],
  scopeCheck: 'none',

  /**
   * Replaying the owner's conversation word for word (2026-09-15), "ok make" --
   * right after Parveen's three shifts were scheduled -- was read as a plan of
   * those same three shifts. The manager confirmed and got "scheduled 0 shifts",
   * three times "already has a calendar placement". place_many already refuses
   * that before asking; a plan of shifts alone is the same request, so it gets
   * the same check, delegated rather than copied. A plan with ANY absence is a
   * real change and always proceeds to confirmation.
   */
  precheck: async (args, actor) => {
    if ((args.absences?.length ?? 0) > 0 || !args.placements?.length) return null;
    return placeManyOnCalendar.precheck!({ hotel_name: args.hotel_name, placements: args.placements }, actor);
  },

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') {
      return { ...refuseUnresolvedHotel(hotel), absences: [], placements: [] };
    }

    // ---- Pass 1: every name, once. Write nothing yet. -----------------------
    const names = [...new Set([...(args.absences ?? []), ...(args.placements ?? [])].map((e) => e.worker_name))];
    const resolved = new Map<string, WorkerReferenceResult>();
    for (const name of names) {
      resolved.set(name, await resolveWorkerReference(name, actor, hotel.hotelId));
    }
    const problems = [...resolved.values()].filter((r) => r.status !== 'RESOLVED');
    if (problems.length > 0) {
      return {
        ...refuse(
          problems.some((p) => p.status === 'AMBIGUOUS') ? 'AMBIGUOUS' : 'NOT_FOUND',
          `Nothing was changed. ${[...new Set(problems.map(describeUnresolved))].join(' ')}`
        ),
        absences: [],
        placements: [],
      };
    }

    const serviceActor = toServiceActor(actor);
    const who = (name: string) => resolved.get(name) as Extract<WorkerReferenceResult, { status: 'RESOLVED' }>;
    const failure = (error: unknown) => (error instanceof Error ? error.message : 'could not be recorded');

    // ---- Pass 2: absences FIRST, so a sick day frees the day it covers ------
    const absences: EntryOutcome[] = [];
    for (const entry of args.absences ?? []) {
      const worker = who(entry.worker_name);
      try {
        await calendarService.markAbsenceForWorker(
          {
            worker_id: worker.workerId,
            day: entry.day,
            kind: entry.kind,
            ...(entry.reason ? { reason: entry.reason } : {}),
          },
          serviceActor
        );
        absences.push({ worker: worker.fullName, day: entry.day, kind: entry.kind, ok: true });
      } catch (error) {
        absences.push({ worker: worker.fullName, day: entry.day, kind: entry.kind, ok: false, error: failure(error) });
      }
    }

    // ---- Pass 3: shifts ----------------------------------------------------
    const placements: EntryOutcome[] = [];
    for (const entry of args.placements ?? []) {
      const worker = who(entry.worker_name);
      try {
        await assignmentService.placeOnCalendar(
          { worker_id: worker.workerId, hotel_id: hotel.hotelId, day: entry.day },
          serviceActor
        );
        placements.push({ worker: worker.fullName, day: entry.day, ok: true });
      } catch (error) {
        placements.push({ worker: worker.fullName, day: entry.day, ok: false, error: failure(error) });
      }
    }

    return { hotel: hotel.name, absences, placements };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const r = (raw ?? {}) as { hotel?: string; absences?: EntryOutcome[]; placements?: EntryOutcome[] };
    const absences = r.absences ?? [];
    const placements = r.placements ?? [];
    const okAbsences = absences.filter((a) => a.ok).length;
    const okPlacements = placements.filter((p) => p.ok).length;
    const failed = [...absences, ...placements].filter((e) => !e.ok);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

    const done: string[] = [];
    if (absences.length > 0) done.push(`recorded ${plural(okAbsences, 'absence')}`);
    if (placements.length > 0) done.push(`scheduled ${plural(okPlacements, 'shift')}`);

    const head = `At ${r.hotel}: ${done.join(' and ')}.`;
    // Each failure named with the service's own reason -- "some entries
    // failed" is not something a manager can act on; "Tomasz Nowak on
    // 2026-09-21: already has an assignment" is.
    const tail =
      failed.length === 0
        ? ''
        : ` Not done: ${failed.map((f) => `${f.worker} on ${f.day}${f.kind ? ` (${f.kind.toLowerCase()})` : ''} -- ${f.error}`).join('; ')}.`;

    return {
      summary: head + tail,
      data: {
        absences: absences.map(({ worker, day, kind, ok }) => ({ worker, day, kind, ok })),
        placements: placements.map(({ worker, day, ok }) => ({ worker, day, ok })),
      },
    };
  },
  maxResultTokens: 1200,
});
