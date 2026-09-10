import { refuse } from './tool-errors.js';
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

/**
 * Case-, diacritic- and separator-insensitive, so "anna" finds "Anna",
 * "Ünal" finds "unal", and "hotel 1" finds "hotel_1_group_1".
 *
 * The separator rule was added 2026-09-10 after a manager typing "hotel 1"
 * was told no such hotel was in their scope while `hotel_1_group_1` sat in
 * it. Underscores and hyphens are how systems write names; spaces are how
 * people type them, and the difference is not something a user should have
 * to guess. Runs of separators collapse to ONE space so "hotel__1" and
 * "hotel - 1" fold the same way.
 */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[_\-\s]+/g, ' ')
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
  // WORKER **AND CHECKER**.
  //
  // This searched WORKER only, and it was recorded as a known limit rather
  // than a defect -- until a manager hit it in production on 2026-09-10:
  //
  //     > place checker named new checker on a shift in hotel 1 today
  //     No worker matching "new checker" is on your team.
  //     > not worker i am saying he's a checker
  //     No worker matching "new checker" is on your team.
  //
  // The person WAS on their team. The assistant could not see them, said
  // something that read as a flat contradiction, and repeated it when
  // corrected.
  //
  // A checker is staffable: `TargetRoleEnum` is ['WORKER', 'CHECKER'],
  // `EmploymentRecord` carries no role of its own precisely because "a
  // checker has one exactly like a worker does", and attendance admits a
  // checker to check in because "a checker works a shift like a worker does".
  // The narrowing was never a rule, only a default nobody had needed to
  // revisit.
  //
  // Both roles are named EXPLICITLY rather than omitting the filter: omitting
  // it also returns managers and admins who hold employment records, and a
  // manager is not someone you put on a cleaning shift.
  const eligibleIds = await listEligibleWorkerIds(hotelId, ['WORKER', 'CHECKER']);
  if (eligibleIds.length === 0) return { status: 'NOT_FOUND', query };

  const candidates = await getPrisma().user.findMany({
    where: { id: { in: eligibleIds }, deleted_at: null, is_active: true },
    select: { id: true, first_name: true, last_name: true, role: true },
  });

  const matches = candidates.filter((c) => {
    const full = fold(`${c.first_name} ${c.last_name}`);
    // Substring rather than prefix: managers say "Schmidt" as readily as
    // "Anna", and a prefix match would fail every surname query.
    return full.includes(needle);
  });

  if (matches.length === 0) return { status: 'NOT_FOUND', query };

  // AN EXACT MATCH WINS OUTRIGHT.
  //
  // Substring matching is right -- managers say "Schmidt" as readily as
  // "Anna" -- but it made an exactly-named person ambiguous with anyone whose
  // name merely contains theirs. Production, 2026-09-10:
  //
  //     > is worker 1 available to work in hotel 1 today?
  //     More than one worker matches "worker 1": worker 1, worker 10.
  //     Please use a fuller name.
  //
  // There is no fuller name. "worker 1" IS the full name, and the assistant
  // asked for something the manager could not give -- they eventually
  // resorted to quoting it. Whenever exactly one candidate matches the query
  // EXACTLY, that is the answer, and the fact that another name contains it
  // as a prefix says nothing about which person was meant.
  const exact = matches.filter((c) => fold(`${c.first_name} ${c.last_name}`) === needle);
  const resolved = exact.length === 1 ? exact : matches;

  if (resolved.length > 1) {
    return {
      status: 'AMBIGUOUS',
      query,
      // Names only. These people are all inside the caller's own scope, so
      // naming them discloses nothing they cannot already see -- but ids
      // would be useless to a person and are exactly what must not travel.
      // The ROLE is included now that both are searched: "Anna Braun
      // (checker)" and "Anna Braun (worker)" are the same string without it,
      // and telling them apart is the entire purpose of this message.
      candidates: resolved
        .map((m) => {
          const name = `${m.first_name} ${m.last_name}`;
          // The suffix is dropped rather than rendered when the role is
          // absent: "Anna Schmidt (undefined)" is worse than "Anna Schmidt",
          // and this string is read by a person.
          return m.role ? `${name} (${String(m.role).toLowerCase()})` : name;
        })
        .sort(),
    };
  }

  const only = resolved[0]!;
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
  /** `choices` are the caller's own hotels, so the question can name them. */
  | { status: 'NEEDS_NAME'; choices: string[] }
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
  if (!needle) {
    // ASK WITH THE OPTIONS IN THE QUESTION.
    //
    // This used to return "Which hotel? Please name it, since you cover more
    // than one" -- a question that withholds the very thing needed to answer
    // it. Production, 2026-09-10: the manager was asked it twice and replied
    // "what are the options.", which is the only sensible response to being
    // asked to pick from a list nobody showed them.
    //
    // Their own hotels, from their own scope, which they can already see on
    // their home screen. Capped, because past a dozen the list stops being an
    // answer and starts being a wall.
    const { hotels } = await crmService.listHotels(
      { page: 1, limit: 13 } as never,
      actor.role,
      actor.userId,
      actor.scope ?? null
    );
    const names = (hotels ?? [])
      .map((h: { name?: string }) => h.name)
      .filter((n): n is string => typeof n === 'string');
    return { status: 'NEEDS_NAME', choices: names.length > 12 ? [] : names };
  }

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


/** "a, b or c" -- how a person reads a short list of choices. */
function humanList(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** The sentence a person sees when a hotel could not be identified. */
export function describeUnresolvedHotel(result: HotelReferenceResult): string {
  switch (result.status) {
    case 'NEEDS_NAME':
      return result.choices.length > 0
        ? `Which hotel do you mean -- ${humanList(result.choices)}?`
        : 'Which hotel? Please name it, since you cover more than one.';
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

/**
 * The same refusals, carrying a CODE.
 *
 * `describeUnresolved` returns prose, which is what a person reads; these
 * return the structured shape, which is what decides the next move. A model
 * cannot tell "try a fuller name" from "this person is not yours" by reading
 * English, and rule 16's whole point is that it should not have to.
 */
export function refuseUnresolved(result: WorkerReferenceResult) {
  const code =
    result.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
    : result.status === 'NO_SCOPE' ? 'OUT_OF_SCOPE'
    : 'NOT_FOUND';
  return refuse(code, describeUnresolved(result));
}

export function refuseUnresolvedHotel(result: HotelReferenceResult) {
  const code =
    result.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
    // NEEDS_NAME is the caller having to supply something, not an absence.
    : result.status === 'NEEDS_NAME' ? 'NEEDS_INPUT'
    : 'NOT_FOUND';
  return refuse(code, describeUnresolvedHotel(result));
}

