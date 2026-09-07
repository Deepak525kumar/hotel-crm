import { z } from 'zod';
import { assignmentService } from '../../../assignments/service.js';
import { hrService } from '../../../hr/service.js';
import { qualityService } from '../../../quality/service.js';
import { calendarService } from '../../../calendar/service.js';
import { describeUnresolved, resolveWorkerReference } from '../worker-reference.js';
import { notificationService } from '../../../notifications/service.js';
import type { AssignmentDto } from '../../../assignments/types.js';
import { toServiceActor } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';

/**
 * Self-scoped, read-only tools (ADR-053 item 2: each wraps an existing
 * module interface; no bespoke backend capability is created for the
 * chatbot's benefit).
 *
 * APPROVAL STATUS — read this before adding to this file.
 * ADR-053 item 4 approves the tool-registry ARCHITECTURE, not any specific
 * tool: "Each tool integration is its own explicit future approval." The one
 * tool below is registered as the reference implementation for the
 * authorization boundary and is self-scoped and read-only — the smallest
 * possible surface. Anything touching another person's record, or any write,
 * is blocked on OD-CHAT-005 (read-scope and initiation-scope beyond the
 * owning worker) and needs its own approval before being added here.
 *
 * Also blocked: any analytics tool, until OQ-ANALYTICS-01 is closed
 * (API_INDEX.yaml records the leaderboard routes as missing
 * requireRole/checkHotelAccess — wrapping a broken route would industrialize
 * the breakage).
 */

/**
 * Note what this schema does NOT contain: no worker id, no hotel id, no
 * role, no scope. "Mine" is not an argument — it is resolved from the
 * authenticated actor at execution time. `.strict()` so an unexpected key
 * from model output is a validation failure, not a silently ignored field.
 *
 * Also note what it does not contain yet: a date range. `ListAssignmentsQuery`
 * (assignments/types.ts) exposes no from/to filter, so accepting one here
 * would be an argument the model can set that silently does nothing — worse
 * than not offering it, because the answer would look filtered when it isn't.
 * Adding date filtering is a change to the owning module's own interface
 * first (ADR-053 item 2), not something this tool may fake locally.
 */
const ListMineArgs = z
  .object({
    status: z
      .enum(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'REASSIGNED'])
      .optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

type ListMineArgs = z.infer<typeof ListMineArgs>;

/**
 * Compression is mandatory (§10). An AssignmentDto carries far more than a
 * worker needs to answer "what are my shifts" — dropping the rest bounds
 * tokens and removes fields the model has no business seeing.
 */
function compressAssignments(raw: unknown): CompactResult {
  const rows = (raw as AssignmentDto[]) ?? [];
  const data = rows.map((row) => ({
    id: row.id,
    hotel_id: row.hotel_id,
    day: row.confirmed_at ? row.confirmed_at.slice(0, 10) : null,
    status: row.status,
  }));

  return {
    summary:
      data.length === 0
        ? 'No shifts found for that period.'
        : `${data.length} shift${data.length === 1 ? '' : 's'} found.`,
    data,
  };
}

export const listMyAssignments = registerTool<ListMineArgs>({
  name: 'assignments.list_mine',
  description: "List the authenticated worker's own shift assignments.",
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ASG-ListAssignments (assignments/service.ts list())',
  approvalRef:
    'PENDING — ADR-053 approves the registry architecture only. This tool is ' +
    'self-scoped + read-only and is the reference implementation for the ' +
    'authorization boundary; it still requires its own explicit approval before ' +
    'the feature flag is enabled outside development.',

  args: ListMineArgs,
  // DEFECT FIX (2026-08-24): this previously required `staffing:read`, which
  // the WORKER role does not hold (config/constants.ts) — so the one tool
  // built for workers would have denied every actual worker. It passed tests
  // only because the fixtures fabricated the permission instead of using the
  // real ROLE_PERMISSIONS set; `chatbot-real-permissions.test.ts` now asserts
  // against the real sets so this cannot regress.
  //
  // `GET /assignments` (assignments/routes.ts:86) is `authMiddleware`-only —
  // no requirePermission at all. Authentication plus the service's own
  // role-scoping (isSelfScopedRole narrows where.worker_id; isScopedManagerRole
  // applies the hotel/group filter) IS the control. Modelled honestly as null
  // rather than inventing a token the route does not check.
  permission: null,
  permissionRationale:
    'GET /assignments enforces no permission token; authentication plus the ' +
    "service's own self-scoping is the control. Kept READ_ONLY and self-scoped, " +
    'which assertValidRegistration requires for any token-less tool.',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    // The service applies its OWN authorization on top of this call:
    // isSelfScopedRole(actor.role) narrows where.worker_id to actor.userId,
    // and isScopedManagerRole() applies the manager scope filter. We pass no
    // worker_id at all — for a self-scoped role the service pins it, and for
    // any other role this tool intentionally returns that role's own view
    // rather than letting the model choose a subject.
    //
    // Called with the 2-argument form. The 6-argument `internalBypass` seam
    // on update() is not reachable from here and never will be — the name is
    // a forbidden argument key.
    const { data } = await assignmentService.list(
      {
        status: args.status,
        page: 1,
        per_page: args.limit,
      } as Parameters<typeof assignmentService.list>[0],
      toServiceActor(actor)
    );
    return data;
  },

  compress: compressAssignments,
  maxResultTokens: 400,
});


