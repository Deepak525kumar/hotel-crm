import { z } from 'zod';
import { employeeManagementService } from '../../../employee-management/service.js';
import { crmService } from '../../../crm/service.js';
import { toServiceActor } from '../actor.js';
import { APPROVED_2026_09_09 } from '../approvals.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { resolveHotelReference, refuseUnresolvedHotel } from '../worker-reference.js';
import type { ActorContext } from '../actor.js';

/**
 * TEAM MANAGEMENT — reads and writes over the people a manager already
 * manages, inside the scope they already hold.
 *
 * `ADR-073` is what permits this at all: the assistant's authority is the
 * user's own authority, never more. A manager may approve an application
 * through the assistant precisely because they can approve it by hand, and
 * only for the applications their own review queue contains.
 *
 * SCOPE IS THE OWNING SERVICE'S, AND IT IS NOT RE-IMPLEMENTED HERE.
 * `getReviewQueue` filters by the same resolver that decides who gets
 * NOTIFIED about a review, so the queue a manager sees here is exactly the
 * queue they see in the app -- a divergence between those two would be a
 * manager acting on somebody they were never told about.
 * `assertLifecycleAuthority` then re-checks every write independently.
 *
 * THE APPLICANT IS RESOLVED FROM THAT QUEUE, never named by an id. Every
 * write here takes a person's NAME and matches it against the caller's own
 * pending queue: scope first, match second, the same shape as
 * `resolveWorkerReference`. An applicant outside the caller's scope is
 * therefore indistinguishable from one who does not exist, and no employee id
 * is ever an argument.
 *
 * DELIBERATELY EXCLUDED, and this is a boundary rather than an omission:
 *
 *   - `delete` / `restore` -- GDPR erasure. Irreversible, and a chat message
 *     is the wrong place to initiate it.
 *   - role changes and user creation -- these mint authority rather than
 *     exercise it, so "the manager could do it by hand" does not carry the
 *     same weight.
 *   - hotel and hotel-group CRUD -- master data, admin-only, and nothing
 *     about it is conversational.
 *
 * Each of those needs its own decision if it is ever wanted. None is blocked
 * by anything here; they are simply not in this batch.
 */

interface ApplicantLike {
  employee_id?: string;
  user?: { first_name?: string | null; last_name?: string | null } | null;
  position?: string | null;
  submitted_for_review_at?: string | Date | null;
}

type ApplicantResolution =
  | { status: 'RESOLVED'; applicant: ApplicantLike; name: string }
  | { status: 'NOT_FOUND'; query: string }
  | { status: 'AMBIGUOUS'; query: string; candidates: string[] };

const fullName = (a: ApplicantLike) =>
  [a.user?.first_name, a.user?.last_name].filter(Boolean).join(' ') || 'unnamed applicant';

/**
 * The two ways a German name gets typed, both produced for matching.
 *
 * `ü` has two conventional ASCII spellings and people use both: the expansion
 * (`Jürgen` -> `juergen`, the German convention) and the bare letter
 * (`jurgen`, what a keyboard without umlauts produces). Matching only the
 * expansion means somebody typing "Jurgen" matches nothing, which was a real
 * test failure here and would have been a real manager unable to approve
 * somebody by name.
 *
 * Both forms are compared, so all three spellings find the same person.
 */
function foldForms(text: string): string[] {
  const lower = text.toLowerCase().trim();
  const expanded = lower
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  // NFKD then strip combining marks -- REMOVE them, never replace with a
  // space, which was a defect the L0 router already had to fix once.
  const stripped = lower.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/ß/g, 'ss');
  return expanded === stripped ? [expanded] : [expanded, stripped];
}

/** True when `query` appears in any accepted spelling of `name`. */
function nameMatches(name: string, query: string): boolean {
  const haystacks = foldForms(name);
  return foldForms(query).some((needle) =>
    haystacks.some((haystack) => haystack.includes(needle))
  );
}

