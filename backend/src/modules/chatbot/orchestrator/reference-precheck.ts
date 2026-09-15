import type { z } from 'zod';
import type { ActorContext } from '../tools/actor.js';
import {
  describeUnresolved,
  describeUnresolvedHotel,
  resolveHotelReference,
  resolveWorkerReference,
} from '../tools/worker-reference.js';

/**
 * RESOLVE EVERY REFERENCE BEFORE ASKING A HUMAN TO APPROVE THE CALL.
 *
 * THE DEFECT THIS EXISTS FOR, observed in production 2026-09-10. A manager
 * asked to place "worker 1" at "hotel 1". The assistant showed:
 *
 *     This will run: assignments.place_worker
 *       worker_name: worker 1
 *       day: 2023-04-10
 *       hotel_name: hotel 1
 *     Nothing has been changed yet. Confirm to go ahead, or cancel.
 *
 * They confirmed, and only then were told `No hotel matching "hotel 1" is in
 * your scope.` The approval was meaningless: it authorised a call that could
 * never run, and the person had no way to know that at the moment they were
 * asked.
 *
 * The confirmation gate already parsed the arguments first, with a comment
 * saying it did so precisely so nobody would be "approving a fiction". That
 * reasoning was right and the implementation was half of it: a schema check
 * proves the arguments are WELL FORMED, not that the things they name EXIST.
 * "hotel 1" is a perfectly valid string.
 *
 * So this closes the other half, and it is deliberately GENERIC rather than a
 * patch on the one tool that exposed it. Any tool taking a `hotel_name` or
 * `worker_name` gets the same treatment, automatically, including tools that
 * do not exist yet -- the rule is "a confirmation states what will actually
 * happen", not "place_worker checks its hotel".
 *
 * TWO OUTCOMES, both better than the old one:
 *
 *   - Unresolvable: the person is told NOW, in the same words the tool would
 *     have used, and is never asked to approve it. One turn is saved and no
 *     false approval is recorded.
 *   - Resolvable: the arguments are REWRITTEN to the canonical names, so the
 *     confirmation shows `Hotel Adler`, not the `hotel 1` the model guessed
 *     from. What the person reads is then what the executor will act on,
 *     which is the entire point of showing it to them.
 *
 * This does NOT weaken the executor. Every tool still resolves its own
 * references at execution time against the actor derived from `req.auth`;
 * this runs earlier and in addition, and nothing it produces is an
 * authorization input. Rewriting to a canonical name narrows what the
 * executor can match -- it cannot widen it.
 */
export type ReferencePrecheck =
  | { status: 'RESOLVED'; args: Record<string, unknown> }
  | { status: 'REFUSED'; message: string };

/**
 * The argument names a tool's schema declares.
 *
 * Read from the SCHEMA, not from the parsed arguments, because an optional
 * `hotel_name` the model omitted is absent from the parsed object while the
 * tool will still try to resolve a hotel when it runs. Unwraps `ZodEffects`
 * so a schema carrying a `.refine()` is not mistaken for having no fields.
 */
export function schemaKeys(schema: z.ZodTypeAny): Set<string> {
  let node = schema as unknown as { _def?: { schema?: unknown; shape?: unknown } };
  while (node?._def?.schema) {
    node = node._def.schema as typeof node;
  }
  const shape = node?._def?.shape;
  if (typeof shape === 'function') return new Set(Object.keys((shape as () => object)()));
  if (shape && typeof shape === 'object') return new Set(Object.keys(shape as object));
  return new Set();
}