/**
 * "Do I have any messages?" -- the authenticated user's own notifications.
 *
 * Registered for every role, not just workers: a manager asking what they
 * have been notified about is the same question with the same self-scope.
 * The service takes a userId and filters on it, so there is no role branch
 * to get wrong.
 */
const MyNotificationsArgs = z
  .object({
    // No user id, no role, no scope -- "mine" is resolved from the
    // authenticated actor, never supplied. `.strict()` so an unexpected key
    // invented by the model is a validation failure rather than a silently
    // ignored field.
    //
    // Deliberately no `unread_only` filter: getNotifications() exposes no
    // such parameter, and offering one here would be an argument the model
    // can set that silently does nothing -- an answer that looks filtered
    // but is not. Adding it is a change to the owning module's interface
    // first (ADR-053 item 2), not something this tool may fake.
    limit: z.number().int().min(1).max(25).default(10),
  })
  .strict();

type MyNotificationsArgs = z.infer<typeof MyNotificationsArgs>;

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  read_at: Date | null;
  created_at: Date;
}

/**
 * Compression is mandatory (§10) and does real work here.
 *
 * `message` is free text written elsewhere in the platform, and it is the
 * one field in this result a hostile string could travel in. It is truncated
 * hard and, critically, is only ever RENDERED -- templates.ts formats the
 * CompactResult deterministically and no second model call sees it, so
 * notification text cannot re-enter a prompt as instructions.
 *
 * `data` (the notification's JSON payload) is dropped entirely: it carries
 * internal ids for client deep-linking and nothing a person needs read back
 * to them.
 */
function compressNotifications(raw: unknown): CompactResult {
  const rows = (raw as NotificationRow[]) ?? [];
  const data = rows.map((row) => ({
    type: row.type,
    title: row.title,
    // Bounded: one long notification must not consume the result budget that
    // the other nine share.
    message: row.message.length > 160 ? `${row.message.slice(0, 157)}...` : row.message,
    unread: row.read_at === null,
    day: row.created_at.toISOString().slice(0, 10),
  }));

  const unread = data.filter((row) => row.unread).length;

  return {
    summary:
      data.length === 0
        ? 'No notifications.'
        : `${data.length} notification${data.length === 1 ? '' : 's'}, ${unread} unread.`,
    data,
  };
}

export const listMyNotifications = registerTool<MyNotificationsArgs>({
  name: 'notifications.list_mine',
  description:
    "List the authenticated user's own notifications, newest first. Use for questions " +
    'like "do I have any messages", "any updates for me", "was I notified about anything".',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-NOTIF-GetNotifications (notifications/service.ts getNotifications())',
  approvalRef:
    'PENDING -- ADR-053 item 4 approves the registry architecture only, never a ' +
    'specific tool. This one is self-scoped + READ_ONLY, the same envelope as ' +
    'assignments.list_mine, and still requires its own explicit approval before ' +
    'FEATURE_CHATBOT is enabled outside development.',

  args: MyNotificationsArgs,

  // `GET /notifications` (notifications/routes.ts:25) carries NO
  // requirePermission -- the router-level authMiddleware is the whole gate,
  // and getNotifications() filters `where: { user_id: userId }` itself.
  //
  // Modelled as null rather than borrowing `notifications:read`, even though
  // WORKER and CHECKER both happen to hold that token. Declaring a token the
  // route does not enforce is the documented trap in CHATBOT_HANDOFF §6: it
  // is either a lie about the real gate, or a lockout for some future role
  // that legitimately reads its own notifications without holding it.
  permission: null,
  permissionRationale:
    'GET /notifications enforces no permission token; authentication plus ' +
    'getNotifications() filtering on user_id IS the control. READ_ONLY and ' +
    'self-scoped, as assertValidRegistration requires of any token-less tool.',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    // actor.userId, never an argument. The service takes the id it filters
    // on, so passing anything else here would be the whole vulnerability.
    const rows = await notificationService.getNotifications(toServiceActor(actor).userId);
    // getNotifications() has a fixed take:50 and no limit parameter, so the
    // caller's limit is applied here rather than pretended at the service.
    return rows.slice(0, args.limit);
  },

  compress: compressNotifications,
  maxResultTokens: 700,
});