/**
 * The applicant a manager means, from their OWN review queue.
 *
 * The queue is the candidate set on purpose: it is the exact population this
 * caller may act on, already narrowed by the owning service. Searching users
 * generally and then checking authority would be the same answer reached in
 * the wrong order -- and the wrong order is what leaks the existence of
 * people outside a caller's scope.
 */
async function resolveApplicant(
  actor: ActorContext,
  query: string
): Promise<ApplicantResolution> {
  const queue = (await employeeManagementService.getReviewQueue(
    toServiceActor(actor) as never
  )) as ApplicantLike[] | { data?: ApplicantLike[] };

  const rows = (Array.isArray(queue) ? queue : (queue.data ?? [])) as ApplicantLike[];
  const matches = rows.filter((row) => nameMatches(fullName(row), query));

  if (matches.length === 0) return { status: 'NOT_FOUND', query };
  if (matches.length > 1) {
    return { status: 'AMBIGUOUS', query, candidates: matches.slice(0, 5).map(fullName) };
  }
  return { status: 'RESOLVED', applicant: matches[0], name: fullName(matches[0]) };
}

function refuseUnresolvedApplicant(result: ApplicantResolution) {
  return refuse(
    result.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NOT_FOUND',
    describeUnresolvedApplicant(result)
  );
}

