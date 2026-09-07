import { getPrisma } from '../../../lib/db.js';
import { listEligibleWorkerIds } from '../../../lib/roster-scope.js';
import type { ActorContext } from './actor.js';

/**
 * Turning "Anna" into a worker id, inside the caller's own scope.
 *
 * WHY THIS EXISTS. A manager planning a week says "put Anna on Tuesday".
 * They cannot say an id, because `worker_id` and `hotel_id` are
 * FORBIDDEN_ARG_KEYS -- an id supplied by a model is an authorization input
 * wearing a semantic costume, and the forbidden-key list exists to stop
 * exactly that. So the NAME is the argument, and resolution happens here,
 * server-side, from the actor's own scope.
 *
 * THE RESOLUTION IS THE SECURITY BOUNDARY, not a convenience. Two properties
 * matter more than the matching itself:
 *
 *  1. **The candidate set never exceeds the caller's scope.** Candidates come
 *     from `listEligibleWorkerIds(hotelId)` for the hotel the ACTOR is scoped
 *     to -- not from a platform-wide user search filtered afterwards. Search
 *     then filter would make this a probe oracle: a manager could type
 *     fragments and learn who exists elsewhere from the shape of the
 *     responses.
 *  2. **Ambiguity refuses rather than guesses.** Two Annas means no write.
 *     Picking "the closest" would silently roster the wrong person, and the
 *     manager would confirm a summary that named someone they never chose.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not serve an unscoped actor.
 * An admin or regional manager has no single hotel to resolve against, and
 * guessing one would be worse than refusing. They keep the manual path until
 * a hotel-reference argument exists, which is its own design problem.
 */

export type WorkerReferenceResult =
  | { status: 'RESOLVED'; workerId: string; fullName: string; hotelId: string }
  | { status: 'NO_SCOPE' }
  | { status: 'NOT_FOUND'; query: string }
  | { status: 'AMBIGUOUS'; query: string; candidates: string[] };

/** The hotel an actor is scoped to, or null when they are not hotel-scoped. */
function hotelIdFromScope(actor: ActorContext): string | null {
  const scope = actor.scope;
  if (!scope || scope.type !== 'hotel') return null;
  return scope.hotel_id;
}

/** Case- and diacritic-insensitive, so "anna" finds "Anna" and "Ünal" finds "unal". */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .trim();
}

export async function resolveWorkerReference(
  query: string,
  actor: ActorContext
): Promise<WorkerReferenceResult> {
  const hotelId = hotelIdFromScope(actor);
  if (!hotelId) return { status: 'NO_SCOPE' };

  const needle = fold(query);
  if (needle.length === 0) return { status: 'NOT_FOUND', query };

  // Scope FIRST, match second. This ordering is the point: the candidate set
  // is bounded by the actor's own hotel before any name is compared, so a
  // name that matches nobody in scope cannot reveal that it matches someone
  // elsewhere.
  const eligibleIds = await listEligibleWorkerIds(hotelId, 'WORKER');
  if (eligibleIds.length === 0) return { status: 'NOT_FOUND', query };

  const candidates = await getPrisma().user.findMany({
    where: { id: { in: eligibleIds }, deleted_at: null, is_active: true },
    select: { id: true, first_name: true, last_name: true },
  });

  const matches = candidates.filter((c) => {
    const full = fold(`${c.first_name} ${c.last_name}`);
    // Substring rather than prefix: managers say "Schmidt" as readily as
    // "Anna", and a prefix match would fail every surname query.
    return full.includes(needle);
  });

  if (matches.length === 0) return { status: 'NOT_FOUND', query };

  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS',
      query,
      // Names only. These people are all inside the caller's own scope, so
      // naming them discloses nothing they cannot already see -- but ids
      // would be useless to a person and are exactly what must not travel.
      candidates: matches.map((m) => `${m.first_name} ${m.last_name}`).sort(),
    };
  }

  const only = matches[0]!;
  return {
    status: 'RESOLVED',
    workerId: only.id,
    fullName: `${only.first_name} ${only.last_name}`,
    hotelId,
  };
}

/** The sentence a person sees when resolution did not produce exactly one worker. */
export function describeUnresolved(result: WorkerReferenceResult): string {
  switch (result.status) {
    case 'NO_SCOPE':
      return 'This can only be done by a manager assigned to a specific hotel.';
    case 'NOT_FOUND':
      return `No worker matching "${result.query}" is on your team.`;
    case 'AMBIGUOUS':
      return (
        `More than one worker matches "${result.query}": ` +
        `${result.candidates.join(', ')}. Please use a fuller name.`
      );
    default:
      return 'Could not identify that worker.';
  }
}
