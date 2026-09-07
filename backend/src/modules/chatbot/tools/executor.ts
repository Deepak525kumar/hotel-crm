import { createHash } from 'node:crypto';
import { ForbiddenError, ValidationError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { resolveHotelAccess, resolveWorkerScope } from '../../../middleware/permissions.js';
import type { ActorContext } from './actor.js';
import { resolveTool, type CompactResult, type ToolRegistration } from './registry.js';

/**
 * THE SECURITY BOUNDARY.
 *
 * Everything above this file (orchestrator, routers, the model itself) is
 * untrusted. Everything below it is the existing platform, unmodified.
 *
 * Every tool execution passes the same five-step gate, no exceptions:
 *
 *   1. AUTHENTICATED IDENTITY  — the ActorContext, constructible only from
 *                                req.auth (a live DB read, ADR-031 D-3).
 *   2. LIVE PERMISSIONS        — the tool's permission token(s) re-checked
 *                                in-process against req.auth.permissions,
 *                                which were derived request-time from
 *                                ROLE_PERMISSIONS[role].
 *   3. TENANT / SCOPE          — resolveHotelAccess / resolveWorkerScope: the
 *                                SAME seams the HTTP routes use, not a copy.
 *   4. DOMAIN AUTHORIZATION    — the owning service's own in-service checks
 *                                run again inside invoke().
 *   5. ACTION                  — executed with the step-1 actor.
 *
 * Steps 2-4 are deliberately redundant. Layer 4 exists in this codebase
 * precisely because `assignments/service.ts` list() once shipped with no
 * scope check while its siblings had one (the IDOR fix at service.ts:262).
 * The agent inherits that defense-in-depth rather than flattening it.
 */

export type ExecutionOutcome =
  | { status: 'SUCCESS'; result: CompactResult; durationMs: number }
  | { status: 'DENIED'; reason: string; denialCode: DenialCode };

export type DenialCode =
  | 'UNREGISTERED_TOOL'
  | 'INVALID_ARGS'
  | 'FORBIDDEN_ARG'
  | 'MISSING_PERMISSION'
  | 'OUT_OF_SCOPE'
  | 'CONFIRMATION_REQUIRED'
  // The tool ran and threw. executeTool deliberately lets invoke() errors
  // propagate (so a service's own ForbiddenError surfaces as itself), so
  // this is never produced HERE -- it is the code a caller uses when it
  // catches such an error and records the attempt. A confirmed high-risk
  // write that fails must leave an audit row; before this existed it left
  // none, because recordToolCall was never reached.
  | 'EXECUTION_FAILED';

export interface ExecuteRequest {
  toolName: string;
  /** Raw, untrusted — straight from model output or an L0 command payload. */
  rawArgs: unknown;
  actor: ActorContext;
  /** Set once a confirmation token has been verified (§6). */
  confirmed?: boolean;
  requestId?: string;
}

/**
 * Mirrors `requirePermission()`'s matching semantics exactly (AND across the
 * required set, `admin:*` bypass, `resource:*` wildcards). Re-implemented as
 * a pure predicate rather than reused directly because that export is Express
 * middleware — it signals via `next(err)` and needs req/res/next, neither of
 * which exists at tool-execution time. Kept deliberately in lock-step; if
 * that middleware's semantics change, this must change with it.
 */
export function actorHasPermission(
  actor: ActorContext,
  permissions: string | string[] | { anyOf: string[] }
): boolean {
  const held = actor.permissions ?? [];

  if (held.includes('admin:*')) return true;

  // `anyOf` is an OR, for routes whose gate is role-conditional. Delegates
  // per token so the wildcard rules below apply identically either way.
  if (typeof permissions === 'object' && !Array.isArray(permissions)) {
    return permissions.anyOf.some((token) => actorHasPermission(actor, token));
  }

  const required = Array.isArray(permissions) ? permissions : [permissions];

  return required.every(
    (permission) =>
      held.includes(permission) ||
      held.some((heldPerm) => {
        const [heldResource] = heldPerm.split(':');
        const [requiredResource] = permission.split(':');
        return heldPerm.endsWith(':*') && heldResource === requiredResource;
      })
  );
}

/**
 * Stable idempotency key for a tool call (§5). Bound to the conversation,
 * turn, tool and canonical arguments so a retry or double-tap cannot execute
 * a write twice.
 */
export function idempotencyKey(
  conversationId: string,
  turnIndex: number,
  toolName: string,
  args: unknown
): string {
  return createHash('sha256')
    .update(`${conversationId}|${turnIndex}|${toolName}|${canonicalJson(args)}`)
    .digest('hex');
}

/** Hash of the arguments alone — bound into confirmation tokens (§6). */
export function argsHash(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

/** Key-sorted JSON so argument order cannot change a hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export async function executeTool(req: ExecuteRequest): Promise<ExecutionOutcome> {
  const started = Date.now();

  // ---- Step 0: allow-list ---------------------------------------------------
  const tool = resolveTool(req.toolName);
  if (!tool) {
    return deny(req, 'UNREGISTERED_TOOL', `Tool "${req.toolName}" is not registered`);
  }

  // ---- Step 1: validate arguments (untrusted model output) ------------------
  const parsed = tool.args.safeParse(req.rawArgs);
  if (!parsed.success) {
    return deny(
      req,
      'INVALID_ARGS',
      `Arguments failed validation: ${parsed.error.errors.map((e) => e.path.join('.') || 'root').join(', ')}`
    );
  }
  const args = parsed.data;

  // Runtime re-check of the forbidden-key invariant on the PARSED value.
  // The schema is `.strict()` so this should be unreachable — kept because
  // the consequence of a miss is an authorization bypass, and the cost is a
  // key scan of a small object.
  const forbidden = findForbiddenKeys(args);
  if (forbidden.length > 0) {
    return deny(
      req,
      'FORBIDDEN_ARG',
      `Arguments contained authorization key(s): ${forbidden.join(', ')}`
    );
  }

  // ---- Step 2: confirmation gate (ADR-053 item 5) ---------------------------
  if (tool.confirm && !req.confirmed) {
    return deny(
      req,
      'CONFIRMATION_REQUIRED',
      `Tool "${tool.name}" requires explicit confirmation before execution`
    );
  }

  // ---- Step 3: live permission check ----------------------------------------
  // `null` = the wrapped interface enforces no token of its own (registry.ts).
  // Steps 4 and 5 still run: the scope precondition and the owning service's
  // own authorization are unaffected, so this is not an authorization hole.
  if (tool.permission !== null && !actorHasPermission(req.actor, tool.permission)) {
    return deny(
      req,
      'MISSING_PERMISSION',
      `Missing permission for "${tool.name}"`
    );
  }

  // ---- Step 4: tenant / scope precondition ----------------------------------
  const scopeDenial = await checkScope(tool, args, req.actor);
  if (scopeDenial) {
    return deny(req, 'OUT_OF_SCOPE', scopeDenial);
  }

  // ---- Step 5: action -------------------------------------------------------
  // The owning service runs its OWN authorization and its OWN audit inside
  // invoke() (ADR-053 item 3). Any error it raises propagates unchanged —
  // notably ForbiddenError, which is the service refusing on its own terms.
  const raw = await tool.invoke(args, req.actor);
  const result = tool.compress(raw);

  logger.info('Chatbot tool executed', {
    tool: tool.name,
    tier: tool.tier,
    userId: req.actor.userId,
    role: req.actor.role,
    requestId: req.requestId,
  });

  return { status: 'SUCCESS', result, durationMs: Date.now() - started };
}

/**
 * Scope preconditions, using the same seams the HTTP routes use.
 *
 * These are a precondition, not the authorization itself — the owning
 * service re-checks scope internally regardless (step 4 of the gate). A tool
 * whose scope is 'self' passes the actor's own id, never an argument.
 */
async function checkScope(
  tool: ToolRegistration<any>,
  args: Record<string, unknown>,
  actor: ActorContext
): Promise<string | null> {
  switch (tool.scopeCheck) {
    case 'none':
      return null;

    case 'self':
      // Nothing to check: a self-scoped tool operates on actor.userId, which
      // came from req.auth. There is no argument that could redirect it —
      // `workerId`/`worker_id` are forbidden argument names.
      return null;

    case 'hotel': {
      // The hotel is resolved from the tool's own semantic argument (e.g. a
      // resolved hotel reference), never from a raw client-supplied id —
      // `hotelId`/`hotel_id` are forbidden argument names, so a tool needing
      // this must resolve the hotel itself and expose it here.
      const hotelId = typeof args.hotel === 'string' ? args.hotel : undefined;
      const decision = await resolveHotelAccess(actor.role, actor.userId, hotelId, actor.scope);
      return decision.allowed ? null : `Hotel scope denied (${decision.reason})`;
    }

    case 'worker': {
      const workerId = typeof args.worker === 'string' ? args.worker : undefined;
      const decision = await resolveWorkerScope(actor.role, workerId, actor.scope, actor.userId);
      return decision.allowed ? null : `Worker scope denied (${decision.reason})`;
    }

    default:
      // Unknown scope mode fails closed rather than falling through open.
      return 'Unrecognized scope check';
  }
}

function findForbiddenKeys(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  // Imported lazily to avoid a cycle; the list is a frozen const array.
  const forbidden: readonly string[] = [
    'userId', 'user_id', 'actorId', 'actor_id', 'role', 'actorRole', 'actor_role',
    'permissions', 'scope', 'actorScope', 'actor_scope', 'hotelId', 'hotel_id',
    'workerId', 'worker_id', 'internalBypass', 'internal_bypass',
  ];
  return Object.keys(args as Record<string, unknown>).filter((k) => forbidden.includes(k));
}

function deny(req: ExecuteRequest, denialCode: DenialCode, reason: string): ExecutionOutcome {
  logger.warn('Chatbot tool denied', {
    tool: req.toolName,
    denialCode,
    userId: req.actor.userId,
    role: req.actor.role,
    requestId: req.requestId,
  });
  return { status: 'DENIED', reason, denialCode };
}

/** Re-exported so callers can distinguish a denial from a thrown service error. */
export { ForbiddenError, ValidationError };
