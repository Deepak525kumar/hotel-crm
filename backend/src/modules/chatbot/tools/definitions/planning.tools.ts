import { z } from 'zod';
import { isoDate } from '../schema-primitives.js';
import { calendarService } from '../../../calendar/service.js';
import { attendanceService } from '../../../attendance/service.js';
import { jobRequestService } from '../../../job-requests/service.js';
import { userService } from '../../../users/service.js';
import {
  refuseUnresolved,
  refuseUnresolvedHotel,
  resolveHotelReference,
  resolveWorkerReference,
} from '../worker-reference.js';
import { toServiceActor } from '../actor.js';
import { registerTool } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { APPROVED_2026_09_09_PLANNING } from '../approvals.js';
// The Europe/Berlin "today", shared with the daily-operations tools rather than
// recomputed: a UTC date here would give a night-shift manager yesterday.
import { todayIso } from './daily-operations.tools.js';
import { CALENDAR_TIMEZONE } from '../../../../lib/utils.js';

/**
 * PLANNING TOOLS -- the four capabilities a route-by-route gap analysis
 * (2026-09-09) found missing from a registry that could already act.
 *
 * Two were genuine holes in a workflow the assistant otherwise completes:
 *
 *   - The assistant could PLACE a worker on a day but could not first ask who
 *     was free, so it could perform the write without the reasoning step that
 *     precedes it.
 *   - Workers could list and accept staffing broadcasts, but no tool created
 *     one -- an asymmetry that left the manager's half of that workflow off
 *     the assistant entirely.
 *
 * Two are the reads a manager actually asks for hour to hour, and which
 * `assignments.list_for_my_team` only looks like it answers. Three different
 * questions hide behind "who is working": who is SCHEDULED (that tool), who
 * actually SHOWED UP (`attendance.team_status`), and who EXISTS at all
 * (`users.find_team_member`). Their descriptions name each other for exactly
 * that reason -- the 2026-09-09 check_out/complete_my_shift collision showed
 * that two tools sharing one natural phrase cannot be separated by the model,
 * only by the manifest.
 *
 * WHAT IS NOT HERE, deliberately. The same analysis listed capabilities the
 * platform exposes over HTTP and this registry refuses: credentials and
 * sessions, role/email mutation and user deletion, consent decisions,
 * subject-rights exports, hotel and group creation or deletion, bulk employee
 * import, the quality leaderboard (it rides the documented OQ-ANALYTICS-01
 * authorization gap), the audit log, notification-outbox internals, and
 * geolocation history. Manager timesheet correction is refused for a reason
 * worth stating separately: it is the platform's most payroll-fraud-sensitive
 * write, and a worker cannot reach it at all by design -- attendance
 * `update()` forces server time on the self branch and rejects an already
 * closed record precisely to stop time manipulation. None of that is relaxed
 * here.
 *
 * Every tool below is team-scoped, never worker-reachable, and re-derives its
 * actor from `req.auth` like the rest of the registry. The services keep
 * their own gates: `getAvailability` re-checks `isWorkerInGroupScope`,
 * `listUsers` is default-deny scope-resolved, `attendanceService.list`
 * branches on role, and `jobRequestService.create` re-checks scope. Nothing a
 * model emits is an authorization input.
 */

/* ------------------------------------------------------------------ *
 * calendar.check_availability
 * ------------------------------------------------------------------ */

/**
 * The read that `assignments.place_worker` always needed.
 *
 * `day` is a REAL argument, not decoration: `getAvailability` was today-only
 * until 2026-09-09, and shipping a tool that accepted a date and quietly
 * answered about today would have been the exact defect class this repository
 * keeps finding. The service was made day-aware instead, defaulting to today
 * so the HTTP route it also serves did not change behaviour.
 *
 * "Available" means what the service means by it and nothing more: no active
 * assignment that day and no blocking absence. It is not a statement about
 * contracted hours, working-time limits, or whether the person wants the
 * shift -- so the description says "free to be placed", not "free".
 */
