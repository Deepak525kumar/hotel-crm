import { z } from 'zod';
import { assignmentService } from '../../../assignments/service.js';
import { hrService } from '../../../hr/service.js';
import { qualityService } from '../../../quality/service.js';
import { calendarService } from '../../../calendar/service.js';
import { documentService } from '../../../documents/service.js';
import { employeeManagementService } from '../../../employee-management/service.js';
import {
  describeUnresolved,
  describeUnresolvedHotel,
  resolveHotelReference,
  resolveWorkerReference,
} from '../worker-reference.js';
import {
  describeInspectionMiss,
  describeNotificationMiss,
  resolveInspectionReference,
  resolveNotificationReference,
} from '../context-reference.js';
import { notificationService } from '../../../notifications/service.js';
import type { AssignmentDto } from '../../../assignments/types.js';
import { toServiceActor } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';

/**
 * The commissioning human's approval of every tool registered on this date,
 * under `ADR-053` item 4 ("each tool integration is its own explicit future
 * approval"). Granted 2026-09-08, after review of the thirteen tools then in
 * the registry.
 *
 * SCOPE OF THE APPROVAL, stated precisely because a blanket reading would
 * hollow out the control it satisfies: it covers the THIRTEEN tools that
 * existed on 2026-09-08 and the capability each one wrapped at that time. It
 * is NOT a standing approval for tools added afterwards -- those register as
 * PENDING and need their own decision, which is the whole point of item 4 --
 * and it does NOT survive a change to what an approved tool does. Widening a
 * tool's scope, tier, or permission makes it a different capability from the
 * one approved, and it must go back to PENDING.
 */