function describeUnresolvedApplicant(result: ApplicantResolution): string {
  if (result.status === 'NOT_FOUND') {
    return `No one matching "${result.query}" is waiting for your review.`;
  }
  if (result.status === 'AMBIGUOUS') {
    return (
      `More than one applicant matches "${result.query}": ` +
      `${result.candidates.join(', ')}. Please use a fuller name.`
    );
  }
  return 'Could not identify that applicant.';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const NoArgs = z.object({}).strict();
type NoArgs = z.infer<typeof NoArgs>;

export const listReviewQueue = registerTool<NoArgs>({
  name: 'employees.review_queue',
  description:
    'List the job applications waiting for the manager\'s review. Use for "who is ' +
    'waiting for approval", "any applications to review", "wer wartet auf Freigabe". ' +
    'Returns each applicant\'s name, position and how long they have been waiting, for ' +
    "the caller's own scope only.",
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-EMP-GetReviewQueue (employee-management/service.ts getReviewQueue())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    "READ tool over other people's employment records; scope is the owning service's " +
    'own review-queue resolver, the same one that decides review notifications.',

  args: NoArgs,
  // A DEDICATED TOKEN, not `employees:read`.
  //
  // The first version declared `employees:read`, which WORKER and CHECKER also
  // hold -- so this tool, which lists other people's employment records, would
  // have appeared in a worker's manifest. The service refuses them, so nothing
  // would have leaked; but a capability every role can SEE is not least
  // privilege, and the registry's own design-rule test caught it rather than a
  // reviewer. `employees:review-queue-read` is granted to exactly the three
  // roles the route admits, and enforced there too.
  permission: 'employees:review-queue-read',
  scopeCheck: 'none',

  invoke: async (_args, actor) => {
    const queue = (await employeeManagementService.getReviewQueue(
      toServiceActor(actor) as never
    )) as ApplicantLike[] | { data?: ApplicantLike[] };
    return { queue: (Array.isArray(queue) ? queue : (queue.data ?? [])) as ApplicantLike[] };
  },

  compress: (raw: unknown): CompactResult => {
    const rows = (raw as { queue?: ApplicantLike[] } | null)?.queue ?? [];
    if (rows.length === 0) {
      return { summary: 'Nobody is waiting for your review.', data: { count: 0 } };
    }

    const lines = rows.slice(0, 15).map((row) => {
      const since = row.submitted_for_review_at
        ? new Date(row.submitted_for_review_at).toISOString().slice(0, 10)
        : 'unknown';
      return `${fullName(row)}${row.position ? ` (${row.position})` : ''} — since ${since}`;
    });

    return {
      summary: `${rows.length} waiting for review: ${lines.join('; ')}.`,
      // Names and dates only. Employee ids are resolved from this queue by
      // the write tools, so exposing one here would be a string the model
      // could repeat back and has no use for.
      data: { count: rows.length, applicants: lines },
    };
  },
  maxResultTokens: 600,
});

export const listMyHotels = registerTool<NoArgs>({
  name: 'hotels.my_hotels',
  description:
    'List the hotels the authenticated user covers. Use for "which hotels do I look ' +
    'after", "what are my sites", "welche Hotels betreue ich". Returns the name and ' +
    "city of each hotel in the caller's own scope.",
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-CRM-ListHotels (crm/service.ts listHotels())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    'READ_ONLY over master data the caller can already list; listHotels applies its ' +
    "own role and scope narrowing.",

  args: NoArgs,
  // The route enforces exactly this token, and every role holds it -- the
  // scoping is done inside listHotels by role and scope claim, not by the
  // token, which is why the route pairs it with a requireRole of its own.
  permission: 'hotels:read',
  // 'self', not 'none': this tool takes NO arguments and answers entirely
  // from the caller's own role and scope claim, so there is nothing an
  // argument could redirect -- which is exactly what `self` declares. Every
  // role holds `hotels:read`, and the design-rule test rightly requires a
  // universally-reachable tool to be self-scoped; declaring `none` here was
  // the mistake, not the rule.
  scopeCheck: 'self',

  invoke: async (_args, actor) => {
    const serviceActor = toServiceActor(actor);
    const result = (await crmService.listHotels(
      { page: 1, limit: 50 } as Parameters<typeof crmService.listHotels>[0],
      serviceActor.role,
      serviceActor.userId,
      serviceActor.scope ?? null
    )) as { hotels?: Array<{ name?: string; city?: string | null }> };

    return { hotels: result.hotels ?? [] };
  },

  compress: (raw: unknown): CompactResult => {
    const hotels = (raw as { hotels?: Array<{ name?: string; city?: string | null }> } | null)
      ?.hotels ?? [];
    if (hotels.length === 0) {
      return { summary: 'You do not cover any hotels.', data: { count: 0 } };
    }
    const names = hotels.map((h) => `${h.name}${h.city ? ` (${h.city})` : ''}`);
    return {
      summary: `${hotels.length} hotel${hotels.length === 1 ? '' : 's'}: ${names.join(', ')}.`,
      data: { count: hotels.length, hotels: names },
    };
  },
  maxResultTokens: 400,
});

// ---------------------------------------------------------------------------
// Writes — same scope, confirmed
// ---------------------------------------------------------------------------

const ApplicantArgs = z
  .object({
    // A NAME, matched against the caller's OWN review queue. No employee id
    // is expressible, and the queue is the scope boundary.
    applicant_name: z.string().trim().min(2).max(80),
  })
  .strict();

type ApplicantArgs = z.infer<typeof ApplicantArgs>;

export const approveApplication = registerTool<ApplicantArgs>({
  name: 'employees.approve_application',
  description:
    "Approve a job application waiting in the manager's own review queue. Use for " +
    '"approve Anna", "Anna freigeben", "accept that application". Give the applicant\'s ' +
    'name as it appears in the review queue. Activates the person\'s account and ' +
    'notifies them.',
  // It activates somebody's account and notifies them. A manager cannot
  // un-approve it from the same screen -- reversing means deactivation, which
  // is a different action with its own record -- so the actor sees the exact
  // person before it runs.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-EMP-ApproveEmployee (employee-management/service.ts approve())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    "changes another person's employment state and activates their account, so it " +
    'warrants at least the scrutiny of assignments.place_worker.',

  args: ApplicantArgs,
  // The token the route itself enforces, alongside requireRole. Held by
  // MANAGER, REGIONAL_MANAGER (via MANAGER_PERMISSIONS) and ADMIN, and by
  // neither WORKER nor CHECKER.
  permission: 'employees:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const resolved = await resolveApplicant(actor, args.applicant_name);
    if (resolved.status !== 'RESOLVED') {
      return refuseUnresolvedApplicant(resolved);
    }

    // assertLifecycleAuthority re-checks scope inside approve(); the queue
    // narrowed the candidates, the service decides the authority.
    await employeeManagementService.approve(
      toServiceActor(actor) as never,
      resolved.applicant.employee_id as string
    );
    return { approved: resolved.name };
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { approved?: string } | null;
    if (!r) return { summary: 'Nothing was approved.', data: null };
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    return {
      summary: `${r.approved} is approved and their account is active.`,
      data: { approved: r.approved },
    };
  },
  maxResultTokens: 80,
});