const CheckAvailabilityArgs = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: isoDate,
    // A NAME, not an id -- the roster is a property of a hotel, and an admin
    // or regional manager covers several and must say which.
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type CheckAvailabilityArgs = z.infer<typeof CheckAvailabilityArgs>;

export const checkAvailability = registerTool<CheckAvailabilityArgs>({
  name: 'calendar.check_availability',
  description:
    'Check whether ONE named worker is free to be placed on a given day. Use for ' +
    '"is Anna free on Thursday?", "can Tomasz work Monday?", "ist Maria am Freitag ' +
    'frei?". Give the worker\'s name as they are known at the hotel and the day as ' +
    'YYYY-MM-DD. Returns whether that worker is free on that day, meaning they have ' +
    'no shift already booked and no sick or vacation day recorded.\n\n' +
    'This answers about ONE named person, not a list. It does NOT show who is ' +
    'scheduled (use assignments.list_for_my_team), who has clocked in ' +
    '(attendance.team_status), or who is on the team at all ' +
    '(users.find_team_member). It books nothing -- use assignments.place_worker ' +
    'to actually place someone.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-CAL-GetAvailability (calendar/service.ts getAvailability())',
  approvalRef:
    APPROVED_2026_09_09_PLANNING +
    ' Registration note: reads one in-scope worker\'s free/busy for one day; discloses no absence reason.',

  args: CheckAvailabilityArgs,
  permission: 'staffing:read',
  // 'none' for the same reason as place_worker: there is no hotel ARGUMENT to
  // pre-check. The hotel comes from the actor's own scope inside invoke(),
  // and getAvailability re-checks group scope itself regardless.
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);

    const resolved = await resolveWorkerReference(args.worker_name, actor, hotel.hotelId);
    if (resolved.status !== 'RESOLVED') return refuseUnresolved(resolved);

    const availability = await calendarService.getAvailability(
      resolved.workerId,
      toServiceActor(actor),
      args.day
    );

    return { worker: resolved.fullName, day: args.day, available: availability.available };
  },

  compress: (raw: unknown) => {
    const result = raw as { worker?: string; day?: string; available?: boolean } | null;
    if (!result) return { summary: 'Nothing was found.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    return {
      summary: result.available
        ? `${result.worker} is free to be placed on ${result.day}.`
        : `${result.worker} is not free on ${result.day} -- already booked, or away.`,
      // Deliberately no reason for the "not free": whether it is a shift, a
      // sick day or a holiday is the worker's business, and the manager can
      // read their calendar directly if they need it.
      data: { worker: result.worker, day: result.day, available: result.available },
    };
  },
  maxResultTokens: 80,
});

/* ------------------------------------------------------------------ *
 * job_requests.create_broadcast
 * ------------------------------------------------------------------ */

/**
 * The manager's half of a workflow whose worker half already shipped.
 *
 * `job_requests.list_open` and `job_requests.accept` let a worker find and
 * take a shift; nothing let a manager raise one, so the assistant could close
 * that loop only from one end.
 *
 * IT CREATES A DRAFT, ALWAYS. `CreateWorkRequestSchema` accepts
 * `status: 'DRAFT' | 'OPEN'`, and this tool pins DRAFT and does not expose the
 * field. Publishing to OPEN broadcasts to every eligible worker in scope --
 * push notifications and email to potentially hundreds of people, from a
 * sentence the model may have misread, and unsendable once sent. That is the
 * blast radius `ADR-074` is about, and a draft the manager publishes from the
 * UI costs one click and removes it entirely.
 *
 * `confirm: true` despite being LOW_RISK_WRITE. The tier is honest -- a draft
 * notifies nobody and is deleted in a click -- but the argument list is long
 * enough (position, headcount, date, two times) that a misheard number is
 * likely and cheap to catch, and the manager should see the exact shift
 * before it is written down.
 *
 * NOT EXPOSED, deliberately: `hourly_rate`, `currency`, `requirements` and
 * `expires_at`. Pay in particular is a term of employment and does not belong
 * in a dictated sentence; the manager sets it on the draft where the number is
 * visible next to everything else it affects.
 */