export async function precheckReferences(
  schema: z.ZodTypeAny,
  args: Record<string, unknown>,
  actor: ActorContext
): Promise<ReferencePrecheck> {
  const keys = schemaKeys(schema);
  const out: Record<string, unknown> = { ...args };

  // The hotel FIRST, and not only because some tools need it: a roster is a
  // property of a hotel, so a worker cannot be resolved until we know which
  // one to look in. Same ordering the tools themselves use.
  let hotelId: string | undefined;

  if (keys.has('hotel_name')) {
    const raw = typeof out['hotel_name'] === 'string' ? (out['hotel_name'] as string) : undefined;
    const hotel = await resolveHotelReference(raw, actor);
    if (hotel.status !== 'RESOLVED') {
      return { status: 'REFUSED', message: describeUnresolvedHotel(hotel) };
    }
    hotelId = hotel.hotelId;
    // Canonical name, so the confirmation shows the hotel that will actually
    // be written to rather than the string the model guessed.
    out['hotel_name'] = hotel.name;
  }

  if (keys.has('worker_name')) {
    const raw = typeof out['worker_name'] === 'string' ? (out['worker_name'] as string) : '';
    if (raw.trim().length > 0) {
      const worker = await resolveWorkerReference(raw, actor, hotelId);
      if (worker.status !== 'RESOLVED') {
        return { status: 'REFUSED', message: describeUnresolved(worker) };
      }
      out['worker_name'] = worker.fullName;
    }
  }

  // NAMES INSIDE A LIST, TOO.
  //
  // Production, 2026-09-15. A manager asked to schedule Harvir Singh on the
  // 15th, 16th and 17th. `assignments.place_many` carries its names inside
  // `placements[]`, and this precheck only ever looked at a top-level
  // `worker_name` -- so the batch sailed through to the confirmation screen,
  // the manager pressed Confirm, the UI showed "✓ Confirmed", and only then
  // did the tool say:
  //
  //     Nothing was scheduled. No worker matching "Harvir Singh" is on your
  //     team. No worker matching "Harvir Singh" is on your team. No worker
  //     matching "Harvir Singh" is on your team.
  //
  // Exactly the "approving a fiction" defect this file was written to close,
  // reintroduced by the one tool whose schema nests its references. The rule
  // is unchanged: a confirmation states what will actually happen.
  //
  // Each distinct name is resolved once, and each distinct refusal is said
  // once -- three identical sentences about one person read as three
  // problems.
  if (keys.has('placements') && Array.isArray(out['placements'])) {
    const seen = new Map<string, Awaited<ReturnType<typeof resolveWorkerReference>>>();
    const refusals = new Set<string>();
    const rewritten: unknown[] = [];

    for (const entry of out['placements'] as unknown[]) {
      if (!entry || typeof entry !== 'object') {
        rewritten.push(entry);
        continue;
      }
      const row = { ...(entry as Record<string, unknown>) };
      const raw = typeof row['worker_name'] === 'string' ? (row['worker_name'] as string) : '';
      if (raw.trim().length > 0) {
        const cacheKey = raw.trim().toLowerCase();
        let worker = seen.get(cacheKey);
        if (!worker) {
          worker = await resolveWorkerReference(raw, actor, hotelId);
          seen.set(cacheKey, worker);
        }
        if (worker.status === 'RESOLVED') {
          row['worker_name'] = worker.fullName;
        } else {
          refusals.add(describeUnresolved(worker));
        }
      }
      rewritten.push(row);
    }

    if (refusals.size > 0) {
      return { status: 'REFUSED', message: [...refusals].join(' ') };
    }
    out['placements'] = rewritten;
  }

  return { status: 'RESOLVED', args: out };
}

/**
 * The names of the hotels this person covers, for the system prompt.
 *
 * Same source and same scope narrowing as the `hotels.my_hotels` tool --
 * `listHotels` applies the caller's role and scope claim itself, so this can
 * disclose nothing they could not already list. Capped because a prompt is
 * not a place to paginate: an admin covering hundreds of sites gets none of
 * them and is asked to name one, which is the correct behaviour for someone
 * who genuinely has to choose.
 */
const MAX_PROMPT_HOTELS = 12;

