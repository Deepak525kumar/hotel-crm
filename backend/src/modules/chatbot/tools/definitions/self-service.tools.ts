import { z } from 'zod';
import { assignmentService } from '../../../assignments/service.js';
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
