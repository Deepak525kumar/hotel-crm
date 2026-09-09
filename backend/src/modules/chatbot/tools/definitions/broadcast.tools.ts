import { z } from 'zod';
import { jobRequestService } from '../../../job-requests/service.js';
import { isJobDispatchPhase2Enabled } from '../../../../config/feature-flags.js';
import { toServiceActor } from '../actor.js';
import { APPROVED_2026_09_09 } from '../approvals.js';
import { registerTool, type CompactResult } from '../registry.js';
import { isoDate } from '../schema-primitives.js';
import { asRefusal, refuse } from '../tool-errors.js';
import type { ActorContext } from '../actor.js';

/**
 * PICKING UP AN OPEN SHIFT.
 *
 * The highest-value worker action that had no tool: a broadcast is how open
 * shifts reach staff, and accepting one is the difference between a shift
 * being covered and a hotel being short. It is also the action most likely to
 * be taken on a phone, in a hurry, by someone who will not open a marketplace
 * screen to do it.
 *
 * THE BROADCAST IS RESOLVED, NEVER NAMED. `acceptBroadcast` takes a job
 * request id, and a model has none -- the same defect that made
 * `notifications.mark_read` and `quality.assign_rework` unreachable in
 * practice until they were fixed. A person says "I'll take the Tuesday
 * shift", so the day is the argument and the broadcast is looked up from what
 * the caller is actually eligible for.
 *
 * SCOPE IS THE OWNING SERVICE'S, TWICE OVER. `list()` already narrows a
 * self-scoped caller to hotels where they hold an ACTIVE roster membership
 * and to their own `target_role` -- a worker never sees a checker-targeted
 * broadcast. `acceptBroadcast()` then re-checks role targeting, roster
 * eligibility, skill match and daily exclusivity itself. Nothing here widens
 * either, and the resolution set is the service's own answer to "what may
 * this person see".
 *
 * BEHIND A FEATURE FLAG that is not the chatbot's. Job dispatch phase 2 has
 * its own flag, and its routes 404 when it is off. These tools check it and
 * refuse plainly rather than surfacing a confusing failure from a feature the
 * platform has not enabled.
 */

interface BroadcastLike {
  id: string;
  hotel_id?: string;
  hotel?: { name?: string } | null;
  shift_date?: string;
  position?: string;
  status?: string;
}

type BroadcastResolution =
  | { status: 'RESOLVED'; broadcast: BroadcastLike }
  | { status: 'DISABLED' }
  | { status: 'NONE'; day: string }
  | { status: 'AMBIGUOUS'; day: string; candidates: string[] };

const hotelName = (b: BroadcastLike) => b.hotel?.name ?? 'a hotel';

/**
 * Open broadcasts this caller could actually accept, for one day.
 *
 * The candidate set comes from the owning service with the caller's own
 * actor, so it is already narrowed to their roster hotels and their role.
 * Filtering by day happens after because `list()` takes a single
 * `shift_date`, which is exactly what is wanted here.
 */
async function resolveBroadcast(
  actor: ActorContext,
  day: string,
  hotelNameQuery?: string
): Promise<BroadcastResolution> {
  if (!isJobDispatchPhase2Enabled()) return { status: 'DISABLED' };

  const { data } = await jobRequestService.list(
    { status: 'OPEN', shift_date: day, page: 1, per_page: 50 } as Parameters<
      typeof jobRequestService.list
    >[0],
    toServiceActor(actor)
  );

  let candidates = data as BroadcastLike[];

  if (hotelNameQuery) {
    const needle = hotelNameQuery.trim().toLowerCase();
    candidates = candidates.filter((b) => (b.hotel?.name ?? '').toLowerCase().includes(needle));
  }

  if (candidates.length === 0) return { status: 'NONE', day };
  if (candidates.length > 1) {
    // Two open shifts on one day at different hotels is ordinary. Picking one
    // would commit somebody's day to the wrong place.
    return {
      status: 'AMBIGUOUS',
      day,
      candidates: candidates.slice(0, 5).map(hotelName),
    };
  }
  return { status: 'RESOLVED', broadcast: candidates[0] };
}

function refuseUnresolvedBroadcast(result: BroadcastResolution) {
  // DISABLED is the platform lacking the feature, not the shift being absent:
  // a different day will not help, so it must not read as ask_user.
  const code =
    result.status === 'DISABLED' ? 'UNAVAILABLE'
    : result.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
    : 'NOT_FOUND';
  return refuse(code, describeUnresolvedBroadcast(result));
}

function describeUnresolvedBroadcast(result: BroadcastResolution): string {
  switch (result.status) {
    case 'DISABLED':
      return 'Open shifts are not available on this platform yet.';
    case 'NONE':
      return `There are no open shifts you can take on ${result.day}.`;
    case 'AMBIGUOUS':
      return (
        `There is more than one open shift on ${result.day}: ` +
        `${result.candidates.join(', ')}. Which hotel?`
      );
    default:
      return 'Could not identify that shift.';
  }
}

// ---------------------------------------------------------------------------

const ListOpenArgs = z
  .object({
    day: isoDate.optional(),
  })
  .strict();

type ListOpenArgs = z.infer<typeof ListOpenArgs>;

