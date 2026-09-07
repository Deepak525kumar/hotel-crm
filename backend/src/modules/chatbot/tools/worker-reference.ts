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
  actor: ActorContext,
  /**
   * The hotel to resolve within. Optional so hotel-scoped managers keep the
   * original behaviour; supplied by callers that resolved a hotel first
   * (an admin or RM naming one), which is the only way those roles can use
   * a roster tool at all.
   *
   * It is NOT a client-supplied id: callers obtain it from
   * `resolveHotelReference`, which scopes its own candidates to the actor.
   */
  explicitHotelId?: string
): Promise<WorkerReferenceResult> {
  const hotelId = explicitHotelId ?? hotelIdFromScope(actor);
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


/**
 * Turning "Premier Inn" into a hotel id, inside the caller's own scope.
 *
 * WHY THIS EXISTS. `assignments.place_worker` and `place_many` could only
 * serve a hotel-scoped manager, because the hotel came from
 * `scope.hotel_id`. An admin or regional manager has no single hotel, so
 * they were refused outright -- a real hole in the week-planning feature
 * rather than a deliberate limit.
 *
 * `hotel_id` is a FORBIDDEN_ARG_KEY, so the argument is a NAME and
 * resolution happens here. The same two properties as the worker resolver
 * carry the weight:
 *
 *  1. **Candidates come from `crmService.listHotels` with the ACTOR passed
 *     in**, which applies its own scope narrowing (an IDOR fix of its own:
 *     managers and RMs previously got no filtering there at all). The
 *     candidate set is therefore bounded before any name is compared.
 *  2. **Ambiguity refuses.** Two hotels matching "Premier" means no write.
 *
 * A HOTEL-SCOPED MANAGER IS HANDLED SEPARATELY AND STRICTLY. They have
 * exactly one hotel, so a name is not needed -- but if they give one, it
 * must match. Silently using their own hotel when they named a different one
 * would place a worker somewhere they did not ask for, which is precisely
 * the class of error the confirmation summary exists to make visible.
 */
export type HotelReferenceResult =
  | { status: 'RESOLVED'; hotelId: string; name: string }
  | { status: 'NEEDS_NAME' }
  | { status: 'NOT_FOUND'; query: string }
  | { status: 'AMBIGUOUS'; query: string; candidates: string[] };

export async function resolveHotelReference(
  query: string | undefined,
  actor: ActorContext
): Promise<HotelReferenceResult> {
  const scoped = hotelIdFromScope(actor);

  // Imported lazily: crm/service.ts pulls in a wide dependency graph, and a
  // static import here would drag it into every chatbot tool module.
  const { crmService } = await import('../../crm/service.js');

  if (scoped) {
    const hotel = await getPrisma().hotel.findUnique({
      where: { id: scoped },
      select: { id: true, name: true },
    });
    if (!hotel) return { status: 'NOT_FOUND', query: query ?? '' };

    // A name that does not match their own hotel is a refusal, never a
    // silent substitution.
    if (query && !fold(hotel.name).includes(fold(query))) {
      return { status: 'NOT_FOUND', query };
    }
    return { status: 'RESOLVED', hotelId: hotel.id, name: hotel.name };
  }

  // Unscoped or group-scoped: a name is required. Defaulting would mean
  // guessing which of several hotels a manager meant.
  const needle = query?.trim();
  if (!needle) return { status: 'NEEDS_NAME' };

  // `hotels`, not `data` -- listHotels returns { hotels, pagination }.
  const { hotels } = await crmService.listHotels(
    { search: needle, page: 1, limit: 25 } as never,
    actor.role,
    actor.userId,
    actor.scope ?? null
  );

  if (!hotels || hotels.length === 0) return { status: 'NOT_FOUND', query: needle };
  if (hotels.length > 1) {
    return {
      status: 'AMBIGUOUS',
      query: needle,
      candidates: hotels.map((h) => h.name).sort(),
    };
  }
  return { status: 'RESOLVED', hotelId: hotels[0]!.id, name: hotels[0]!.name };
}

/** The sentence a person sees when a hotel could not be identified. */
export function describeUnresolvedHotel(result: HotelReferenceResult): string {
  switch (result.status) {
    case 'NEEDS_NAME':
      return 'Which hotel? Please name it, since you cover more than one.';
    case 'NOT_FOUND':
      return `No hotel matching "${result.query}" is in your scope.`;
    case 'AMBIGUOUS':
      return (
        `More than one hotel matches "${result.query}": ` +
        `${result.candidates.join(', ')}. Please be more specific.`
      );
    default:
      return 'Could not identify that hotel.';
  }
}