const CreateBroadcastArgs = z
  .object({
    position: z.string().trim().min(1).max(120),
    workers_needed: z.number().int().positive().max(50),
    shift_date: isoDate,
    // The service takes HH:MM; validated here so a bad time fails at PROPOSAL
    // time rather than after the manager has confirmed a call that cannot run.
    shift_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM'),
    shift_end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM'),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type CreateBroadcastArgs = z.infer<typeof CreateBroadcastArgs>;

export const createBroadcast = registerTool<CreateBroadcastArgs>({
  name: 'job_requests.create_broadcast',
  description:
    'Draft a staffing request for a shift that needs workers. Use for "I need 3 ' +
    'cleaners on Thursday 8am to 4pm", "raise a request for two housekeepers ' +
    'tomorrow morning", "ich brauche zwei Reinigungskrafte am Montag". Give the ' +
    'position, how many workers are needed, the date as YYYY-MM-DD, and the start ' +
    'and end times as HH:MM. Returns the draft that was created.\n\n' +
    'It is saved as a DRAFT and is NOT sent to anyone. The manager publishes it ' +
    'from the app when the details are right. Pay rate and requirements are set ' +
    'there too, not here. To place a specific named worker directly instead of ' +
    'asking for volunteers, use assignments.place_worker.',
  tier: 'LOW_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-JR-CreateWorkRequest (job-requests/service.ts create())',
  approvalRef:
    APPROVED_2026_09_09_PLANNING +
    ' Registration note: creates a DRAFT only; publishing to OPEN stays a human action in the UI.',

  args: CreateBroadcastArgs,
  permission: 'staffing:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);

    // The service's own rule, restated so an impossible shift is refused
    // before anything is written rather than stored and puzzled over later.
    if (args.shift_end_time <= args.shift_start_time) {
      return refuse(
        'NEEDS_INPUT',
        `A shift cannot end at ${args.shift_end_time} when it starts at ${args.shift_start_time}. ` +
          'Overnight shifts are not supported here -- ask for the end time again.'
      );
    }

    const created = await jobRequestService.create(
      {
        hotel_id: hotel.hotelId,
        target_role: 'WORKER',
        position: args.position,
        workers_needed: args.workers_needed,
        shift_date: args.shift_date,
        shift_start_time: args.shift_start_time,
        shift_end_time: args.shift_end_time,
        // Pinned, never an argument. See the note above.
        status: 'DRAFT',
      },
      toServiceActor(actor)
    );

    return { hotel: hotel.name, request: created };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | {
          hotel?: string;
          request?: { position?: string; workers_needed?: number; shift_date?: string };
        }
      | null;
    if (!result) return { summary: 'Nothing was created.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const r = result.request ?? {};
    return {
      summary:
        `Drafted a request for ${r.workers_needed} x ${r.position} at ${result.hotel} on ` +
        `${r.shift_date}. It has NOT been sent -- publish it from the app to notify workers.`,
      data: {
        hotel: result.hotel,
        position: r.position,
        workers_needed: r.workers_needed,
        shift_date: r.shift_date,
        status: 'DRAFT',
      },
    };
  },
  maxResultTokens: 120,
});

/* ------------------------------------------------------------------ *
 * attendance.team_status
 * ------------------------------------------------------------------ */

/**
 * Who actually turned up -- distinct from who was scheduled.
 *
 * `assignments.list_for_my_team` answers the PLAN. This answers the FACT, and
 * the gap between them is the manager's most time-critical question of the
 * day: a no-show has an assignment and no check-in, so the plan alone cannot
 * show it. `attendanceService.list` filters on `expected_start` rather than
 * `check_in_at` for precisely that reason -- a no-show must still appear.
 *
 * Names come from `AttendanceDto.worker`, which the DTO already resolves for
 * its read paths. Reporting tools on this platform have twice shipped with a
 * blank worker column because a DTO carried only ids; that is checked here
 * rather than assumed.
 */
const TeamStatusArgs = z
  .object({
    // Optional: "who has clocked in?" means today, and forcing the manager to
    // say so would be worse than defaulting.
    day: isoDate.optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type TeamStatusArgs = z.infer<typeof TeamStatusArgs>;

/** Enough rows to answer a shift's worth of question without flooding context. */
const TEAM_STATUS_LIMIT = 40;

export const teamStatus = registerTool<TeamStatusArgs>({
  name: 'attendance.team_status',
  description:
    'Show who has actually clocked in and out today, and who has not turned up. ' +
    'Use for "who has clocked in?", "did Anna arrive?", "is anyone missing this ' +
    'morning?", "wer ist heute da?". The day is optional and defaults to today; ' +
    'give it as YYYY-MM-DD for another day. Returns each worker with their ' +
    'check-in and check-out times, how many minutes late they were if they ' +
    'were late, or that they have not checked in at all. Use it for "who is ' +
    'late?" too.\n\n' +
    'This is what ACTUALLY happened. For who is SCHEDULED to work, use ' +
    'assignments.list_for_my_team. For whether someone is free to be given a ' +
    'shift, use calendar.check_availability. For who is on the team at all, use ' +
    'users.find_team_member.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ATT-List (attendance/service.ts list())',
  approvalRef:
    APPROVED_2026_09_09_PLANNING +
    ' Registration note: reads in-scope attendance rows the caller can already read over HTTP; adds no field.',

  args: TeamStatusArgs,
  permission: 'staffing:read',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);

    const day = args.day ?? todayIso();

    const result = await attendanceService.list(
      {
        hotel_id: hotel.hotelId,
        // Both or neither: a half-open range is rejected by the schema.
        from: day,
        to: day,
        page: 1,
        per_page: TEAM_STATUS_LIMIT,
      } as never,
      toServiceActor(actor)
    );

    return { hotel: hotel.name, day, total: result.total, rows: result.data };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | {
          hotel?: string;
          day?: string;
          total?: number;
          rows?: Array<{
            worker?: { full_name?: string | null } | null;
            check_in_at?: string | null;
            check_out_at?: string | null;
            minutes_late?: number | null;
            status?: string;
          }>;
        }
      | null;
    if (!result) return { summary: 'Nothing was found.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const rows = result.rows ?? [];
    if (rows.length === 0) {
      return {
        summary: `No attendance recorded at ${result.hotel} on ${result.day}.`,
        data: { hotel: result.hotel, day: result.day, present: 0, missing: 0 },
      };
    }

    const present = rows.filter((r) => r.check_in_at);
    const missing = rows.filter((r) => !r.check_in_at);
    const late = rows.filter((r) => typeof r.minutes_late === 'number' && r.minutes_late > 0);
    const hhmm = (iso?: string | null) => (iso ? iso.slice(11, 16) : null);

    // LATENESS, which the DTO already carried and this ignored.
    //
    // "whos late" is a manager's question every single morning, and it routes
    // here -- correctly -- but the answer listed arrival times and left them
    // to compare each against a shift start they were not shown. The service
    // computes `minutes_late` already.
    const lines = rows.slice(0, 15).map((r) => {
      const name = r.worker?.full_name ?? 'unnamed worker';
      if (!r.check_in_at) return `${name}: not checked in`;
      const out = hhmm(r.check_out_at);
      const late = typeof r.minutes_late === 'number' && r.minutes_late > 0
        ? ` (${r.minutes_late} min late)`
        : '';
      return `${name}: in ${hhmm(r.check_in_at)}${late}${out ? `, out ${out}` : ', still on shift'}`;
    });

    const more = rows.length > 15 ? ` (+${rows.length - 15} more)` : '';
    const capped =
      (result.total ?? 0) > TEAM_STATUS_LIMIT
        ? ` Showing the first ${TEAM_STATUS_LIMIT} of ${result.total}.`
        : '';

    return {
      summary:
        `${present.length} checked in${late.length > 0 ? ` (${late.length} late)` : ''}, ` +
        `${missing.length} not, at ${result.hotel} on ${result.day}.${capped} ` +
        `${lines.join('; ')}${more}`,
      data: {
        hotel: result.hotel,
        day: result.day,
        present: present.length,
        missing: missing.length,
        late: late.length,
      },
    };
  },
  maxResultTokens: 400,
});

/* ------------------------------------------------------------------ *
 * users.find_team_member
 * ------------------------------------------------------------------ */

/**
 * Who is on the team at all.
 *
 * The discovery step the write tools assume. `resolveWorkerReference` turns a
 * name into an id, but the manager has to know the name first -- and after a
 * new starter or a transfer they often do not. Without this the assistant
 * could act on people it could not help you find.
 *
 * `listUsers` is default-deny scope-resolved (`resolveNonAdminScopeFilter`,
 * ADR-030 PR-4 FIND-01): a non-admin never resolves to global scope, so this
 * cannot list the platform. The page cap below is a context guard, not a
 * security one -- the scope filter is the security one, and it is the
 * service's.
 */
const FindTeamMemberArgs = z
  .object({
    // Optional: "who is on my team" is a real question with no name in it.
    name: z.string().trim().min(2).max(80).optional(),
    // NOT named `role`: that is a FORBIDDEN_ARG_KEY, and the compile-time
    // SafeArgs guard rejects it outright. The guard is right to be blunt --
    // an argument called `role` in a tool schema is one rename away from
    // reading as the CALLER's role, which is an authorization input and is
    // re-derived from req.auth, never accepted from the model.
    staff_type: z.enum(['worker', 'checker', 'manager']).optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type FindTeamMemberArgs = z.infer<typeof FindTeamMemberArgs>;

const ROSTER_LIMIT = 25;

export const findTeamMember = registerTool<FindTeamMemberArgs>({
  name: 'users.find_team_member',
  description:
    'Look up who is on the team, by name or by role. Use for "who is on my team?", ' +
    '"is there a Maria at the hotel?", "list my checkers", "wer arbeitet bei uns?". ' +
    'Give a name to search for, or a staff type (worker, checker or manager) to ' +
    'list just those. Both are optional -- with neither, it lists the team. Returns each ' +
    "person's name and role.\n\n" +
    'This is the STAFF LIST, not a schedule. For who is working today use ' +
    'assignments.list_for_my_team, for who has clocked in use ' +
    'attendance.team_status, and for whether one person is free on a day use ' +
    'calendar.check_availability. It returns no contact details, and it cannot ' +
    'change anyone.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-USR-ListUsers (users/service.ts listUsers())',
  approvalRef:
    APPROVED_2026_09_09_PLANNING +
    ' Registration note: name and role only; no email, phone, address or any special-category field.',

  args: FindTeamMemberArgs,
  permission: 'users:read',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);

    const result = await userService.listUsers(
      {
        page: 1,
        limit: ROSTER_LIMIT,
        hotel_id: hotel.hotelId,
        ...(args.name ? { search: args.name } : {}),
        ...(args.staff_type ? { role: args.staff_type } : {}),
      } as never,
      toServiceActor(actor)
    );

    const rows = (result as { data?: Array<Record<string, unknown>>; total?: number }).data ?? [];
    const total = (result as { total?: number }).total ?? rows.length;

    if (rows.length === 0) {
      return refuse(
        'NOT_FOUND',
        args.name
          ? `Nobody matching "${args.name}" is on the team at ${hotel.name}.`
          : `No team members are listed at ${hotel.name}.`
      );
    }

    return {
      hotel: hotel.name,
      total,
      // Name and role ONLY. The DTO carries email and more; passing the row
      // through would put contact details into a model's context for a
      // question that never asked for them.
      people: rows.map((r) => ({
        name: String(r['full_name'] ?? 'unnamed'),
        role: String(r['role'] ?? '').toLowerCase(),
      })),
    };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | { hotel?: string; total?: number; people?: Array<{ name: string; role: string }> }
      | null;
    if (!result) return { summary: 'Nothing was found.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const people = result.people ?? [];
    const capped =
      (result.total ?? 0) > people.length
        ? ` Showing ${people.length} of ${result.total}; narrow it by name or role.`
        : '';

    return {
      summary:
        `${result.total} at ${result.hotel}.${capped} ` +
        people.map((p) => `${p.name} (${p.role})`).join(', '),
      data: { hotel: result.hotel, total: result.total, people },
    };
  },
  maxResultTokens: 300,
});

/* ------------------------------------------------------------------ *
 * calendar.team_absences
 * ------------------------------------------------------------------ */

/**
 * WHO IS OFF -- the read that was missing, and whose absence was dangerous.
 *
 * FOUND 2026-09-10 by probing with the words managers actually use. Asked
 * "who called in sick", the assistant selected `calendar.mark_worker_absence`
 * and proposed `{worker_name: "Anna", kind: "SICK"}` -- inventing a worker and
 * offering to MARK HER SICK in answer to a question about who already was.
 * "wer ist heute krank" fared no better: `list_for_my_team` with
 * `status: CANCELLED`, which means nothing of the sort.
 *
 * Neither is really a model failure. The registry had exactly one
 * absence-shaped tool and it was a WRITE, so a question about absence had
 * nowhere correct to go. A manifest that offers only a write for a subject
 * people ask read questions about is a manifest that invites this, and no
 * amount of description tuning fixes it -- the missing capability has to
 * exist. The confirmation gate would have caught the write before it landed,
 * but "the safety net holds" is not the standard: the assistant should not
 * have been proposing it.
 *
 * `GET /calendar/absences` already existed, already restricted to
 * manager/RM/admin, and already resolves worker names. Nothing needed
 * building except the tool.
 */
const TeamAbsencesArgs = z
  .object({
    // Optional: "who is off" means today, and making a manager say so would
    // be worse than defaulting.
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine((v) => (v.from == null) === (v.to == null), {
    message: 'from and to must be given together',
    path: ['to'],
  });

type TeamAbsencesArgs = z.infer<typeof TeamAbsencesArgs>;

const ABSENCE_LIMIT = 40;

export const teamAbsences = registerTool<TeamAbsencesArgs>({
  name: 'calendar.team_absences',
  description:
    'Show which of the team is OFF -- sick or on holiday. Use for "who called in ' +
    'sick?", "who is off today?", "is anyone away this week?", "wer ist heute ' +
    'krank?", "wer hat Urlaub?". Defaults to today; pass from and to as YYYY-MM-DD ' +
    'for another day or a period. Returns each absent person, whether it is sick ' +
    'leave or holiday, and the day.\n\n' +
    'This only READS. It never records anything -- to record that someone is off, ' +
    'use calendar.mark_worker_absence, and only when you are told they ARE off ' +
    'rather than asked who is.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-CAL-ListAbsences (calendar/service.ts listAbsences())',
  approvalRef:
    APPROVED_2026_09_09_PLANNING +
    ' Registration note: READ_ONLY over GET /calendar/absences, which is already manager/RM/admin only and scope-filtered in-service.',

  args: TeamAbsencesArgs,
  permission: 'staffing:read',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const day = args.from ?? todayIso();
    const rows = await calendarService.listAbsences(
      { from: day, to: args.to ?? day },
      toServiceActor(actor)
    );
    return { from: day, to: args.to ?? day, rows: rows.slice(0, ABSENCE_LIMIT), total: rows.length };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | {
          from?: string;
          to?: string;
          total?: number;
          rows?: Array<{ worker_name?: string | null; kind?: string; day?: string }>;
        }
      | null;
    if (!result) return { summary: 'Nothing was found.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const rows = result.rows ?? [];
    const sameDay = result.from === result.to;
    const period = sameDay ? `on ${result.from}` : `between ${result.from} and ${result.to}`;

    if (rows.length === 0) {
      return {
        summary: `Nobody on your team is recorded as off ${period}.`,
        data: { from: result.from, to: result.to, count: 0 },
      };
    }

    const described = rows.map((r) => {
      const who = r.worker_name ?? 'unnamed worker';
      const what = String(r.kind ?? '').toUpperCase() === 'VACATION' ? 'holiday' : 'sick';
      return sameDay ? `${who} (${what})` : `${who} (${what}, ${r.day})`;
    });

    const capped =
      (result.total ?? 0) > rows.length ? ` Showing ${rows.length} of ${result.total}.` : '';

    return {
      summary: `${result.total} off ${period}:${capped} ${described.join(', ')}.`,
      // Deliberately no reason: why somebody is off is their business, and a
      // sick-leave reason is health data.
      data: { from: result.from, to: result.to, count: result.total },
    };
  },
  maxResultTokens: 300,
});

/* ------------------------------------------------------------------ *
 * attendance.correct_times
 * ------------------------------------------------------------------ */

/**
 * Interpret `day` + `HH:MM` as a Europe/Berlin wall-clock time.
 *
 * A manager saying "she left at 16:30" means half four in Frankfurt, not in
 * UTC. Building `new Date(\`${day}T${time}:00Z\`)` would store an instant one
 * or two hours out depending on the season, and that error lands directly in
 * paid minutes -- which is the one place on this platform where being an hour
 * wrong is not cosmetic.
 *
 * The offset is derived from the zone at that instant rather than assumed,
 * so it is right on both sides of the DST switch. The one case it cannot
 * resolve is a time inside the spring-forward gap (02:30 on the changeover
 * night does not exist); that lands on the hour after, which is the only
 * answer available and is a shift nobody works.
 */
export function berlinInstant(day: string, hhmm: string): Date {
  const asIfUtc = Date.parse(`${day}T${hhmm}:00Z`);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: CALENDAR_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(asIfUtc))
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;

  const shownAsUtc = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
  );

  // How far ahead of UTC the zone was at that instant.
  return new Date(asIfUtc - (shownAsUtc - asIfUtc));
}

/**
 * A MANAGER FIXING A TIMESHEET -- the capability held back until now, and the
 * reasons for holding it are what shape it.
 *
 * "I forgot to clock out yesterday" is among the commonest things a worker
 * says, and a worker CANNOT fix it: attendance `update()` forces server time
 * on the self branch and refuses an already-closed record, deliberately, to
 * stop time manipulation. Only a manager can, so until now the assistant's
 * only honest answer was "ask your manager" -- and the manager then had no way
 * to do it from here either.
 *
 * WHAT THIS DELIBERATELY DOES NOT EXPOSE, and this is the whole design. The
 * manager branch of `update()` also accepts `minutes_worked`, `minutes_late`
 * and `is_verified`. `minutes_worked` is a DIRECT WRITE OF PAID TIME, derived
 * from nothing: whoever sets it decides what a shift is worth. This tool
 * cannot set it. It sets the CLOCK TIMES, and the service recomputes minutes
 * from them -- so a correction is always a claim about when somebody arrived
 * or left, checkable against a roster, rather than a number typed into a pay
 * field. `is_verified` is excluded for the same reason: signing a timesheet
 * off is an act, not a correction.
 *
 * A REASON IS REQUIRED, unlike the HTTP route, which treats notes as
 * optional. Every correction here lands in `notes` and therefore in the
 * record a dispute would be argued from. A change to paid time with no
 * stated cause is exactly what an audit cannot evaluate later, and the
 * assistant is the one path where the person making the change is not
 * looking at the timesheet while they do it.
 *
 * `confirm: true` and HIGH_RISK_WRITE: the manager sees the resolved worker,
 * the day, and the exact times before anything is written.
 */
const CorrectTimesArgs = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: isoDate,
    // HH:MM, 24-hour. At least one is required (refined below).
    check_in: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM').optional(),
    check_out: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM').optional(),
    reason: z.string().trim().min(3).max(200),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.check_in || v.check_out), {
    message: 'give a check_in time, a check_out time, or both',
    path: ['check_out'],
  });

type CorrectTimesArgs = z.infer<typeof CorrectTimesArgs>;

export const correctTimes = registerTool<CorrectTimesArgs>({
  name: 'attendance.correct_times',
  description:
    "Correct the clock-in or clock-out time on one of the manager's OWN workers' " +
    'timesheets for a past day. Use when you are told a time was missed or is wrong: ' +
    '"Anna forgot to clock out yesterday, she left at 16:30", "Tomasz actually ' +
    'started at 07:00 on Monday", "korrigiere Annas Stempelzeit". Give the worker\'s ' +
    'name, the day as YYYY-MM-DD, the times as HH:MM, and a short reason. Returns ' +
    'the corrected times and the hours they now add up to.\n\n' +
    'ALWAYS ask for the actual time and the reason if you were not given them -- ' +
    'never guess either. This changes what someone is PAID. It cannot set hours or ' +
    'mark a timesheet verified; it sets the clock times and the hours are ' +
    'recalculated from them. A worker cannot use this on their own record: they ' +
    'clock out with attendance.check_out, and only for today.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-ATT-Update (attendance/service.ts update())',
  approvalRef:
    APPROVED_2026_09_09_PLANNING +
    ' Registration note: manager-scoped correction of clock TIMES only; minutes_worked, minutes_late and is_verified are deliberately not exposed, and a reason is mandatory.',

  args: CorrectTimesArgs,
  // The PATCH route enforces no token -- it is shared with a worker's own
  // check-out, and the service's role branch is the real gate. `staffing:write`
  // is the closest capability this caller must already hold (manager, RM and
  // admin only; no worker has it), and it is route-checked elsewhere, so this
  // names a real permission rather than inventing one.
  permission: 'staffing:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);

    const resolved = await resolveWorkerReference(args.worker_name, actor, hotel.hotelId);
    if (resolved.status !== 'RESOLVED') return refuseUnresolved(resolved);

    const serviceActor = toServiceActor(actor);

    // The record is found from the roster, never named by the caller: an
    // attendance id is not something a manager has or should supply.
    const { data } = await attendanceService.list(
      { worker_id: resolved.workerId, from: args.day, to: args.day, page: 1, per_page: 5 } as never,
      serviceActor
    );

    const rows = (data ?? []) as Array<{ id: string }>;
    if (rows.length === 0) {
      return refuse(
        'NOT_FOUND',
        `${resolved.fullName} has no attendance record for ${args.day}, so there is nothing to correct.`
      );
    }
    if (rows.length > 1) {
      return refuse(
        'AMBIGUOUS',
        `${resolved.fullName} has more than one attendance record on ${args.day}. ` +
          'Correct it in the app, where each shift can be picked individually.'
      );
    }

    const updated = await attendanceService.update(
      rows[0]!.id,
      {
        ...(args.check_in ? { check_in_at: berlinInstant(args.day, args.check_in).toISOString() } : {}),
        ...(args.check_out ? { check_out_at: berlinInstant(args.day, args.check_out).toISOString() } : {}),
        // The reason travels into the record itself, attributed, so a dispute
        // is argued from the timesheet rather than from memory.
        notes: `Corrected via assistant: ${args.reason}`,
      } as never,
      serviceActor.userId,
      serviceActor.role,
      serviceActor.scope ?? null
    );

    return { worker: resolved.fullName, day: args.day, attendance: updated };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | {
          worker?: string;
          day?: string;
          attendance?: { check_in_at?: string | null; check_out_at?: string | null; minutes_worked?: number | null };
        }
      | null;
    if (!result) return { summary: 'Nothing was changed.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const hhmm = (iso?: string | null) =>
      iso
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone: CALENDAR_TIMEZONE,
            hourCycle: 'h23',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(iso))
        : null;

    const minutes = result.attendance?.minutes_worked ?? null;
    const hours = typeof minutes === 'number' ? Math.round((minutes / 60) * 10) / 10 : null;

    return {
      summary:
        `${result.worker}'s timesheet for ${result.day} now reads ` +
        `${hhmm(result.attendance?.check_in_at) ?? 'no clock-in'} to ` +
        `${hhmm(result.attendance?.check_out_at) ?? 'no clock-out'}` +
        `${hours !== null ? ` -- ${hours} hours` : ''}.`,
      data: {
        worker: result.worker,
        day: result.day,
        // Times shown back in Berlin, the way they were given.
        check_in: hhmm(result.attendance?.check_in_at),
        check_out: hhmm(result.attendance?.check_out_at),
        hours,
      },
    };
  },
  maxResultTokens: 120,
});
