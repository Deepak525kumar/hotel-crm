import { notificationService } from '../../notifications/service.js';
import { qualityService } from '../../quality/service.js';
import { toServiceActor } from './actor.js';
import { refuse } from './tool-errors.js';
import type { ActorContext } from './actor.js';

/**
 * Turning what a person SAID into the record they meant.
 *
 * WHY THIS EXISTS, and it is a defect fix rather than a feature. Two approved
 * tools took a raw identifier -- `notifications.mark_read` wanted a
 * `notification_id`, `quality.assign_rework` a `verification_id` -- and a
 * model has neither. A live routing check found both selecting NO TOOL for
 * their own example phrases ("mark that message as read", "send room 214
 * back"), which was the model behaving correctly: it declined to invent an
 * identifier rather than fabricating one.
 *
 * That made both tools unreachable in practice. Nothing in the unit suite
 * could show it, because every test supplied an id the model never has.
 * Conversation memory would not have rescued them either: transcripts are not
 * stored, so an id from a previous turn is not available on this one.
 *
 * THE SAME SHAPE AS `worker-reference.ts`, deliberately: scope first, match
 * second. The candidate set is bounded by the actor's own records BEFORE any
 * text is compared, so a phrase that matches nothing of theirs cannot reveal
 * that it matches somebody else's. Ambiguity is refused rather than guessed --
 * sending the wrong room back for rework is a person's afternoon.
 */

export type ContextResolution<T> =
  | { status: 'RESOLVED'; value: T }
  | { status: 'NOT_FOUND'; query: string }
  | { status: 'AMBIGUOUS'; query: string; candidates: string[] }
  | { status: 'NONE_AVAILABLE' };

export interface ResolvedNotification {
  id: string;
  label: string;
}

export interface ResolvedInspection {
  id: string;
  roomNumber: string;
  workerName: string | null;
}

/** Lowercase, umlaut-folded, for the same reason the L0 router folds. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim();
}

/**
 * The notification a person means.
 *
 * With no query this resolves the most recent UNREAD one, which is what
 * "mark that as read" means in practice -- nobody says it about a message
 * they read last week. With a query it matches against the title and body of
 * the caller's OWN notifications only.
 *
 * Already-read notifications are excluded from the no-query path but NOT from
 * a search: "mark the payslip message as read" should find it and report that
 * it already is, rather than claiming no such message exists.
 */
export async function resolveNotificationReference(
  actor: ActorContext,
  query?: string
): Promise<ContextResolution<ResolvedNotification>> {
  const serviceActor = toServiceActor(actor);

  // Scoped by construction: getNotifications filters on the caller's own
  // user_id internally and takes no other id.
  const all = (await notificationService.getNotifications(serviceActor.userId)) as Array<{
    id: string;
    title?: string | null;
    message?: string | null;
    body?: string | null;
    is_read?: boolean | null;
    read_at?: Date | string | null;
  }>;

  const isRead = (n: (typeof all)[number]) => Boolean(n.is_read ?? n.read_at);
  const label = (n: (typeof all)[number]) =>
    (n.title ?? n.message ?? n.body ?? 'message').toString().slice(0, 60);

  if (!query || fold(query).length === 0) {
    const unread = all.filter((n) => !isRead(n));
    if (unread.length === 0) return { status: 'NONE_AVAILABLE' };
    // Most recent first is getNotifications' own ordering.
    return { status: 'RESOLVED', value: { id: unread[0].id, label: label(unread[0]) } };
  }

  const needle = fold(query);
  const matches = all.filter((n) =>
    fold(`${n.title ?? ''} ${n.message ?? ''} ${n.body ?? ''}`).includes(needle)
  );

  if (matches.length === 0) return { status: 'NOT_FOUND', query };
  if (matches.length > 1) {
    return { status: 'AMBIGUOUS', query, candidates: matches.slice(0, 5).map(label) };
  }
  return { status: 'RESOLVED', value: { id: matches[0].id, label: label(matches[0]) } };
}