const APPROVED_2026_09_08 =
  'APPROVED 2026-09-08 by the commissioning human under ADR-053 item 4. ' +
  'Covers this tool as registered on that date; a later change to its scope, ' +
  'risk tier or permission requires re-approval.';

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
  description:
    "List the authenticated worker's OWN upcoming or past shift assignments. Use for " +
    '"what are my shifts", "am I working tomorrow", "wann arbeite ich", "show my ' +
    'schedule". Returns the day, hotel and status of each shift, and only ever the ' +
    "caller's own -- never another worker's.",
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ASG-ListAssignments (assignments/service.ts list())',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY, and the reference implementation for the authorization boundary every later tool follows.',

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
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY, the same envelope as assignments.list_mine.',

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
 * The registry's array form is an AND (`every()` in permissions.ts), so
 * `['hr:read', 'hr:contract:read-own']` would demand BOTH and deny everyone
 * -- no role holds both. Declaring either token alone locks out the other
 * half of the platform: `hr:contract:read-own` denies every manager asking
 * about their own contract, and `hr:read` denies every worker and checker,
 * who are the population this question mostly comes from.
 *
 * The `anyOf` form (added 2026-09-07, for exactly this) is an OR, so it
 * admits precisely the two populations the route admits.
 *
 * Verified against the real ROLE_PERMISSIONS, not assumed:
 *   ADMIN/MANAGER/RM   hr:read = yes, hr:contract:read-own = no
 *   CHECKER/WORKER     hr:read = no,  hr:contract:read-own = yes
 * Every role can read its OWN contract; none can do it through one token.
 *
 * ONE DIFFERENCE FROM THE ROUTE, stated rather than glossed: the route picks
 * a token BY ROLE, so a hypothetical role holding `hr:contract:read-own`
 * while being neither worker nor checker would be sent to `hr:read` by the
 * route and admitted by `anyOf` here. No such role exists today (verified
 * above against the real sets), and the direction of the gap is bounded --
 * both tokens are contract-read tokens, and the tool is self-scoped, so the
 * worst case is an actor reading its OWN contract. If a future role splits
 * these apart, the registry needs a role-conditional form, not another
 * per-tool workaround.
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
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY. Gated by anyOf because the route gates by role.',

  args: MyContractArgs,
  // Mirrors requireContractReadAccess() (hr/routes.ts:121-123): worker and
  // checker gate on hr:contract:read-own, every other role on hr:read.
  permission: { anyOf: ['hr:read', 'hr:contract:read-own'] },
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
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY. Gated by anyOf because the route gates by role.',

  args: MyPayslipsArgs,
  // Mirrors requirePayslipReadAccess() (hr/routes.ts:136-138): worker and
  // checker gate on hr:payslip:read-own, every other role on hr:read. See the
  // hr.my_contract block above for the one way `anyOf` differs from a
  // role-conditional gate, and why that gap is bounded for a self-scoped read.
  permission: { anyOf: ['hr:read', 'hr:payslip:read-own'] },
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
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY, on a single token matching the route exactly.',

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
    // A ROOM NUMBER, not a verification id (changed 2026-09-08). The id was
    // semantic rather than authorization -- FORBIDDEN_ARG_KEYS never covered
    // it -- but a model has no way to know one, so a live routing check found
    // this tool selecting NOTHING for its own example phrase. It was
    // unreachable in practice while every unit test passed, because the tests
    // supplied an id the model never has.
    //
    // The inspection is resolved from the checker's OWN checks instead
    // (context-reference.ts), scope before match, exactly as a worker name is.
    room_number: z.string().trim().min(1).max(20),
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
    'needs redoing. Use when a checker says a room must be redone, e.g. "send 214 back", ' +
    '"Zimmer 214 nochmal machen". Requires an existing inspection and a note. Returns ' +
    'confirmation that the rework was assigned and the worker notified.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-QUAL-AssignRework (quality/service.ts assignRework())',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    "The FIRST HIGH_RISK_WRITE in the registry and the first to touch another person's record; the first real exercise of the confirmation flow.",

  args: AssignReworkArgs,
  permission: 'quality:write',
  scopeCheck: 'hotel',

  invoke: async (args, actor) => {
    const resolved = await resolveInspectionReference(actor, args.room_number);
    if (resolved.status !== 'RESOLVED') {
      // A refusal, not an exception: "you never inspected that room" and
      // "it is already back with the worker" are both normal answers a
      // checker can act on.
      return { refused: describeInspectionMiss(resolved) };
    }

    const result = await qualityService.assignRework(
      { verification_id: resolved.value.id, notes: args.notes },
      toServiceActor(actor)
    );
    return { ...(result as Record<string, unknown>), room_number: resolved.value.roomNumber };
  },

  compress: (raw: unknown) => {
    const result = raw as { refused?: string; id?: string; room_number?: string | null } | null;
    if (result?.refused) return { summary: result.refused, data: null };
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
    // FREE TEXT and OPTIONAL, not an id (changed 2026-09-08). The id was
    // semantic rather than authorization, so nothing structural forbade it --
    // but a model has no way to know one, and a live routing check found this
    // tool selecting NOTHING for its own example phrase. It was unreachable
    // in practice while every unit test passed, because the tests supplied an
    // id the model never has.
    //
    // Omitted means "the most recent unread", which is what "mark that as
    // read" means in practice -- nobody says it about a message from last
    // week. Given, it matches the caller's OWN messages only.
    match: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

type MarkNotificationReadArgs = z.infer<typeof MarkNotificationReadArgs>;

export const markMyNotificationRead = registerTool<MarkNotificationReadArgs>({
  name: 'notifications.mark_read',
  description:
    "Mark one of the authenticated user's own messages as read. Use when they say they " +
    'have read a message or ask to dismiss one, e.g. "mark that as read", "gelesen", ' +
    '"dismiss the payslip one". Leave `match` EMPTY for "that" or "the last one" -- it ' +
    'then marks their most recent unread message, which is almost always what is meant. ' +
    'Set `match` only when they name a specific message, and then to words FROM that ' +
    'message ("payslip", "shift"), never to words from their own instruction. Returns ' +
    'which message was marked.',
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-NOTIF-MarkAsRead (notifications/service.ts markAsRead())',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped, reversible, LOW_RISK_WRITE. Confirmation deliberately not required (ADR-053 item 5 leaves it per-tool at this tier).',

  args: MarkNotificationReadArgs,
  permission: 'notifications:mark-read-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const resolved = await resolveNotificationReference(actor, args.match);
    if (resolved.status !== 'RESOLVED') {
      return { refused: describeNotificationMiss(resolved) };
    }
    await notificationService.markAsRead(resolved.value.id, toServiceActor(actor).userId);
    return { marked: resolved.value.label };
  },

  compress: (raw: unknown) => {
    const r = raw as { refused?: string; marked?: string } | null;
    if (r?.refused) return { summary: r.refused, data: null };
    // Names WHICH message, because "marked as read" on its own leaves a
    // person unsure whether the assistant picked the one they meant.
    return { summary: `Marked as read: ${r?.marked ?? 'message'}.`, data: null };
  },
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
    'requires a reason; a sick day does not. Give the day as YYYY-MM-DD. Returns ' +
    'confirmation of the day and kind recorded.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-CAL-MarkAbsence (calendar/service.ts markAbsence())',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped, but HIGH_RISK_WRITE: it creates a PROTECTED record its own author cannot later have corrected on their behalf.',

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
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'First manager-scoped READ tool; permitted by ADR-073.',

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
    // Optional, and a NAME rather than an id (`hotel_id` is forbidden). A
    // hotel-scoped manager never needs it -- they have exactly one hotel. An
    // admin or regional manager covers several and must say which, since
    // guessing one would place a worker somewhere nobody asked for.
    hotel_name: z.string().trim().min(2).max(120).optional(),
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
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    "First tool that writes to another person's SCHEDULE: it commits a worker's day and notifies them.",

  args: PlaceWorkerArgs,
  permission: 'staffing:write',
  // 'none': there is no hotel ARGUMENT to pre-check. The hotel comes from the
  // actor's own scope inside invoke(), and placeOnCalendar re-checks it with
  // isHotelInScope() regardless -- the same guard the HTTP route relies on.
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    // Hotel FIRST: the worker roster is a property of a hotel, so there is
    // nothing to search until we know which one.
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') {
      return { refused: describeUnresolvedHotel(hotel) };
    }

    const resolved = await resolveWorkerReference(args.worker_name, actor, hotel.hotelId);
    if (resolved.status !== 'RESOLVED') {
      // A refusal, not an exception: "there are two Annas" is a normal
      // answer a manager can act on, and throwing would turn it into a
      // failed turn with no useful guidance.
      return { refused: describeUnresolved(resolved) };
    }

    const result = await assignmentService.placeOnCalendar(
      { worker_id: resolved.workerId, hotel_id: hotel.hotelId, day: args.day },
      toServiceActor(actor)
    );
    return { placed: { worker: resolved.fullName, day: args.day, hotel: hotel.name }, result };
  },

  compress: (raw: unknown) => {
    const out = raw as { refused?: string; placed?: { worker: string; day: string; hotel?: string } } | null;
    if (out?.refused) return { summary: out.refused, data: null };
    if (out?.placed) {
      // The hotel is named back because an admin or RM may cover several and
      // needs to see which one this landed on.
      const where = out.placed.hotel ? ` at ${out.placed.hotel}` : '';
      return {
        summary: `${out.placed.worker} is on the calendar for ${out.placed.day}${where}.`,
        data: { worker: out.placed.worker, day: out.placed.day, hotel: out.placed.hotel ?? null },
      };
    }
    return { summary: 'Done.', data: null };
  },
  maxResultTokens: 120,
});

