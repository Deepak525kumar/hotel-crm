/** The four skills a broadcast line may ask for. Mirrors Prisma's SkillTag. */
export const SKILL_TAGS = ['CLEANER', 'PUBLIC_SERVICE', 'KITCHEN_DISHWASHER', 'WAITER'] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

/** A skill × headcount line on a broadcast. `null` skill = no skill required. */
export type SkillLine = { id: string; skill: SkillTag | null; headcount: string };

/**
 * `HH:MM`, 24-hour, as the backend's own regex demands.
 *
 * Validated here so a manager is told the shape before the round trip rather
 * than reading a 422. `9:00` and `24:00` are the two that look right and are
 * not — a leading zero is required and midnight is `00:00`.
 */
export function isTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** A positive whole number, which is what every headcount field must be. */
export function isPositiveInt(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value.trim()) > 0;
}

/**
 * Whether the skill lines can be sent.
 *
 * At least one line, every headcount positive, and **no duplicate skill** —
 * two CLEANER lines are not a richer request, they are two answers to the
 * same question, and the server would store both. Caught here because the
 * schema does not forbid it.
 */
export function skillLinesValid(lines: readonly SkillLine[]): boolean {
  if (lines.length === 0) return false;
  if (!lines.every((l) => isPositiveInt(l.headcount))) return false;
  const keys = lines.map((l) => l.skill ?? '__none__');
  return new Set(keys).size === keys.length;
}

/** Total headcount across the lines, for the sticky footer. */
export function totalHeadcount(lines: readonly SkillLine[]): number {
  return lines.reduce((sum, l) => sum + (isPositiveInt(l.headcount) ? Number(l.headcount) : 0), 0);
}
