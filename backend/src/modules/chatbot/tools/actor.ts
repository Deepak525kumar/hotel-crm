import type { Request } from 'express';
import type { UserScope } from '../../../lib/jwt.js';

/**
 * The actor a tool executes as.
 *
 * The single most important invariant in this module: an `ActorContext` can
 * ONLY be built from `req.auth`, which `authMiddleware` populates from a live
 * database read of the user row (id, role, is_active, deleted_at,
 * token_generation) on every single request (ADR-031 D-3). There is no other
 * constructor, and the branding field cannot be produced outside this file.
 *
 * Why the brand exists: the model's tool call is a *request*, not a command.
 * Nothing the model emits may ever become an identity, role, permission, or
 * scope value. Making that a type-level property means a future contributor
 * cannot accidentally hand-roll an actor from tool arguments — the compiler
 * rejects it — rather than relying on a reviewer noticing.
 *
 * A consequence worth stating: because permissions are derived request-time
 * and never cached, a worker deactivated or demoted mid-conversation is
 * denied on their very next tool call, with no cache to invalidate.
 */
// Type-level only: `declare const` emits nothing, so the brand exists purely
// in the type system and never appears on the runtime object. Constructing an
// ActorContext outside this file therefore requires a deliberate cast — which
// is exactly the reviewable moment we want, rather than something that can
// happen by accident from a tool-argument object.
declare const ACTOR_BRAND: unique symbol;

export interface ActorContext {
  readonly [ACTOR_BRAND]: true;
  readonly userId: string;
  readonly role: string;
  readonly permissions: readonly string[];
  readonly scope: UserScope | null;
}

/**
 * The ONLY way to obtain an ActorContext. Throws rather than returning a
 * partial actor: a tool must never run with a half-resolved identity.
 */
export function actorFromRequest(req: Request): ActorContext {
  if (!req.auth) {
    // Unreachable behind authMiddleware, which rejects before the handler
    // runs. Kept as a hard failure rather than a silent anonymous actor.
    throw new Error('actorFromRequest called without req.auth');
  }

  return {
    userId: req.auth.userId,
    role: req.auth.role,
    permissions: req.auth.permissions ?? [],
    scope: req.auth.scope ?? null,
  } as unknown as ActorContext;
}

/**
 * Shape the existing domain services expect for their own actor parameter
 * (e.g. `assignmentService.list(query, actor)`). Converting at the call site
 * keeps the branded type from leaking into module signatures we do not own.
 */
export function toServiceActor(actor: ActorContext): {
  userId: string;
  role: string;
  scope: UserScope | null;
} {
  return { userId: actor.userId, role: actor.role, scope: actor.scope };
}