/**
 * A whole week in one instruction.
 *
 * "Anna Monday and Tuesday, Tomasz Wednesday, Ayşe Thursday and Friday" is
 * how a manager actually plans, and this is the tool that accepts it.
 *
 * A BATCH TOOL RATHER THAN A PLANNING LAYER. The obvious alternative was a
 * new routing rung that loops the model -- call a tool, feed the result back,
 * call the next -- which is more machinery, more turns, more tokens, and
 * more places for a partial failure to hide. A single tool taking a list
 * reuses the confirmation flow, the resolver and the executor exactly as
 * they are, and gives the manager ONE approval for the whole week instead of
 * forty.
 *
 * EVERY NAME IS RESOLVED BEFORE ANYTHING IS WRITTEN. If one name is
 * ambiguous or unknown, NOTHING is placed and the manager is told which
 * entries are wrong. The alternative -- place the 38 that resolved, report
 * the 2 that did not -- means a half-built week that is harder to reason
 * about than an empty one: the manager cannot simply re-issue the
 * instruction, because doing so would double-book the 38.
 *
 * PARTIAL FAILURE IS STILL POSSIBLE AFTER THAT POINT, and is reported per
 * entry rather than collapsed into one status. A worker already placed that
 * day, or newly ineligible for the hotel, fails at the service while its
 * neighbours succeed. Those are real answers a manager can act on; hiding
 * them behind "some placements failed" would not be.
 */
