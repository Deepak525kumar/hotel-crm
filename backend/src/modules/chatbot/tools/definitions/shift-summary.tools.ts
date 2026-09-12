import { z } from 'zod';
import { isoDate } from '../schema-primitives.js';
import { ShiftSummaryService } from '../../../calendar/shift-summary/service.js';
import { resolveHotelAccess } from '../../../../middleware/permissions.js';
import { refuseUnresolvedHotel, resolveHotelReference } from '../worker-reference.js';
import { registerTool } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { APPROVED_2026_09_12_SHIFT_SUMMARY } from '../approvals.js';
import { todayIso } from './daily-operations.tools.js';
import type { ActorContext } from '../actor.js';

/**
 * THE DAILY SHIFT SUMMARY -- the day's room counts and headcount.
 *
 * WHY THIS EXISTS. Reported 2026-09-12 with two transcripts, one from an
 * admin and one from a manager, both saying the same thing:
 *
 *     "Make day task rooms today we have 90 rooms to clean add that work
 *      list and 10 blibe"
 *
 * and both refused. The assistant could place workers, move shifts, correct
 * timesheets and broadcast for staff, but it could not record the single
 * number every one of those decisions is made FROM. A manager standing at a
 * front desk at 06:50 with the night auditor's figures had to open the
 * calendar, switch to the day view, pick the hotel, press Edit, and type four
 * numbers into a form -- which is exactly the population and exactly the
 * moment a conversational interface exists for.
 *
 * ("blibe" is `bleiben` -- the German housekeeping word for a stay-over, a
 * room whose guest is not checking out. It is spelled several ways on the
 * floor; the tool description carries the vocabulary so the model maps it.)
 *
 * THE FIELDS ARE MERGED, NEVER REPLACED, and that is the whole reason this
 * file is longer than the route it wraps. `PUT /hotels/:id/shift-summaries/:date`
 * takes an upsert whose body REQUIRES all four counts
 * (`dailyShiftSummarySchema` -- total_rooms, stay_over_rooms, checkout_rooms,
 * total_people_working), so a caller who supplies one field writes zeros over
 * the other three. A form cannot do that: it loads the row first and posts
 * every box back. A sentence can, and does -- "90 rooms today" names exactly
 * one of the four. So `set_day_summary` READS the existing row, overlays only
 * what it was actually told, and writes the whole thing back. Without that,
 * the second sentence of a conversation silently erases the first.
 *
 * NO INFERENCE BETWEEN THE COUNTS. "90 rooms and 10 stay-over" does not set
 * checkout to 80. Housekeeping's own arithmetic is total = stay-over +
 * checkout, but neither the schema nor the panel enforces it, hotels count
 * refusals and out-of-service rooms differently, and a derived number that
 * turns out wrong is indistinguishable on the screen from one a person typed.
 * The summary SAYS SO instead when the three it can see do not add up, which
 * puts the discrepancy in front of the manager rather than resolving it for
 * them.
 *
 * AUTHORIZATION IS THE ROUTE'S OWN, re-derived rather than borrowed. These
 * call `ShiftSummaryService` directly, so `requireRole(['admin',
 * 'regional_manager', 'manager'])` and `checkHotelAccess()` do not run.
 * `permission` restores the first (staffing:read / staffing:write are held by
 * exactly those three roles and by neither worker nor checker -- verified
 * against the real ROLE_PERMISSIONS, not assumed), and `resolveHotelAccess()`
 * -- the same function `checkHotelAccess()` delegates to -- restores the
 * second. `resolveHotelReference` already narrows candidates to the caller's
 * own hotels, so the explicit check is belt and braces; it is here because the
 * day someone widens that resolver is the day this would otherwise become a
 * cross-hotel write with nothing in the file to catch it.
 *
 * WHY ADMIN AND REGIONAL MANAGER GET THIS AND NOT JUST THE HOTEL MANAGER.
 * The same report asked for it, and the route has always allowed all three.
 * The difference is only that a hotel manager has one hotel and the other two
 * do not, so for them `hotel_name` is required rather than optional -- the
 * resolver asks which hotel, listing their own, instead of guessing.
 */

const service = new ShiftSummaryService();

/** The counts, as the model may give them. Every one optional -- see the merge note above. */
const countArgs = {
  total_rooms: z.number().int().min(0).max(10_000).optional(),
  stay_over_rooms: z.number().int().min(0).max(10_000).optional(),
  checkout_rooms: z.number().int().min(0).max(10_000).optional(),
  people_working: z.number().int().min(0).max(1_000).optional(),
  notes: z.string().trim().max(2_000).optional(),
};

const SetDaySummaryArgs = z
  .object({
    hotel_name: z.string().trim().min(2).max(120).optional(),
    day: isoDate.optional(),
    ...countArgs,
  })
  .strict()
  .refine(
    (a) =>
      a.total_rooms !== undefined ||
      a.stay_over_rooms !== undefined ||
      a.checkout_rooms !== undefined ||
      a.people_working !== undefined ||
      a.notes !== undefined,
    // A call with nothing but a hotel and a day would read the row, write it
    // straight back, and report success -- an edit that changed nothing,
    // attributed to whoever asked.
    { message: 'Give at least one of the counts or a note to record.' }
  );