const RejectArgs = z
  .object({
    applicant_name: z.string().trim().min(2).max(80),
    // REQUIRED, unlike the service's optional parameter. A rejection with no
    // stated reason is a decision nobody can review later, and this is the
    // one place the assistant should be stricter than the API rather than
    // merely equivalent to it.
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

type RejectArgs = z.infer<typeof RejectArgs>;

export const rejectApplication = registerTool<RejectArgs>({
  name: 'employees.reject_application',
  description:
    "Reject a job application waiting in the manager's own review queue, with a reason. " +
    'Use for "reject Anna, no work permit", "Anna ablehnen". Give the applicant\'s name ' +
    'as it appears in the review queue and a short reason, which is recorded.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-EMP-RejectEmployee (employee-management/service.ts reject())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    "somebody's application and is not undone by re-running anything.",

  args: RejectArgs,
  permission: 'employees:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const resolved = await resolveApplicant(actor, args.applicant_name);
    if (resolved.status !== 'RESOLVED') {
      return refuseUnresolvedApplicant(resolved);
    }

    await employeeManagementService.reject(
      toServiceActor(actor) as never,
      resolved.applicant.employee_id as string,
      args.reason
    );
    return { rejected: resolved.name };
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { rejected?: string } | null;
    if (!r) return { summary: 'Nothing was rejected.', data: null };
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    return {
      summary: `${r.rejected}'s application is rejected, and the reason is recorded.`,
      data: { rejected: r.rejected },
    };
  },
  maxResultTokens: 80,
});

const AssignArgs = z
  .object({
    applicant_name: z.string().trim().min(2).max(80),
    // A hotel NAME, resolved inside the caller's own scope. `hotel_id` is a
    // FORBIDDEN_ARG_KEY and could not be accepted even if wanted.
    hotel_name: z.string().trim().min(2).max(120),
  })
  .strict();

type AssignArgs = z.infer<typeof AssignArgs>;

export const assignApplicantToHotel = registerTool<AssignArgs>({
  name: 'employees.assign_to_hotel',
  description:
    "Assign an approved person in the manager's own scope to one of their hotels. Use " +
    'for "put Anna at Premier Inn", "Anna dem Ibis zuordnen". Give the person\'s name ' +
    'and the hotel name. Sets where that person works.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-EMP-AssignEmployee (employee-management/service.ts assign())',
  approvalRef:
    APPROVED_2026_09_09 + ' Registration note: ' +
    'decides where a person works, which drives their roster eligibility everywhere ' +
    'else on the platform.',

  args: AssignArgs,
  permission: 'employees:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') {
      return refuseUnresolvedHotel(hotel);
    }

    const resolved = await resolveApplicant(actor, args.applicant_name);
    if (resolved.status !== 'RESOLVED') {
      return refuseUnresolvedApplicant(resolved);
    }

    await employeeManagementService.assign(
      toServiceActor(actor) as never,
      resolved.applicant.employee_id as string,
      { primary_hotel_id: hotel.hotelId }
    );
    return { assigned: resolved.name, hotel: hotel.name };
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { assigned?: string; hotel?: string } | null;
    if (!r) return { summary: 'Nothing was assigned.', data: null };
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    return {
      summary: `${r.assigned} is assigned to ${r.hotel}.`,
      data: { assigned: r.assigned, hotel: r.hotel },
    };
  },
  maxResultTokens: 80,
});