/**
 * "When does my contract end?" -- the caller's own contract status.
 *
 * A REGISTRY LIMITATION IS VISIBLE HERE, and it is modelled honestly rather
 * than papered over.
 *
 * `GET /workers/:worker_id/contract-status` gates with
 * `requireContractReadAccess()`, which is ROLE-CONDITIONAL (hr/routes.ts):
 *
 *     worker | checker        -> hr:contract:read-own
 *     admin | manager | RM    -> hr:read
 *
 * The registry's `permission` field cannot express that. Its array form is
 * an AND (`every()` in permissions.ts), so `['hr:read',
 * 'hr:contract:read-own']` would demand BOTH and deny everyone -- no role
 * holds both. Declaring either token alone locks out the other half of the
 * platform: `hr:contract:read-own` denies every manager asking about their
 * own contract, and `hr:read` denies every worker and checker, who are the
 * population this question mostly comes from.
 *
 * Verified against the real ROLE_PERMISSIONS, not assumed:
 *   ADMIN/MANAGER/RM   hr:read = yes, hr:contract:read-own = no
 *   CHECKER/WORKER     hr:read = no,  hr:contract:read-own = yes
 * Every role can read its OWN contract; none can do it through one token.
 *
 * So `permission: null` is the honest modelling, and it is safe here rather
 * than permissive: the tool is self-scoped (the executor enforces that), the
 * worker id is the actor's own and is not expressible as an argument, and
 * hrService.getContractStatus applies its own self-scope check on top. The
 * admitted population is exactly the population the route admits.
 *
 * FOLLOW-UP: this pattern recurs -- `requirePayslipReadAccess()` has the
 * identical shape -- so the registry should eventually express
 * role-conditional permissions rather than have each tool restate this. That
 * is a registry change, not something to keep working around per tool.
 */
const MyContractArgs = z.object({}).strict();

type MyContractArgs = z.infer<typeof MyContractArgs>;

interface ContractLike {
  position: string;
  start_date: string;
  end_date: string | null;
  status: string;
  employment_type: string;
  signed_scan_uploaded?: boolean;
}

/**
 * Compression drops every identifier. A person asking about their own
 * contract needs the dates and the state, never `id`, `worker_id`,
 * `template_id` or `scanned_document_id` -- internal references that would
 * cost tokens on every turn and give the model strings it might repeat back.
 */
function compressContract(raw: unknown): CompactResult {
  const contract = raw as ContractLike | null;

  if (!contract) {
    // A genuine, common state: an applicant partway through onboarding has
    // no contract yet. Saying so plainly beats an empty object the model
    // would have to interpret.
    return { summary: 'No contract on file yet.', data: null };
  }

  const data = {
    position: contract.position,
    start_date: contract.start_date,
    end_date: contract.end_date,
    status: contract.status,
    employment_type: contract.employment_type,
    signed_copy_received: contract.signed_scan_uploaded ?? false,
  };

  const ends = contract.end_date ? `ends ${contract.end_date}` : 'no end date (permanent)';
  return {
    summary: `Contract ${contract.status.toLowerCase()}, ${ends}.`,
    data,
  };
}

export const getMyContract = registerTool<MyContractArgs>({
  name: 'hr.my_contract',
  description:
    "Get the authenticated user's OWN employment contract status: position, start and end " +
    'dates, whether a signed copy is on file. Use for questions like "when does my contract ' +
    'end", "what is my contract status", "am I permanent".',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-HR-GetContractStatus (hr/service.ts getContractStatus())',
  approvalRef:
    'PENDING -- ADR-053 item 4 approves the registry architecture only, never a ' +
    'specific tool. Self-scoped + READ_ONLY, the same envelope as ' +
    'assignments.list_mine and notifications.list_mine.',

  args: MyContractArgs,
  permission: null,
  permissionRationale:
    'The wrapped route gates role-conditionally (worker/checker: ' +
    'hr:contract:read-own; admin/manager/RM: hr:read) and the registry cannot ' +
    'express an OR -- its array form is an AND, so naming both tokens would deny ' +
    'everyone, and naming either alone locks out the other half of the platform. ' +
    'Self-scope is the control instead: the worker id is the actor\'s own, is not ' +
    'expressible as an argument, and getContractStatus re-checks it.',
  scopeCheck: 'self',

  invoke: async (_args, actor) => {
    const serviceActor = toServiceActor(actor);
    // The actor id is passed as BOTH the subject and the caller. That is what
    // makes this "my contract" and nothing else -- getContractStatus's own
    // guard (worker/checker may only view their own) is then satisfied by
    // construction rather than by trusting this call site.
    return hrService.getContractStatus(serviceActor.userId, serviceActor.userId, serviceActor.role);
  },

  compress: compressContract,
  maxResultTokens: 300,
});