/**
 * The inspection a checker means, by room number.
 *
 * `listOwnChecks` is the owning module's own scoped read: it filters on
 * `verified_by_id === actor.userId` and searches room numbers case-
 * insensitively. A checker can therefore only ever reach an inspection they
 * personally carried out, which is the same boundary the HTTP route enforces.
 *
 * Rooms already sent back are excluded: "send 214 back" about a room already
 * awaiting rework is a no-op the person should be told about, not a second
 * rework assignment.
 */
export async function resolveInspectionReference(
  actor: ActorContext,
  roomNumber: string
): Promise<ContextResolution<ResolvedInspection>> {
  const serviceActor = toServiceActor(actor);

  const result = (await qualityService.listOwnChecks(serviceActor as never, {
    q: roomNumber,
    page: 1,
    perPage: 25,
  })) as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

  const rows = (Array.isArray(result) ? result : (result.data ?? [])) as Array<{
    id: string;
    room_number?: string | null;
    rework_required?: boolean | null;
    worker?: { first_name?: string | null; last_name?: string | null } | null;
  }>;

  const needle = fold(roomNumber);
  // The service's `q` is a CONTAINS search, so "14" would also return 214.
  // Narrowed to an exact room match here: sending the wrong room back is
  // somebody's afternoon.
  const exact = rows.filter((r) => fold(String(r.room_number ?? '')) === needle);
  const open = exact.filter((r) => !r.rework_required);

  if (exact.length === 0) return { status: 'NOT_FOUND', query: roomNumber };
  if (open.length === 0) return { status: 'NONE_AVAILABLE' };
  if (open.length > 1) {
    return {
      status: 'AMBIGUOUS',
      query: roomNumber,
      candidates: open.slice(0, 5).map((r) => workerName(r.worker) ?? 'unknown worker'),
    };
  }

  return {
    status: 'RESOLVED',
    value: {
      id: open[0].id,
      roomNumber: String(open[0].room_number ?? roomNumber),
      workerName: workerName(open[0].worker),
    },
  };
}

function workerName(person: { first_name?: string | null; last_name?: string | null } | null | undefined) {
  if (!person) return null;
  return [person.first_name, person.last_name].filter(Boolean).join(' ') || null;
}

/** A refusal a person can act on, in their own terms. */
export function describeNotificationMiss(result: ContextResolution<unknown>): string {
  switch (result.status) {
    case 'NONE_AVAILABLE':
      return 'You have no unread messages.';
    case 'NOT_FOUND':
      return `No message of yours matches "${(result as { query: string }).query}".`;
    case 'AMBIGUOUS':
      return (
        `Several of your messages match "${(result as { query: string }).query}": ` +
        `${(result as { candidates: string[] }).candidates.join('; ')}. Which one?`
      );
    default:
      return 'Could not identify that message.';
  }
}

export function describeInspectionMiss(result: ContextResolution<unknown>): string {
  switch (result.status) {
    case 'NONE_AVAILABLE':
      return 'That room has already been sent back for rework.';
    case 'NOT_FOUND':
      return `You have no inspection on record for room ${(result as { query: string }).query}.`;
    case 'AMBIGUOUS':
      return (
        `You inspected room ${(result as { query: string }).query} more than once. ` +
        'Please use the app for this one.'
      );
    default:
      return 'Could not identify that inspection.';
  }
}

/** The same refusals, carrying a code (see worker-reference.ts for why). */
export function refuseNotificationMiss(result: ContextResolution<unknown>) {
  const code =
    result.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
    : result.status === 'NONE_AVAILABLE' ? 'ALREADY_DONE'
    : 'NOT_FOUND';
  return refuse(code, describeNotificationMiss(result));
}

export function refuseInspectionMiss(result: ContextResolution<unknown>) {
  const code =
    result.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
    // "already sent back for rework" is the state having moved past the ask.
    : result.status === 'NONE_AVAILABLE' ? 'ALREADY_DONE'
    : 'NOT_FOUND';
  return refuse(code, describeInspectionMiss(result));
}

