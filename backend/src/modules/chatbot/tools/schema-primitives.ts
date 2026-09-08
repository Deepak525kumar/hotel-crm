import { z } from 'zod';

/**
 * Tool-argument primitives.
 *
 * The date validators live in `lib/zod-primitives.ts` and are re-exported
 * here rather than redefined: the same rule is needed by the reports module's
 * HTTP schemas, and a copy in each place is how one rule becomes three. The
 * chatbot-specific shapes below stay here because nothing outside the tool
 * registry has an opinion about them.
 */
export { isoDate, plausibleDate } from '../../../lib/zod-primitives.js';

/** A room number: short, and never an id in disguise. */
export const roomNumber = z.string().trim().min(1).max(20);

/** A person's name as they are known at the hotel, never an identifier. */
export const personName = z.string().trim().min(2).max(80);