type SetDaySummaryArgs = z.infer<typeof SetDaySummaryArgs>;

const DaySummaryArgs = z
  .object({
    hotel_name: z.string().trim().min(2).max(120).optional(),
    day: isoDate.optional(),
  })
  .strict();
type DaySummaryArgs = z.infer<typeof DaySummaryArgs>;

/** The stored row, narrowed to what these tools read. */
interface SummaryRow {
  total_rooms: number;
  stay_over_rooms: number;
  checkout_rooms: number;
  total_people_working: number;
  notes: string | null;
}

/**
 * `date` is stored as a DATE column; the route parses `new Date('2026-09-12')`,
 * which is midnight UTC. Matched exactly here so a row written through the
 * assistant and one written through the panel land on the same key -- two rows
 * for one day would make the upsert's unique constraint the thing that finds
 * out.
 */
const dayKey = (day: string): Date => new Date(day);

async function readRow(hotelId: string, day: string): Promise<SummaryRow | null> {
  const key = dayKey(day);
  const rows = (await service.getSummariesByDateRange(hotelId, key, key)) as SummaryRow[];
  return rows[0] ?? null;
}

/** Resolves the hotel by name and re-applies the route's own hotel gate. */
async function resolveHotel(
  hotelName: string | undefined,
  actor: ActorContext
): Promise<{ hotelId: string; name: string } | { refused: unknown }> {
  const hotel = await resolveHotelReference(hotelName, actor);
  if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel) as { refused: unknown };

  const decision = await resolveHotelAccess(
    actor.role,
    actor.userId,
    hotel.hotelId,
    actor.scope ?? null
  );
  if (!decision.allowed) {
    // OUT_OF_SCOPE, not NOT_FOUND: the hotel is real and the caller may well
    // know its name. Its `stop` action is also the right one -- rephrasing
    // must not be presented as a way through a scope boundary.
    return refuse(
      'OUT_OF_SCOPE',
      `${hotel.name} is not one of the hotels you cover, so its daily summary is not yours to read or change.`
    ) as { refused: unknown };
  }
  return { hotelId: hotel.hotelId, name: hotel.name };
}

/** Present tense for today, so the summary reads like the day it describes. */
const dayPhrase = (day: string): string => (day === todayIso() ? 'today' : `on ${day}`);

/**
 * The counts, rendered once, in the order the panel shows them. Shared so a
 * read and a write describe the same row identically -- a manager who asks
 * "what's the summary" after setting it should not get different wording for
 * the same numbers and wonder which one took.
 */
function describeCounts(row: SummaryRow): string {
  const parts = [
    `${row.total_rooms} rooms`,
    `${row.stay_over_rooms} stay-over`,
    `${row.checkout_rooms} checkout`,
    `${row.total_people_working} working`,
  ];
  return parts.join(', ');
}

/**
 * The arithmetic note. Stated, never applied: see the header. Silent when the
 * parts genuinely add up, and when either part is still zero -- a day with
 * nothing but a total entered is mid-entry, not inconsistent.
 */
function mismatchNote(row: SummaryRow): string {
  const split = row.stay_over_rooms + row.checkout_rooms;
  if (split === 0 || row.total_rooms === 0 || split === row.total_rooms) return '';
  return ` (stay-over and checkout come to ${split}, not ${row.total_rooms} -- worth a check.)`;
}

export const daySummary = registerTool<DaySummaryArgs>({
  name: 'calendar.day_summary',
  description:
    "Read a hotel's daily shift summary for one day: how many rooms there are to clean, " +
    'how many are stay-over ("bleiben"/"blibe" -- the guest is not leaving), how many are ' +
    'checkout ("abreise"), how many people are working, and the notes. Use for "how many ' +
    'rooms do we have today", "what\'s the plan for Friday", "wie viele Zimmer haben wir ' +
    'heute". Give the day as YYYY-MM-DD; defaults to today. Name the hotel unless you ' +
    'manage exactly one. Returns the four counts and the notes as they are recorded.\n\n' +
    'This is the day\'s PLAN as somebody recorded it, not live progress -- for rooms ' +
    'actually finished use the room tools, and for who has actually clocked in use ' +
    'attendance.team_status.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-CAL-ShiftSummary (calendar/shift-summary/service.ts getSummariesByDateRange())',
  approvalRef: APPROVED_2026_09_12_SHIFT_SUMMARY,

  args: DaySummaryArgs,
  permission: 'staffing:read',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotel(args.hotel_name, actor);
    if ('refused' in hotel) return hotel;

    const day = args.day ?? todayIso();
    const row = await readRow(hotel.hotelId, day);
    return { hotel: hotel.name, day, summary: row };
  },

  compress: (raw: unknown) => {
    const result = raw as { hotel?: string; day?: string; summary?: SummaryRow | null } | null;
    if (!result) return { summary: 'Nothing was found.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const day = result.day ?? '';
    if (!result.summary) {
      return {
        summary: `No daily summary has been recorded for ${result.hotel} ${dayPhrase(day)} yet.`,
        data: { hotel: result.hotel, day, recorded: false },
      };
    }

    const row = result.summary;
    return {
      summary:
        `${result.hotel} ${dayPhrase(day)}: ${describeCounts(row)}.` +
        mismatchNote(row) +
        (row.notes ? ` Notes: ${row.notes}` : ''),
      data: {
        hotel: result.hotel,
        day,
        total_rooms: row.total_rooms,
        stay_over_rooms: row.stay_over_rooms,
        checkout_rooms: row.checkout_rooms,
        people_working: row.total_people_working,
        notes: row.notes ?? null,
      },
    };
  },
  maxResultTokens: 160,
});