const MAX_PLACEMENTS = 30;

const PlaceManyArgs = z
  .object({
    // ONE hotel for the whole batch, not one per entry. A manager plans a
    // week at a hotel; letting each row name a different one would multiply
    // the resolution surface and make the confirmation summary far harder to
    // check at a glance. Cross-hotel planning is two instructions.
    hotel_name: z.string().trim().min(2).max(120).optional(),
    placements: z
      .array(
        z
          .object({
            worker_name: z.string().trim().min(2).max(80),
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
          })
          .strict()
      )
      .min(1)
      // Bounded by the turn timeout, not by taste: each placement is a
      // separate service call with its own eligibility and conflict checks,
      // and a list long enough to exceed CHATBOT_TURN_TIMEOUT_MS would be
      // aborted midway with some entries already written.
      .max(MAX_PLACEMENTS),
  })
  .strict();

type PlaceManyArgs = z.infer<typeof PlaceManyArgs>;

interface PlacementOutcome {
  worker: string;
  day: string;
  ok: boolean;
  error?: string;
}

export const placeManyOnCalendar = registerTool<PlaceManyArgs>({
  name: 'assignments.place_many',
  description:
    "Put several of the manager's OWN workers on the calendar in one go. Use when a " +
    'manager describes a schedule covering more than one worker or day, e.g. "Anna ' +
    'Monday and Tuesday, Tomasz Wednesday". Give each worker\'s name and the day as ' +
    'YYYY-MM-DD. For a single placement prefer assignments.place_worker.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-ASG-PlaceOnCalendar (assignments/service.ts placeOnCalendar(), per entry)',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    "The widest blast radius in the registry -- up to 30 workers' days committed in one confirmed action, each of them notified.",

  args: PlaceManyArgs,
  permission: 'staffing:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const serviceActor = toServiceActor(actor);

    // ---- Pass 0: the hotel, once for the batch ----------------------------
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') {
      return { refused: [describeUnresolvedHotel(hotel)], placed: [] as PlacementOutcome[] };
    }

    // ---- Pass 1: resolve every name. Write nothing yet. -------------------
    const resolutions = await Promise.all(
      args.placements.map(async (p) => ({
        placement: p,
        resolved: await resolveWorkerReference(p.worker_name, actor, hotel.hotelId),
      }))
    );

    const unresolved = resolutions.filter((r) => r.resolved.status !== 'RESOLVED');
    if (unresolved.length > 0) {
      return {
        refused: unresolved.map((r) => describeUnresolved(r.resolved)),
        placed: [] as PlacementOutcome[],
      };
    }

    // ---- Pass 2: place them, recording each outcome separately ------------
    const outcomes: PlacementOutcome[] = [];
    for (const { placement, resolved } of resolutions) {
      if (resolved.status !== 'RESOLVED') continue; // narrowed above; keeps TS honest
      try {
        await assignmentService.placeOnCalendar(
          { worker_id: resolved.workerId, hotel_id: hotel.hotelId, day: placement.day },
          serviceActor
        );
        outcomes.push({ worker: resolved.fullName, day: placement.day, ok: true });
      } catch (error) {
        // Sequential, and deliberately NOT aborted on the first failure: one
        // worker already booked that day should not cancel the rest of a
        // week the manager has already approved.
        outcomes.push({
          worker: resolved.fullName,
          day: placement.day,
          ok: false,
          error: error instanceof Error ? error.message : 'could not be placed',
        });
      }
    }

    return { refused: [] as string[], placed: outcomes };
  },

  compress: (raw: unknown) => {
    const out = (raw ?? {}) as { refused?: string[]; placed?: PlacementOutcome[] };

    if (out.refused && out.refused.length > 0) {
      return {
        summary:
          `Nothing was scheduled. ${out.refused.length} name${out.refused.length === 1 ? '' : 's'} ` +
          `could not be matched: ${out.refused.join(' ')}`,
        data: null,
      };
    }

    const placed = out.placed ?? [];
    const ok = placed.filter((p) => p.ok);
    const failed = placed.filter((p) => !p.ok);

    return {
      summary:
        failed.length === 0
          ? `Scheduled ${ok.length} shift${ok.length === 1 ? '' : 's'}.`
          : `Scheduled ${ok.length} of ${placed.length}. ${failed.length} could not be placed.`,
      // Failures carry their reason; successes are just a confirmation that
      // the named person has that day. Names, never ids.
      data: {
        scheduled: ok.map((p) => ({ worker: p.worker, day: p.day })),
        ...(failed.length > 0
          ? { failed: failed.map((p) => ({ worker: p.worker, day: p.day, reason: p.error })) }
          : {}),
      },
    };
  },
  maxResultTokens: 1200,
});