/**
 * "Have I got my payslip yet?" -- the caller's OWN payslip requests.
 *
 * SELF-SCOPE IS FORCED HERE, and that is not belt-and-braces -- it is the
 * whole correctness of the tool.
 *
 * hrService.listPayroll self-scopes worker and checker callers itself
 * (OD-HR-10 / FIND-SEC-HR-03: it overwrites filters.worker_id with the
 * actor's id regardless of what was passed). But for a MANAGER, RM or ADMIN
 * it does the opposite: with no worker_id filter it returns everything in
 * that caller's scope -- their whole team's payslip requests.
 *
 * So a tool that simply called listPayroll and called itself "my payslips"
 * would be correct for workers and quietly wrong for managers, answering a
 * question about the team when a person asked about themselves. Passing
 * `worker_id: actor.userId` explicitly makes it genuinely self-scoped for
 * every role, and for worker/checker it merely agrees with what the service
 * was going to force anyway.
 *
 * A manager reading their TEAM's payslips is a different capability, needs
 * `ADR-073`'s manager-scope reasoning and its own approval, and is not this
 * tool.
 *
 * Permission modelling is identical to hr.my_contract -- see that tool for
 * the full reasoning, and CHATBOT_HANDOFF §6 for why it recurs.
 * requirePayslipReadAccess() gates worker/checker on hr:payslip:read-own and
 * admin/manager/RM on hr:read, which the registry cannot express as an OR.
 */
