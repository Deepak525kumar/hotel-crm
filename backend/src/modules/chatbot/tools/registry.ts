import { z } from 'zod';
import type { ActorContext } from './actor.js';

/**
 * Tool registry (ADR-053 items 2, 4, 5, 6).
 *
 * Adding a capability is authoring a registration — never editing
 * orchestration code. Each registration names the module interface it wraps,
 * the governance decision that approved it, its risk tier, and its
 * confirmation requirement.
 */

export type RiskTier = 'READ_ONLY' | 'LOW_RISK_WRITE' | 'HIGH_RISK_WRITE';

export type ScopeCheck = 'none' | 'self' | 'hotel' | 'worker';

/**
 * Argument names a tool schema may NEVER declare.
 *
 * Every one of these is an authorization input. They are re-derived
 * server-side from `req.auth` at execution time (see tools/actor.ts), so a
 * tool that accepted one as an argument would be accepting an
 * authorization decision from model output — which is the single failure
 * mode this whole design exists to prevent.
 *
 * `internalBypass` is included deliberately and is not hypothetical:
 * `assignments/service.ts` accepts `internalBypass = false` as its 6th
 * parameter and skips a worker-role authorization branch when true. Tools
 * call the 5-argument form only; the name is banned here so no future tool
 * can plumb it through.
 *
 * Enforced three ways: this type (compile time), `assertNoForbiddenArgs`
 * (registration time), and a static test over the whole registry (CI).
 */
export const FORBIDDEN_ARG_KEYS = [
  'userId',
  'user_id',
  'actorId',
  'actor_id',
  'role',
  'actorRole',
  'actor_role',
  'permissions',
  'scope',
  'actorScope',
  'actor_scope',
  'hotelId',
  'hotel_id',
  'workerId',
  'worker_id',
  'internalBypass',
  'internal_bypass',
] as const;

export type ForbiddenArgKey = (typeof FORBIDDEN_ARG_KEYS)[number];

/** A tool argument object that provably declares no authorization input. */
export type SafeArgs = Record<string, unknown> & {
  [K in ForbiddenArgKey]?: never;
};

export interface CompactResult {
  /** Rendered deterministically by the caller — never by a model. */
  summary: string;
  data: unknown;
}

export interface ToolRegistration<A extends SafeArgs = SafeArgs> {
  /** Namespaced, e.g. "assignments.list_mine". */
  name: string;
  description: string;
  tier: RiskTier;
  /** Forced true for HIGH_RISK_WRITE at registration (ADR-053 item 5). */
  confirm: boolean;

  /** ADR-053 item 2: the owning module's interface this wraps. */
  interfaceRef: string;
  /** The governance decision that approved THIS tool (ADR-053 item 4). */
  approvalRef: string;

  /**
   * Strict — no passthrough, so unexpected keys are rejected, not ignored.
   * Input is `unknown` (the third type parameter) because what arrives is
   * raw, untrusted model output; `A` is the parsed output the tool receives,
   * which differs whenever a field uses `.default()`.
   */
  args: z.ZodType<A, z.ZodTypeDef, unknown>;
  /**
   * Permission token(s) re-checked in-process before execution.
   *
   * `null` means the wrapped interface itself requires no permission token —
   * authentication plus the owning service's own role-scoping IS the control
   * (e.g. `GET /assignments` is `authMiddleware`-only, and the service
   * narrows `where.worker_id` for self-scoped roles). Modelling that as
   * `null` rather than inventing a token is deliberate: a token the route
   * does not actually check would either be a lie about the real gate, or —
   * worse — a token the intended caller does not hold, silently denying
   * every legitimate user. `assertValidRegistration` constrains `null` hard
   * (see below), so it cannot become a loophole.
   */
  /**
   * `'tok'`         — require it.
   * `['a','b']`     — require BOTH (an AND, matching requirePermission's array form).
   * `{ anyOf: [] }` — require AT LEAST ONE.
   * `null`          — the wrapped interface enforces no token at all.
   *
   * `anyOf` exists for routes whose gate is ROLE-CONDITIONAL, of which this
   * platform has several: `requireContractReadAccess()` demands
   * `hr:contract:read-own` of a worker or checker and `hr:read` of everyone
   * else. Neither the string nor the array form can express that -- the array
   * is an AND, so naming both tokens denies everyone, since no role holds
   * both. Before `anyOf`, such tools were modelled as `null` with a written
   * rationale, which under-declared them.
   *
   * NOTE THE ONE DIFFERENCE from a true role-conditional gate: `anyOf` admits
   * anyone holding EITHER token, where the route would demand the specific
   * one for their role. The sets coincide today (no worker holds `hr:read`),
   * and the executor is a precondition rather than the authorization -- the
   * owning service re-checks -- but a future role holding both tokens would
   * be admitted here and could still be refused downstream. That is the
   * correct direction to be wrong in, and it is written down rather than
   * discovered.
   */
  permission: string | string[] | { anyOf: string[] } | null;
  /** Why `permission` is null. Required when it is; ignored otherwise. */
  permissionRationale?: string;
  scopeCheck: ScopeCheck;

