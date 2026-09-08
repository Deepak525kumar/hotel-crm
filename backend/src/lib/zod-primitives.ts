import { z } from 'zod';

/**
 * SHARED SCHEMA PRIMITIVES — semantic, not merely syntactic.
 *
 * Lives in `lib/` rather than inside a module because the rule it encodes is
 * platform-wide and was already being reinvented. A shape regex for a date
 * appeared in the chatbot tools, the reports module and the quality service,
 * and each copy had to learn the same lesson separately -- which is precisely
 * how a rule becomes several slightly different rules.
 */

/**
 * A REAL calendar date in YYYY-MM-DD.
 *
 * `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` is a SHAPE check and accepts
 * `2026-13-45`: a thirteenth month and a forty-fifth day. Valid syntax,
 * impossible date -- the same class of defect as an `age` of 250 passing
 * because the JSON parsed.
 *
 * Worse than an outright reject is the silent case. `2026-02-30` parses:
 * JavaScript rolls it forward to March 2. `quality/service.ts` documents
 * hitting exactly this -- the response echoed back `2026-02-30` while
 * answering about a day nobody asked about.
 *
 * The ROUND TRIP is what makes this semantic: a date is accepted only if
 * formatting it back yields the string supplied, which rejects every date
 * that exists only as a string.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed.toISOString().slice(0, 10) === value;
    },
    { message: 'must be a real calendar date' }
  );

/**
 * A date bounded to what this platform can meaningfully discuss.
 *
 * A year of 1970 or 2400 is not a formatting problem, it is a typo or a
 * hallucination, and admitting one produces a confidently EMPTY answer --
 * which a person reads as "nobody worked", not as "you asked about the wrong
 * decade". Ten years back matches the operational retention window: there is
 * nothing older left to report on.
 */
export const plausibleDate = isoDate.refine(
  (value) => {
    const year = Number(value.slice(0, 4));
    const now = new Date().getUTCFullYear();
    return year >= now - 10 && year <= now + 2;
  },
  { message: 'must be within ten years past and two years ahead' }
);
