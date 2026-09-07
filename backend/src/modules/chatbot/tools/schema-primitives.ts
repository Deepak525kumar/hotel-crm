import { z } from 'zod';

/**
 * SHARED ARGUMENT PRIMITIVES — validated semantically, not just syntactically.
 *
 * THE DEFECT THIS EXISTS TO FIX. Every date argument in the registry was
 * `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. That is a SHAPE check, and it
 * accepts `2026-13-45` — a thirteenth month and a forty-fifth day. Valid
 * syntax, impossible date; the same class of bug as an `age` of 250 passing
 * because the JSON parsed.
 *
 * The platform had already been bitten by exactly this in `quality/service.ts`
 * and written the lesson down there: `2026-13-45` reached Prisma as an Invalid
 * Date and surfaced as a generic "Invalid database request", while
 * `2026-02-30` SILENTLY ROLLED OVER to March 2 and the response echoed back
 * `2026-02-30` — a result for a day nobody asked about. The chatbot tools
 * repeated the regex without the lesson, and a model is far more likely than
 * a UI date-picker to emit a plausible-but-impossible date.
 *
 * Centralised rather than fixed per tool, because a rule copied into fifteen
 * schemas is a rule that will be fifteen slightly different rules within a
 * year. `chatbot-tool-design-rules.test.ts` asserts no tool declares its own
 * date regex.
 */

/**
 * A real calendar date in YYYY-MM-DD.
 *
 * The round-trip is what makes this semantic rather than syntactic: a date is
 * accepted only if formatting it back yields the string that was supplied.
 * `2026-02-30` parses (JavaScript rolls it to March 2) but does not round-trip,
 * so it is rejected here instead of quietly answering about the wrong day.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) return false;
      // Round-trip: rejects 2026-02-30, 2026-04-31 and every other date that
      // exists only as a string.
      return parsed.toISOString().slice(0, 10) === value;
    },
    { message: 'must be a real calendar date' }
  );

/**
 * A date bounded to what this platform can meaningfully talk about.
 *
 * A shift in 1970 or 2400 is not a date-format problem, it is a typo or a
 * hallucination, and letting one through produces a confidently empty answer
 * ("you have no shifts in 1970") that reads like a real result. Ten years back
 * matches the operational retention window -- there is nothing older to
 * report on -- and two years forward is well beyond any real roster.
 */
export const plausibleDate = isoDate.refine(
  (value) => {
    const year = Number(value.slice(0, 4));
    const now = new Date().getUTCFullYear();
    return year >= now - 10 && year <= now + 2;
  },
  { message: 'must be within ten years past and two years ahead' }
);

/** A room number: short, and never an id in disguise. */
export const roomNumber = z.string().trim().min(1).max(20);

/** A person's name as they are known at the hotel, never an identifier. */
export const personName = z.string().trim().min(2).max(80);