/**
 * A manager records a SICK or VACATION day for one of their own workers.
 *
 * WHY THIS EXISTS. The owner's motivating use case is dictating a week's plan
 * in prose -- "Anna is off sick Monday, put Tomasz on Tuesday" -- and until
 * now only the second half of that sentence was possible. `place_worker`
 * covered assignments; absence had only the SELF path
 * (`calendar.mark_my_absence`), so a manager could not record the thing they
 * are most often told by phone at 6am. `markAbsenceForWorker` already existed
 * in the service and was deliberately left unwrapped; this wraps it.
 *
 * THE PERMISSION IS NEW, AND THAT WAS THE HONEST OPTION. `POST
 * /calendar/absences` gated on `requireRole(admin|manager|regional_manager)`
 * and no token at all, so there was no true `permission` for this tool to
 * declare. `null` is not available to a HIGH_RISK_WRITE (the registry refuses
 * it, correctly), and borrowing `staffing:write` -- which happens to be held
 * by those same three roles -- would have declared a token the route does not
 * check, the documented trap in CHATBOT_HANDOFF section 6. So
 * `calendar:absence:write-team` was added to exactly those roles AND enforced
 * on the route, making it a no-op for HTTP callers and a true statement here.
 * This is the same argument, and the same resolution, as the 2026-09-04
 * decision that introduced `calendar:absence:write-own`.
 *
 * WHY IT IS SAFE TO EXPOSE A WRITE ON ANOTHER PERSON'S RECORD:
 *
 *  - `worker_id` is never an argument (FORBIDDEN_ARG_KEY). The worker is
 *    named in free text and resolved inside the actor's own scope by
 *    `resolveWorkerReference`, which narrows candidates to the hotel BEFORE
 *    matching -- so a name that matches nobody in scope cannot reveal that it
 *    matches someone elsewhere.
 *  - `markAbsenceForWorker` re-checks group scope itself
 *    (`isWorkerInGroupScope`) exactly as the HTTP route relies on. The model
 *    cannot widen it; nothing it emits is an authorization input.
 *  - It also refuses to overwrite an absence the WORKER marked themselves
 *    (`assertSelfMarkedAbsenceIsUntouched`, per the 2026-08-29 owner
 *    decision). That protection is inherited here, not restated -- a manager
 *    cannot use the assistant to silently replace a worker's own declaration
 *    any more than they can by hand.
 *  - HIGH_RISK_WRITE with `confirm: true`: it commits another person's day
 *    and is a protected record afterwards, so the actor sees the exact call
 *    before it runs.
 *
 * KNOWN LIMIT, stated rather than discovered later: `resolveWorkerReference`
 * searches WORKER-role staff only, so a checker's absence cannot be recorded
 * this way even though a manager supervises checkers too. That is the
 * resolver's existing behaviour, shared with `place_worker`, and widening it
 * is a change to that helper's contract rather than something to special-case
 * here.
 */