export async function actorHotelNames(actor: ActorContext): Promise<string[]> {
  try {
    const { crmService } = await import('../../crm/service.js');
    const result = (await crmService.listHotels(
      { page: 1, limit: MAX_PROMPT_HOTELS + 1 } as never,
      actor.role,
      actor.userId,
      actor.scope ?? null
    )) as { hotels?: Array<{ name?: string }> };

    const names = (result.hotels ?? [])
      .map((h) => h.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);

    return names.length > MAX_PROMPT_HOTELS ? [] : names;
  } catch {
    // Prompt context is an ENHANCEMENT. If it cannot be read the assistant
    // still works exactly as it did before -- it just has to ask which
    // hotel. Failing the turn over it would trade a good answer for no
    // answer.
    return [];
  }
}


/**
 * The names of the workers this person supervises, for the system prompt.
 *
 * SAME DEFECT AS THE HOTELS, reported 2026-09-10: "it wasn't able to properly
 * understand which user I was talking about". The model was never told who is
 * on the team, so a name it had not seen was a name it had to guess at -- and
 * `resolveWorkerReference` matches on substring, so a guess that is not a
 * substring of a real name comes back NOT_FOUND with nothing to offer.
 * Knowing the roster lets it pass the FULL name it was going to have to match
 * anyway.
 *
 * Bounded hard, and empty above the bound. A prompt is not a place to
 * paginate, and a manager of two hundred people does not get a useful hint
 * from a list of two hundred names -- they get a diluted prompt and a bigger
 * bill. Above the cap this returns nothing and the assistant behaves exactly
 * as it did before: ask, resolve, refuse if unclear.
 *
 * Discloses nothing new: these are the people whose shifts the caller already
 * manages, listed by the same scope-narrowed query `users.find_team_member`
 * runs for them on request.
 */
const MAX_PROMPT_WORKERS = 25;

export async function actorWorkerNames(actor: ActorContext): Promise<string[]> {
  // A worker has no team; asking would be a query per turn for an empty list.
  if (actor.role === 'worker') return [];

  try {
    const { userService } = await import('../../users/service.js');
    const result = (await userService.listUsers(
      { page: 1, limit: MAX_PROMPT_WORKERS + 1, role: 'worker' } as never,
      { role: actor.role, userId: actor.userId, scope: actor.scope ?? null }
    )) as { data?: Array<{ full_name?: string | null }> };

    const names = (result.data ?? [])
      .map((u) => u.full_name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);

    return names.length > MAX_PROMPT_WORKERS ? [] : names;
  } catch {
    // Prompt context is an enhancement. Without it the assistant asks, which
    // is what it did before -- failing the turn would be strictly worse.
    return [];
  }
}


/**
 * The language this person chose for the app, named in full.
 *
 * The prompt said "Reply in the language the user wrote in. German and
 * English are both common here" -- and the model still answered an English
 * question in German twice on 2026-09-10, because the surrounding context
 * (German hotel names, a German platform) outweighed one short message.
 *
 * It also undersold the problem. `UI_LOCALES` is de, en, ur, ar, fr, uk: a
 * worker can be running the app in Urdu, Arabic, French or Ukrainian, and
 * "the language the user wrote in" is a weak signal for a two-word message in
 * any of them. `User.preferred_language` is an EXPLICIT choice the person
 * already made, and it beats inference.
 *
 * Null when unset, which is a real state -- the column is nullable so the
 * client can negotiate from the device locale. The prompt then falls back to
 * the inference rule, exactly as before.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  en: 'English',
  ur: 'Urdu',
  ar: 'Arabic',
  fr: 'French',
  uk: 'Ukrainian',
};

export async function actorLanguage(actor: ActorContext): Promise<string | null> {
  try {
    const { getPrisma } = await import('../../../lib/db.js');
    const row = await getPrisma().user.findUnique({
      where: { id: actor.userId },
      select: { preferred_language: true },
    });
    const code = row?.preferred_language;
    return code ? (LANGUAGE_NAMES[code] ?? null) : null;
  } catch {
    return null;
  }
}