export const listOpenShifts = registerTool<ListOpenArgs>({
  name: 'job_requests.list_open',
  description:
    'List open shifts the authenticated user can pick up. Use for "any shifts going", ' +
    '"is there extra work", "gibt es freie Schichten", "what can I pick up on Friday". ' +
    'Optionally give a day as YYYY-MM-DD to narrow it. Returns the day, hotel and role ' +
    'for each open shift, and only ever ones this person is eligible for.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-JOB-ListWorkRequests (job-requests/service.ts list())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    'READ_ONLY. The candidate set is the owning service\'s own scoped answer: a ' +
    'self-scoped caller sees only their roster hotels and their own target_role.',

  args: ListOpenArgs,
  // The route carries no requirePermission -- it is worker-initiated and the
  // service enforces roster eligibility itself. READ_ONLY + self-scoped is
  // the envelope the registry allows `null` for.
  permission: null,
  permissionRationale:
    'GET /job-requests carries no requirePermission: it is a worker-facing read and ' +
    'list() narrows a self-scoped caller to hotels where they hold an ACTIVE roster ' +
    'membership and to their own target_role, so a worker never sees a ' +
    "checker-targeted request. The caller's own id is not expressible as an argument.",
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    if (!isJobDispatchPhase2Enabled()) {
      return refuse('UNAVAILABLE', 'Open shifts are not available on this platform yet.');
    }

    const { data } = await jobRequestService.list(
      {
        status: 'OPEN',
        ...(args.day ? { shift_date: args.day } : {}),
        page: 1,
        per_page: 20,
      } as Parameters<typeof jobRequestService.list>[0],
      toServiceActor(actor)
    );

    return { shifts: data as BroadcastLike[] };
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { shifts?: BroadcastLike[] } | null;
    if (!r) return { summary: 'Could not read open shifts.', data: null };
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const shifts = r.shifts ?? [];
    if (shifts.length === 0) {
      return { summary: 'There are no open shifts for you right now.', data: { count: 0 } };
    }

    const lines = shifts
      .slice(0, 10)
      .map((s) => `${s.shift_date} at ${hotelName(s)}${s.position ? ` (${s.position})` : ''}`);

    return {
      summary: `${shifts.length} open shift${shifts.length === 1 ? '' : 's'}: ${lines.join('; ')}.`,
      // Days and hotel names only -- no job request ids. The accept tool
      // resolves by day, so an id here would be a string the model might
      // repeat back and could not use.
      data: { count: shifts.length, shifts: lines },
    };
  },
  maxResultTokens: 400,
});

const AcceptArgs = z
  .object({
    day: isoDate,
    // A NAME, never an id. Only needed when more than one open shift falls on
    // the same day, which the refusal says explicitly.
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type AcceptArgs = z.infer<typeof AcceptArgs>;

export const acceptOpenShift = registerTool<AcceptArgs>({
  name: 'job_requests.accept',
  description:
    "Accept an open shift for the authenticated user. Use for \"I'll take the Tuesday " +
    'shift", "ich nehme die Schicht am 12.", "sign me up for Friday". Give the day as ' +
    'YYYY-MM-DD, and the hotel name only if more than one shift is open that day. ' +
    "Commits the caller's own day and notifies the hotel.",
  // It commits a day of somebody's life and takes a slot other people were
  // also offered. A worker cannot un-accept it themselves -- withdrawal is a
  // separate, manager-visible action -- so the actor sees the exact shift
  // before it is claimed.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-JOB-AcceptBroadcast (job-requests/service.ts acceptBroadcast())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    "commits the caller's own day and claims a slot from a shared pool, so a mistake " +
    'costs both this person and whoever else wanted the shift.',

  args: AcceptArgs,
  permission: 'job_requests:accept-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const resolved = await resolveBroadcast(actor, args.day, args.hotel_name);
    if (resolved.status !== 'RESOLVED') {
      return refuseUnresolvedBroadcast(resolved);
    }

    // WHICH SLOT. A multi-skill broadcast needs the skill named, and the
    // service's own eligibility view is the only honest source for which
    // slots this person actually qualifies for -- guessing would produce a
    // refusal the person cannot act on.
    const eligibility = await jobRequestService.getBroadcastEligibility(
      resolved.broadcast.id,
      toServiceActor(actor)
    );

    const open = (eligibility.slots ?? []).filter(
      (slot: { eligible?: boolean; headcount: number; confirmed_count: number }) =>
        slot.eligible !== false && slot.confirmed_count < slot.headcount
    );

    if (open.length === 0) {
      return refuse('ALREADY_DONE', 'That shift has already been filled.');
    }
    if (open.length > 1) {
      // Refused rather than guessed: accepting as the wrong skill puts
      // somebody on a job they are not there to do.
      return refuse(
        'AMBIGUOUS',
        'That shift has more than one role open and I cannot tell which you mean. ' +
          'Please use the app for this one.'
      );
    }

    const result = await jobRequestService.acceptBroadcast(
      resolved.broadcast.id,
      open[0].skill as Parameters<typeof jobRequestService.acceptBroadcast>[1],
      toServiceActor(actor)
    );

    return {
      accepted: true,
      day: resolved.broadcast.shift_date ?? args.day,
      hotel: hotelName(resolved.broadcast),
      result,
    };
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as
      | { day?: string; hotel?: string; result?: { status?: string } }
      | null;
    if (!r) return { summary: 'Nothing was accepted.', data: null };
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    // A LOST RACE IS NOT AN ERROR. The service returns "requirement
    // fulfilled" when somebody else claimed the last slot between the read
    // and the write, and the honest answer is that the shift is gone -- not
    // that something broke.
    if (r.result?.status === 'REQUIREMENT_FULFILLED') {
      return {
        summary: 'Someone else took that shift just before you. It is no longer open.',
        data: null,
      };
    }

    return {
      summary: `You are booked for ${r.day} at ${r.hotel}.`,
      data: { day: r.day, hotel: r.hotel },
    };
  },
  maxResultTokens: 120,
});