const MarkWorkerAbsenceArgs = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
    kind: z.enum(['SICK', 'VACATION']),
    reason: z.string().trim().min(1).max(500).optional(),
    // A NAME, not an id. A hotel-scoped manager never needs it; an admin or
    // regional manager covers several and must say which, since guessing
    // would search the wrong roster.
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict()
  // The service's rule, restated so it fails at PROPOSAL time rather than
  // after the manager has already confirmed a call that cannot run.
  .refine((d) => d.kind !== 'VACATION' || Boolean(d.reason), {
    message: 'reason is required for a VACATION absence',
    path: ['reason'],
  });

type MarkWorkerAbsenceArgs = z.infer<typeof MarkWorkerAbsenceArgs>;

export const markWorkerAbsence = registerTool<MarkWorkerAbsenceArgs>({
  name: 'calendar.mark_worker_absence',
  description:
    "Record a sick or vacation day for one of the manager's OWN workers. Use for " +
    '"Anna is off sick on Monday", "Tomasz called in sick", "book Maria off next ' +
    'Friday". Give the worker\'s name as they are known at the hotel; the day must ' +
    'be YYYY-MM-DD. A vacation day requires a reason; a sick day does not. This ' +
    "does NOT record the manager's own absence -- use calendar.mark_my_absence for that.",
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-CAL-MarkAbsenceForWorker (calendar/service.ts markAbsenceForWorker())',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    "Writes to another person's calendar and creates a record protected against later correction.",

  args: MarkWorkerAbsenceArgs,
  permission: 'calendar:absence:write-team',
  // 'none' for the same reason as assignments.place_worker: there is no hotel
  // ARGUMENT to pre-check. The hotel comes from the actor's own scope inside
  // invoke(), and markAbsenceForWorker re-checks group scope regardless.
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    // Hotel FIRST: the roster is a property of a hotel, so there is nothing
    // to search until we know which one.
    const hotel = await resolveHotelReference(args.hotel_name, actor);
    if (hotel.status !== 'RESOLVED') {
      return { refused: describeUnresolvedHotel(hotel) };
    }

    const resolved = await resolveWorkerReference(args.worker_name, actor, hotel.hotelId);
    if (resolved.status !== 'RESOLVED') {
      // A refusal, not an exception: "there are two Annas" is a normal answer
      // the manager can act on, and throwing would turn it into a failed turn
      // carrying no useful guidance.
      return { refused: describeUnresolved(resolved) };
    }

    const absence = await calendarService.markAbsenceForWorker(
      {
        worker_id: resolved.workerId,
        day: args.day,
        kind: args.kind,
        ...(args.reason ? { reason: args.reason } : {}),
      },
      toServiceActor(actor)
    );

    return { worker: resolved.fullName, hotel: hotel.name, absence };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | { refused?: string; worker?: string; hotel?: string; absence?: { day?: string; kind?: string } }
      | null;

    if (!result) return { summary: 'Nothing was recorded.', data: null };
    if (result.refused) return { summary: result.refused, data: null };

    const kind = String(result.absence?.kind ?? '').toLowerCase();
    return {
      summary: `Recorded ${kind} leave for ${result.worker} on ${result.absence?.day}.`,
      // Deliberately no worker id: the manager asked by name and reads the
      // answer by name, and an id here would only give the model a string it
      // might repeat back.
      data: { worker: result.worker, day: result.absence?.day, kind: result.absence?.kind },
    };
  },
  maxResultTokens: 120,
});