  /**
   * Actor is injected by the executor from req.auth. Note there is no
   * `internalBypass` seam in this signature and no way to add one without
   * changing this type.
   */
  invoke: (args: A, actor: ActorContext) => Promise<unknown>;

  /** Mandatory: bounds tokens and strips fields the model has no need for. */
  compress: (raw: unknown) => CompactResult;
  maxResultTokens: number;
}

/**
 * Registration-time invariants. Runs at module load, so a violation is a
 * boot failure rather than a runtime surprise on the first tool call.
 */
export function assertValidRegistration(reg: ToolRegistration<any>): void {
  if (reg.tier === 'HIGH_RISK_WRITE' && !reg.confirm) {
    throw new Error(
      `Tool "${reg.name}" is HIGH_RISK_WRITE and must require confirmation (ADR-053 item 5)`
    );
  }

  if (reg.permission && typeof reg.permission === 'object' && 'anyOf' in reg.permission) {
    if (reg.permission.anyOf.length === 0) {
      // Would deny everyone, silently, and read as "no permission needed".
      throw new Error(`Tool "${reg.name}" declares an empty anyOf, which denies every role`);
    }
  }

  // A token-less tool is only permissible in the narrowest possible shape:
  // read-only, self-scoped, and with the reason written down. Anything wider
  // must name the token its wrapped route actually enforces.
  if (reg.permission === null) {
    if (reg.tier !== 'READ_ONLY') {
      throw new Error(`Tool "${reg.name}" has no permission token, so it must be READ_ONLY`);
    }
    if (reg.scopeCheck !== 'self') {
      throw new Error(`Tool "${reg.name}" has no permission token, so it must be self-scoped`);
    }
    if (!reg.permissionRationale?.trim()) {
      throw new Error(
        `Tool "${reg.name}" has no permission token and must state permissionRationale`
      );
    }
  }

  assertNoForbiddenArgs(reg);
}

/**
 * Runtime counterpart to the `SafeArgs` type constraint. The type alone is
 * not sufficient: a registration could widen its generic to `any`, or build
 * its schema dynamically, and lose the compile-time guarantee silently.
 */
export function assertNoForbiddenArgs(reg: ToolRegistration<any>): void {
  const keys = describeSchemaKeys(reg.args);
  const offending = keys.filter((k) => (FORBIDDEN_ARG_KEYS as readonly string[]).includes(k));
  if (offending.length > 0) {
    throw new Error(
      `Tool "${reg.name}" declares forbidden authorization argument(s): ${offending.join(', ')}. ` +
        'Identity, role, scope and permissions are derived from req.auth at execution time ' +
        'and must never be supplied by model output.'
    );
  }
}

/** Best-effort key extraction from a Zod object schema, for the checks above. */
export function describeSchemaKeys(schema: z.ZodTypeAny): string[] {
  const def = (schema as { _def?: { typeName?: string; schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny } })._def;
  if (!def) return [];

  if (def.typeName === 'ZodObject') {
    return Object.keys((schema as unknown as z.AnyZodObject).shape ?? {});
  }
  // Unwrap effects/optional/default wrappers so `.strict().refine(...)` still resolves.
  if (def.schema) return describeSchemaKeys(def.schema);
  if (def.innerType) return describeSchemaKeys(def.innerType);
  return [];
}

const registry = new Map<string, ToolRegistration<any>>();

export function registerTool<A extends SafeArgs>(reg: ToolRegistration<A>): ToolRegistration<A> {
  assertValidRegistration(reg);
  if (registry.has(reg.name)) {
    throw new Error(`Tool "${reg.name}" is already registered`);
  }
  registry.set(reg.name, reg);
  return reg;
}

/**
 * Allow-list lookup. A name the model invents resolves to undefined and is
 * hard-denied by the executor. A Map (not an object literal) so inherited
 * members like "constructor" or "__proto__" cannot resolve.
 */
/**
 * Every token a permission declaration mentions, in any of its forms.
 *
 * For inspection only -- it flattens `anyOf` to a flat list and therefore
 * LOSES the OR/AND distinction. Never use it to decide access; that is
 * `actorHasPermission`'s job, and three copies of that logic have already
 * had to be collapsed back into one.
 */
export function permissionTokens(permission: ToolRegistration<any>['permission']): string[] {
  if (permission === null) return [];
  if (typeof permission === 'string') return [permission];
  if (Array.isArray(permission)) return permission;
  return permission.anyOf;
}

export function resolveTool(name: string): ToolRegistration<any> | undefined {
  if (typeof name !== 'string') return undefined;
  return registry.get(name);
}

export function listTools(): ToolRegistration<any>[] {
  return Array.from(registry.values());
}

/** Test-only: the registry is module-level state shared across suites. */
export function __clearRegistryForTests(): void {
  registry.clear();
}