export const setDaySummary = registerTool<SetDaySummaryArgs>({
  name: 'calendar.set_day_summary',
  description:
    "Record a hotel's daily shift summary -- the day's room counts, how many people are " +
    'working, and any notes. Use whenever you are told the day\'s numbers: "today we have ' +
    '90 rooms to clean and 10 stay-over", "put 4 workers on Friday", "heute 60 Zimmer, 20 ' +
    'bleiben, 40 Abreise", "add a note that the third floor is closed". Give the day as ' +
    'YYYY-MM-DD; defaults to today. Name the hotel unless you manage exactly one. Records ' +
    'the numbers and returns the whole day as it now stands.\n\n' +
    'Vocabulary: stay-over = "bleiben"/"blibe"/"stayover" (the guest is not leaving); ' +
    'checkout = "abreise"/"departure". Only pass the counts you were actually given -- ' +
    'anything you leave out keeps the value already recorded, and nothing is calculated ' +
    'from anything else, so do NOT derive checkout from total minus stay-over. This is the ' +
    "day's plan; it does not place anyone on a shift (use assignments.place_worker) and " +
    'does not record rooms as cleaned (use rooms.log_cleaned).',
  // LOW_RISK and unconfirmed on purpose. It writes four numbers and a note on
  // one hotel-day, changes nobody's pay, sends nothing to anybody, and is
  // corrected by saying the right number -- and because the merge above keeps
  // every field it was not told about, the failure mode a confirmation would
  // guard against (a partial sentence wiping the rest of the row) cannot
  // happen. Asking "shall I?" before writing a room count would make the
  // assistant slower than the form it replaces.
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-CAL-ShiftSummary (calendar/shift-summary/service.ts upsertSummary())',
  approvalRef:
    APPROVED_2026_09_12_SHIFT_SUMMARY +
    ' Registration note: merges into the existing row rather than replacing it, so an ' +
    'omitted count is preserved and never zeroed; no count is derived from another.',

  args: SetDaySummaryArgs,
  permission: 'staffing:write',
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const hotel = await resolveHotel(args.hotel_name, actor);
    if ('refused' in hotel) return hotel;

    const day = args.day ?? todayIso();
    const existing = await readRow(hotel.hotelId, day);

    // THE MERGE. `??` and not `||`, because 0 is a real count -- "no rooms
    // today" is a thing a closed floor makes true, and `||` would discard it
    // in favour of whatever was there before.
    const payload = {
      total_rooms: args.total_rooms ?? existing?.total_rooms ?? 0,
      stay_over_rooms: args.stay_over_rooms ?? existing?.stay_over_rooms ?? 0,
      checkout_rooms: args.checkout_rooms ?? existing?.checkout_rooms ?? 0,
      total_people_working: args.people_working ?? existing?.total_people_working ?? 0,
      notes: args.notes ?? existing?.notes ?? null,
    };

    const saved = (await service.upsertSummary(
      hotel.hotelId,
      dayKey(day),
      payload,
      actor.userId
    )) as SummaryRow;

    return { hotel: hotel.name, day, summary: saved, created: existing === null };
  },

  compress: (raw: unknown) => {
    const result = raw as
      | { hotel?: string; day?: string; summary?: SummaryRow; created?: boolean }
      | null;
    if (!result) return { summary: 'Nothing was recorded.', data: null };
    const refusal = asRefusal(result);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const row = result.summary;
    if (!row) return { summary: 'Nothing was recorded.', data: null };
    const day = result.day ?? '';

    return {
      // The WHOLE row is read back, not just what changed: the manager needs
      // to see that the numbers they did not mention are still the ones they
      // set earlier, which is the exact thing the merge exists to protect.
      summary:
        `${result.hotel} ${dayPhrase(day)} now reads ${describeCounts(row)}.` +
        mismatchNote(row) +
        (row.notes ? ` Notes: ${row.notes}` : ''),
      data: {
        hotel: result.hotel,
        day,
        total_rooms: row.total_rooms,
        stay_over_rooms: row.stay_over_rooms,
        checkout_rooms: row.checkout_rooms,
        people_working: row.total_people_working,
        notes: row.notes ?? null,
      },
    };
  },
  maxResultTokens: 160,
});