/**
 * "Which documents do I still need to upload?"
 *
 * The onboarding question the assistant was originally conceived to answer,
 * and the last read-only gap. An applicant partway through onboarding is
 * exactly the person least able to navigate a document checklist UI, and most
 * likely to ask in plain language -- often in German, and often at the point
 * where the answer decides whether they can start work.
 *
 * WHY THE WORK-PERMIT FLAG IS READ FROM THE RECORD, NOT ACCEPTED AS AN INPUT.
 * `getDocumentCompleteness` takes `isWorkPermitRequired` as a PARAMETER, and
 * the HTTP route supplies it from a client query string
 * (`documents/controller.ts`: `req.query.work_permit_required === 'true'`).
 * That is not a shape to copy here. It is not an authorization input -- so
 * FORBIDDEN_ARG_KEYS would not have caught it -- but it decides what
 * "complete" MEANS: a `false` on a worker who genuinely needs a permit
 * returns "all documents complete" to someone who cannot lawfully start.
 *
 * So it is derived server-side from `EmploymentRecord.work_permit_required`,
 * the field ADR-065 section 6 item 8 makes authoritative and the same one
 * `submitForReview` gates on (employee-management/service.ts). The assistant's
 * answer therefore agrees with the actual onboarding gate rather than with
 * whatever the caller claimed.
 *
 * Both calls are existing module interfaces (ADR-053 item 2). `getByUserId`
 * applies its own visibility rule and `getDocumentCompleteness` re-checks
 * self-scope for worker/checker callers, so the guarantee holds even though
 * this tool passes the actor's own id to both.
 *
 * WHY `permission: null` IS CORRECT HERE and not a workaround:
 * `GET /workers/:worker_id/documents/completeness` carries `requireRole` over
 * all five roles plus a scope middleware, and NO permission token. There is
 * no token to declare. The registry permits `null` only for a READ_ONLY,
 * self-scoped tool with a written rationale, which is exactly this. Note the
 * same route shape (role gate, no token) forces a DIFFERENT answer for a
 * write: `null` is unavailable to anything above READ_ONLY, so a write tool
 * wrapping such a route has to have a real token named and enforced first.
 */
const MyDocumentsArgs = z.object({}).strict();

type MyDocumentsArgs = z.infer<typeof MyDocumentsArgs>;

/** Human-readable names. The model must never echo a raw enum at a person. */
const DOCUMENT_LABELS: Record<string, string> = {
  TAX_NUMBER: 'tax number',
  SOCIAL_SECURITY_NUMBER: 'social security number',
  HEALTH_INSURANCE: 'health insurance',
  ID_CARD: 'ID card',
  PASSPORT: 'passport',
  ADDRESS: 'proof of address',
  WORK_PERMIT: 'work permit',
  CONTRACT_SCAN: 'signed contract',
};

/**
 * Turns `missing_categories` into something true when read aloud.
 *
 * THE ID_CARD/PASSPORT PAIR IS THE WHOLE REASON THIS EXISTS. When neither is
 * on file the service pushes BOTH onto `missing` (documents/service.ts), but
 * only ONE is required -- they are alternatives. Listing them flatly would
 * tell an applicant to produce two identity documents when either will do,
 * which is a wrong answer that costs somebody a trip to an office. Rendered
 * as one "ID card or passport" item instead.
 */