const MyPayslipsArgs = z
  .object({
    // Mirrors ListPayslipRequestsQuerySchema's own enum rather than inventing
    // one: a status the query rejects would be a filter the model can set
    // that produces an error instead of an answer.
    status: z.enum(['REQUESTED', 'FULFILLED']).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

type MyPayslipsArgs = z.infer<typeof MyPayslipsArgs>;

interface PayslipRow {
  period_start: string;
  period_end: string;
  status: string;
  fulfilled_at: string | null;
  created_at: string;
}

function compressPayslips(raw: unknown): CompactResult {
  const rows = ((raw as { data?: PayslipRow[] } | null)?.data ?? []) as PayslipRow[];
  const data = rows.map((row) => ({
    period: `${row.period_start} to ${row.period_end}`,
    status: row.status,
    fulfilled_on: row.fulfilled_at ? row.fulfilled_at.slice(0, 10) : null,
    requested_on: row.created_at.slice(0, 10),
  }));

  const pending = data.filter((row) => row.status === 'REQUESTED').length;

  return {
    summary:
      data.length === 0
        ? 'No payslip requests found.'
        : `${data.length} payslip request${data.length === 1 ? '' : 's'}, ${pending} still awaiting fulfilment.`,
    data,
  };
}

export const listMyPayslips = registerTool<MyPayslipsArgs>({
  name: 'hr.my_payslips',
  description:
    "List the authenticated user's OWN payslip requests and whether each has been " +
    'fulfilled. Use for questions like "have I got my payslip", "did they send my ' +
    'payslip", "my payslip requests".',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-HR-ListPayroll (hr/service.ts listPayroll())',
  approvalRef:
    'PENDING -- ADR-053 item 4 approves the registry architecture only, never a ' +
    'specific tool. Self-scoped + READ_ONLY.',

  args: MyPayslipsArgs,
  permission: null,
  permissionRationale:
    'requirePayslipReadAccess() gates role-conditionally (worker/checker: ' +
    'hr:payslip:read-own; admin/manager/RM: hr:read) and the registry cannot express ' +
    'an OR -- naming both denies everyone, naming either locks out half the platform. ' +
    'Self-scope is the control: worker_id is forced to the actor\'s own id in invoke(), ' +
    'is not expressible as a tool argument (FORBIDDEN_ARG_KEY), and listPayroll ' +
    're-forces it for worker/checker callers.',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const serviceActor = toServiceActor(actor);
    return hrService.listPayroll(
      {
        // Forced, not optional. Without this a manager gets their team's
        // requests back from a tool that says "mine".
        worker_id: serviceActor.userId,
        ...(args.status ? { status: args.status } : {}),
        limit: args.limit,
        page: 1,
      },
      serviceActor
    );
  },

  compress: compressPayslips,
  maxResultTokens: 500,
});


/**
 * "What did I inspect today?" -- the checker's own inspection history.
 *
 * NOTE THE CONTRAST with hr.my_contract and hr.my_payslips above: this route
 * gates on a SINGLE token, `requirePermission('quality:read')`, with no
 * role-conditional branch. So the token is declared honestly here rather
 * than modelled as null. The `null` on those two tools is a workaround for a
 * registry limitation, not a house style -- where a route enforces one real
 * token, name it.
 *
 * `quality:read` rather than `quality:write`, matching the route: the token
 * gates a READ, and a role that never inspected anything simply gets an
 * empty list. Every role holds `quality:read`, so nobody is locked out of
 * asking; workers and managers just get nothing back, which is the truthful
 * answer for them.
 */
const MyInspectionsArgs = z
  .object({
    // Mirrors ListOwnInspectionsQuerySchema: free-text search across room,
    // notes, worker and hotel name. Capped at the same 120 characters the
    // route caps at, so a pathological string cannot become an expensive
    // LIKE across five columns.
    q: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

type MyInspectionsArgs = z.infer<typeof MyInspectionsArgs>;

interface InspectionRow {
  room_number?: string | null;
  score?: number | null;
  outcome?: string | null;
  created_at?: string | Date | null;
}

function compressInspections(raw: unknown): CompactResult {
  const rows = ((raw as { data?: InspectionRow[] } | null)?.data ?? []) as InspectionRow[];
  const data = rows.map((row) => ({
    room: row.room_number ?? null,
    score: row.score ?? null,
    outcome: row.outcome ?? null,
    day:
      row.created_at instanceof Date
        ? row.created_at.toISOString().slice(0, 10)
        : typeof row.created_at === 'string'
          ? row.created_at.slice(0, 10)
          : null,
  }));

  const rework = data.filter((row) => row.outcome === 'rework').length;

  return {
    summary:
      data.length === 0
        ? 'No inspections recorded.'
        : `${data.length} inspection${data.length === 1 ? '' : 's'}, ${rework} sent for rework.`,
    data,
  };
}

export const listMyInspections = registerTool<MyInspectionsArgs>({
  name: 'quality.my_inspections',
  description:
    "List the authenticated checker's OWN inspection history -- room, score and whether " +
    'rework was assigned. Use for questions like "what did I inspect today", "my checks", ' +
    '"my inspection history".',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-QUAL-ListOwnChecks (quality/service.ts listOwnChecks())',
  approvalRef:
    'PENDING -- ADR-053 item 4 approves the registry architecture only, never a ' +
    'specific tool. Self-scoped + READ_ONLY.',

  args: MyInspectionsArgs,
  // A real single token this time, matching the route exactly.
  permission: 'quality:read',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    return qualityService.listOwnChecks(toServiceActor(actor), {
      page: 1,
      perPage: args.limit,
      ...(args.q ? { q: args.q } : {}),
    });
  },

  compress: compressInspections,
  maxResultTokens: 600,
});


// ---------------------------------------------------------------------------
// WRITE TOOLS
//
// The first tool that changes state. ADR-053 item 5 fixes the tiers and the
// registry enforces them: HIGH_RISK_WRITE forces `confirm: true` at
// registration, so confirmation cannot be opted out of by a tool definition.
//
// WHY THE PLATFORM GAINED TWO PERMISSION TOKENS FOR THIS.
// `assertValidRegistration` requires every non-READ_ONLY tool to declare a
// real permission, and rightly refuses the `null` escape hatch for writes --
// letting it widen would make `null` the way writes get registered. But the
// two SAFEST writes here (a person marking their own message read, or
// declaring their own sick day) run through routes that enforced no token at
// all, with the owning service's ownership check as the whole gate. Sound for
// HTTP, but it meant the safest writes were the ones that could not be
// exposed, while a write touching someone else's record could.
//
// Owner decision, 2026-09-04: name the capability rather than loosen the
// guard. `notifications:mark-read-own` and `calendar:absence:write-own` were
// added, granted to EVERY role so nobody who could call those routes lost
// access, and the routes now enforce them -- "satisfied by construction",
// exactly as ADR-042/OD-HR-10 describes `hr:contract:read-own`. Self-scope
// remains the substantive control in both services.
// ---------------------------------------------------------------------------

/**
 * A checker sends a room back for rework.
 *
 * HIGH_RISK_WRITE, so confirmation is MANDATORY -- forced by
 * assertValidRegistration, not a preference expressed here. It earns the
 * tier: rework creates a linked assignment for another person (ADR-069),
 * changes what that worker is expected to do, and is visible to them
 * immediately as a notification. It is not something to do by accident.
 *
 * FIRST TOOL TO TOUCH ANOTHER PERSON'S RECORD, which is exactly the class
 * ADR-073 authorises and nothing before it could do. The authority is still
 * the caller's own: assignRework applies isScopedManagerRole/isHotelInScope
 * itself, so a checker can only send back work at a hotel they already cover
 * -- the same boundary they operate under by hand.
 *
 * `quality:write` is declared honestly here: POST /quality/rework enforces
 * exactly that token, and CHECKER holds it. No `null`, no rationale needed.
 */
const AssignReworkArgs = z
  .object({
    // Mirrors AssignReworkSchema. `verification_id` says WHICH inspection --
    // semantic, not authorization. The service loads it, finds its
    // assignment and re-checks hotel scope, so an invented id is refused
    // rather than acted on.
    verification_id: z.string().min(1).max(64),
    // Required by the service too. The worker is told why their room is
    // coming back, so an empty note would be a notification that explains
    // nothing.
    notes: z.string().trim().min(1).max(1000),
  })
  .strict();

type AssignReworkArgs = z.infer<typeof AssignReworkArgs>;

export const assignReworkTool = registerTool<AssignReworkArgs>({
  name: 'quality.assign_rework',
  description:
    'Send an inspected room back to the worker for rework, with a note explaining what ' +
    'needs redoing. Use when a checker says a room must be done again.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-QUAL-AssignRework (quality/service.ts assignRework())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. It is ' +
    'the FIRST HIGH_RISK_WRITE in the registry and the first to touch another ' +
    "person's record, so it is also the first real exercise of the confirmation flow.",

  args: AssignReworkArgs,
  permission: 'quality:write',
  scopeCheck: 'hotel',

  invoke: async (args, actor) => {
    return qualityService.assignRework(args, toServiceActor(actor));
  },

  compress: (raw: unknown) => {
    const result = raw as { id?: string; room_number?: string | null } | null;
    return {
      summary: result?.room_number
        ? `Room ${result.room_number} sent back for rework.`
        : 'Rework assigned.',
      data: null,
    };
  },
  maxResultTokens: 60,
});

/**
 * Mark one of the caller's own notifications as read.
 *
 * LOW_RISK_WRITE with `confirm: false`, and that judgement is what the tier
 * is for: asking "are you sure?" before marking a message read would train
 * people to click through confirmations without reading them, which is
 * exactly what makes the confirmation on a real write worthless. Reserve the
 * interruption for changes that matter.
 *
 * Declares a real token. `notifications:mark-read-own` was added to the
 * platform on 2026-09-04 and the route now enforces it -- previously this
 * route gated on nothing, which made this tool impossible to register at all
 * (the registry rightly refuses `permission: null` for a write).
 */
const MarkNotificationReadArgs = z
  .object({
    // Semantic, not authorization: WHICH notification, never WHOSE.
    // markAsRead compares notification.user_id against the caller and throws
    // ForbiddenError otherwise, so a guessed or hallucinated id cannot read
    // across users.
    notification_id: z.string().min(1).max(64),
  })
  .strict();

type MarkNotificationReadArgs = z.infer<typeof MarkNotificationReadArgs>;

export const markMyNotificationRead = registerTool<MarkNotificationReadArgs>({
  name: 'notifications.mark_read',
  description:
    "Mark one of the authenticated user's own notifications as read. Use when they say " +
    'they have read a message, or ask to clear or dismiss one.',
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-NOTIF-MarkAsRead (notifications/service.ts markAsRead())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. ' +
    'Self-scoped, reversible, LOW_RISK_WRITE.',

  args: MarkNotificationReadArgs,
  permission: 'notifications:mark-read-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    return notificationService.markAsRead(args.notification_id, toServiceActor(actor).userId);
  },

  compress: () => ({ summary: 'Marked as read.', data: null }),
  maxResultTokens: 40,
});

/**
 * Declare one of the caller's own sick or vacation days.
 *
 * HIGH_RISK_WRITE, so confirmation is MANDATORY -- forced at registration,
 * not a preference expressed here. ADR-053 item 5 names "submit a leave
 * request" as high-risk, and it earns that for a reason specific to this
 * codebase: a self-marked absence is a PROTECTED record. Per the owner
 * decision of 2026-08-29 a manager cannot afterwards move, re-kind or delete
 * an absence the worker marked themselves. So this writes a row its own
 * author cannot later have corrected on their behalf -- precisely the kind of
 * thing a person should see spelled out before it happens.
 *
 * Self-scoped: markAbsence() is the /my-absences path and supplies its own
 * `{ userId: workerId, role: 'worker' }` actor. The manager-on-behalf path is
 * markAbsenceForWorker, deliberately NOT wrapped here.
 */
const MarkMyAbsenceArgs = z
  .object({
    // Mirrors MarkAbsenceSchema rather than approximating it. A looser shape
    // would let the model produce a call the service then rejects -- after
    // the user had already confirmed it.
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
    kind: z.enum(['SICK', 'VACATION']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  // The service's own rule, restated so it fails at PROPOSAL time. Without
  // it a VACATION with no reason would be summarised, confirmed, and only
  // then refused -- the confirmation flow parses arguments before rendering a
  // summary precisely so nobody approves a call that cannot run.
  .refine((d) => d.kind !== 'VACATION' || Boolean(d.reason), {
    message: 'reason is required for a VACATION absence',
    path: ['reason'],
  });

type MarkMyAbsenceArgs = z.infer<typeof MarkMyAbsenceArgs>;

export const markMyAbsence = registerTool<MarkMyAbsenceArgs>({
  name: 'calendar.mark_my_absence',
  description:
    "Record one of the authenticated user's OWN sick or vacation days. Use for " +
    '"I am sick today", "ich bin krank", "book me off on the 12th". A vacation day ' +
    'requires a reason; a sick day does not.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-CAL-MarkAbsence (calendar/service.ts markAbsence())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval.',

  args: MarkMyAbsenceArgs,
  permission: 'calendar:absence:write-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    return calendarService.markAbsence(toServiceActor(actor).userId, args);
  },

  compress: (raw: unknown) => {
    const absence = raw as { day?: string; kind?: string } | null;
    if (!absence) return { summary: 'Absence recorded.', data: null };
    return {
      summary: `Recorded ${String(absence.kind ?? '').toLowerCase()} leave for ${absence.day}.`,
      data: { day: absence.day, kind: absence.kind },
    };
  },
  maxResultTokens: 80,
});


// ---------------------------------------------------------------------------
// MANAGER-SCOPED TOOLS
//
// The first tools that read beyond the caller's own record. ADR-073 permits
// this: a Manager may see through the assistant exactly what they can see by
// hand, which for assignments is their own hotel or group and nothing else.
// ---------------------------------------------------------------------------

/**
 * A manager's view of their team's shifts.
 *
 * WHY THERE IS NO worker_id OR hotel_id ARGUMENT, even though a manager
 * genuinely needs to ask about one worker: both are FORBIDDEN_ARG_KEYS, and
 * rightly so -- an id supplied by a model is an authorization input wearing a
 * semantic costume. The free-text `q` is the honest way to express "Anna's
 * shifts": it searches worker name, hotel name and city INSIDE the scope the
 * service has already narrowed to, so a manager can name a person without
 * anyone being able to name an id.
 *
 * Scope is not this tool's job. `assignmentService.list()` narrows a
 * scoped-manager role to its own hotel_group itself -- that narrowing was
 * added as an IDOR fix (2026-08-08) after list() was found returning every
 * assignment platform-wide -- and it is the same code path the HTTP route
 * uses. Duplicating it here would be a second scope implementation to drift.
 *
 * `staffing:read` is declared honestly: WORKER and CHECKER do not hold it, so
 * this tool is invisible to them, which is correct -- a worker asking about
 * "the team" should get nothing, and gets nothing.
 */
const TeamAssignmentsArgs = z
  .object({
    // Free text across worker name, hotel name and city. Capped at the same
    // 120 characters ListAssignmentsQuerySchema caps at: this becomes several
    // LIKE clauses over joined tables, and an unbounded term is a cheap way
    // to make an expensive query.
    q: z.string().trim().max(120).optional(),
    status: z
      .enum(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'REASSIGNED'])
      .optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

type TeamAssignmentsArgs = z.infer<typeof TeamAssignmentsArgs>;

interface TeamAssignmentRow {
  id?: string;
  worker_id?: string;
  hotel_id?: string;
  status?: string;
  confirmed_at?: string | null;
  worker_name?: string | null;
  hotel_name?: string | null;
}

function compressTeamAssignments(raw: unknown): CompactResult {
  const rows = ((raw as { data?: TeamAssignmentRow[] } | null)?.data ?? []) as TeamAssignmentRow[];
  const data = rows.map((row) => ({
    // Names, not ids. A manager asking who is working wants people, and an
    // id would cost tokens on every row while giving the model a string it
    // might repeat back as if it meant something.
    worker: row.worker_name ?? null,
    hotel: row.hotel_name ?? null,
    day: row.confirmed_at ? row.confirmed_at.slice(0, 10) : null,
    status: row.status ?? null,
  }));

  return {
    summary:
      data.length === 0
        ? 'No shifts found for your team.'
        : `${data.length} shift${data.length === 1 ? '' : 's'} across your team.`,
    data,
  };
}

export const listTeamAssignments = registerTool<TeamAssignmentsArgs>({
  name: 'assignments.list_for_my_team',
  description:
    "List shifts across the manager's OWN hotel or group. Use for questions like " +
    '"who is working tomorrow", "show me Anna\'s shifts", "what is scheduled at my hotel". ' +
    'Search by name with the q parameter.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ASG-ListAssignments (assignments/service.ts list())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. First ' +
    'manager-scoped READ tool; permitted by ADR-073, which is Accepted.',

  args: TeamAssignmentsArgs,
  // A real token, and one that excludes exactly the roles it should:
  // WORKER and CHECKER do not hold staffing:read, so this tool is invisible
  // to them.
  permission: 'staffing:read',
  // 'none', not 'hotel'. There is no hotel argument for the executor to
  // pre-check -- the scoping happens inside list(), which narrows a
  // scoped-manager role to its own hotel_group. 'hotel' here would resolve
  // against an absent argument and assert something this tool does not mean.
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    return assignmentService.list(
      {
        ...(args.q ? { q: args.q } : {}),
        ...(args.status ? { status: args.status as never } : {}),
        page: 1,
        limit: args.limit,
      } as never,
      toServiceActor(actor)
    );
  },

  compress: compressTeamAssignments,
  maxResultTokens: 900,
});


/**
 * A manager puts one of their workers on the calendar for a day.
 *
 * THE WEEK-PLANNING CAPABILITY, one day at a time. "Put Anna on Tuesday" is
 * the shape a manager actually speaks, and this is the first tool that can
 * act on it.
 *
 * THE WORKER IS NAMED, NOT IDENTIFIED. `worker_id` and `hotel_id` are
 * FORBIDDEN_ARG_KEYS and a tool cannot accept either; an id supplied by a
 * model is an authorization input wearing a semantic costume. So the
 * argument is a NAME, and `resolveWorkerReference` turns it into an id
 * server-side, from the caller's own hotel roster -- scoping the candidate
 * set BEFORE matching, so a name that matches nobody in scope cannot reveal
 * that it matches someone elsewhere. Ambiguity refuses rather than guessing.
 *
 * The hotel is likewise never an argument: it is the one the actor is scoped
 * to. An admin or regional manager, having no single hotel, is refused
 * rather than having one guessed for them.
 *
 * A RE-RESOLUTION RACE EXISTS AND IS ACCEPTED. The name is resolved when the
 * tool runs, which for a confirmed write is AFTER the manager approved a
 * summary. If the roster changed in between -- a second "Anna" joining the
 * hotel within those five minutes -- resolution becomes ambiguous and the
 * tool refuses rather than writing. It cannot silently roster a different
 * person: the only outcomes are the same worker, or a refusal. Narrowing
 * this further means storing the resolved id in the pending call, which
 * would put an id where the confirmation summary cannot show it, and a
 * summary the manager cannot verify is worse than a rare refusal.
 *
 * HIGH_RISK_WRITE: placing someone on the calendar creates a real assignment,
 * notifies them, and commits their day. Confirmation is forced at
 * registration.
 */
const PlaceWorkerArgs = z
  .object({
    // A NAME, not an id. Bounded because it becomes a scan over the hotel's
    // roster, and because a 500-character "name" is not a name.
    worker_name: z.string().trim().min(2).max(80),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
  })
  .strict();

type PlaceWorkerArgs = z.infer<typeof PlaceWorkerArgs>;

export const placeWorkerOnCalendar = registerTool<PlaceWorkerArgs>({
  name: 'assignments.place_worker',
  description:
    "Put one of the manager's OWN workers on the calendar for a given day. Use for " +
    '"put Anna on Tuesday", "schedule Tomasz for the 12th". Give the worker\'s name as ' +
    'they are known at the hotel; the day must be YYYY-MM-DD.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-ASG-PlaceOnCalendar (assignments/service.ts placeOnCalendar())',
  approvalRef:
    'PENDING -- ADR-053 item 4 requires this tool its own explicit approval. FIRST ' +
    "tool that writes to another person's schedule, so it warrants closer review " +
    'than the self-scoped writes: it commits a worker\'s day and notifies them.',

  args: PlaceWorkerArgs,
  permission: 'staffing:write',
  // 'none': there is no hotel ARGUMENT to pre-check. The hotel comes from the
  // actor's own scope inside invoke(), and placeOnCalendar re-checks it with
  // isHotelInScope() regardless -- the same guard the HTTP route relies on.
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const resolved = await resolveWorkerReference(args.worker_name, actor);
    if (resolved.status !== 'RESOLVED') {
      // A refusal, not an exception: "there are two Annas" is a normal
      // answer a manager can act on, and throwing would turn it into a
      // failed turn with no useful guidance.
      return { refused: describeUnresolved(resolved) };
    }

    const result = await assignmentService.placeOnCalendar(
      { worker_id: resolved.workerId, hotel_id: resolved.hotelId, day: args.day },
      toServiceActor(actor)
    );
    return { placed: { worker: resolved.fullName, day: args.day }, result };
  },

  compress: (raw: unknown) => {
    const out = raw as { refused?: string; placed?: { worker: string; day: string } } | null;
    if (out?.refused) return { summary: out.refused, data: null };
    if (out?.placed) {
      return {
        summary: `${out.placed.worker} is on the calendar for ${out.placed.day}.`,
        data: { worker: out.placed.worker, day: out.placed.day },
      };
    }
    return { summary: 'Done.', data: null };
  },
  maxResultTokens: 120,
});