export function describeMissingDocuments(missing: string[]): string[] {
  const set = new Set(missing);
  const bothIdFormsMissing = set.has('ID_CARD') && set.has('PASSPORT');

  const items = missing
    .filter((c) => !(bothIdFormsMissing && (c === 'ID_CARD' || c === 'PASSPORT')))
    .map((c) => DOCUMENT_LABELS[c] ?? c.toLowerCase().replace(/_/g, ' '));

  if (bothIdFormsMissing) items.unshift('ID card or passport');
  return items;
}

export const getMyDocumentStatus = registerTool<MyDocumentsArgs>({
  name: 'documents.my_status',
  description:
    "Check which onboarding documents the authenticated user has already provided and " +
    'which are still missing. Use for "what documents do I still need", "welche ' +
    'Unterlagen fehlen noch", "am I missing anything for onboarding", "is my file complete".',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef:
    'IF-DOC-GetDocumentCompleteness (documents/service.ts getDocumentCompleteness()) ' +
    '+ IF-EMP-GetByUserId (employee-management/service.ts getByUserId())',
  approvalRef:
    APPROVED_2026_09_08 +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY. Derives the work-permit requirement from the employment record, never from the caller.',

  args: MyDocumentsArgs,
  // The route enforces no permission token -- requireRole over all five roles
  // plus a scope middleware IS the gate. Modelled honestly rather than
  // borrowing a token the route does not check.
  permission: null,
  permissionRationale:
    'GET /workers/:worker_id/documents/completeness (documents/routes.ts) carries ' +
    'requireRole over all five roles and scopeWorkerReadRoute(), and NO ' +
    'requirePermission. Self-scope is the control here: the worker id is the ' +
    "actor's own, is not expressible as a tool argument (FORBIDDEN_ARG_KEY), and " +
    'getDocumentCompleteness re-applies its own self-scope check for worker and ' +
    'checker callers.',
  scopeCheck: 'self',

  invoke: async (_args, actor) => {
    const serviceActor = toServiceActor(actor);

    // The requirement comes from the RECORD, never from the caller. See the
    // block comment above: this is the difference between a true answer and a
    // confidently wrong one.
    const record = await employeeManagementService.getByUserId(
      serviceActor as never,
      serviceActor.userId
    );

    const completeness = await documentService.getDocumentCompleteness(
      serviceActor.userId,
      record?.work_permit_required ?? false,
      serviceActor.userId,
      serviceActor.role
    );

    return {
      complete: completeness.is_complete,
      missing: describeMissingDocuments(completeness.missing_categories ?? []),
      provided: completeness.document_count,
      // Surfaced so the summary can say WHY a permit is or is not on the
      // list, rather than leaving its absence unexplained.
      workPermitRequired: completeness.work_permit_required,
      // A record is genuinely absent for some callers (an admin with no
      // employment record of their own). Reported rather than silently
      // treated as "no permit needed".
      hasEmploymentRecord: record !== null,
    };
  },

  compress: (raw: unknown) => {
    const r = raw as {
      complete?: boolean;
      missing?: string[];
      provided?: number;
      hasEmploymentRecord?: boolean;
    } | null;

    if (!r) return { summary: 'Could not read your document status.', data: null };

    const missing = r.missing ?? [];
    const summary = r.complete
      ? `All required documents are on file (${r.provided ?? 0} uploaded).`
      : `Still needed: ${missing.join(', ')}.`;

    return {
      summary,
      // No document ids, no worker id, no category enums -- a person asking
      // this needs the list and the verdict, nothing else.
      data: { complete: r.complete, missing, provided: r.provided },
    };
  },
  maxResultTokens: 150,
});
