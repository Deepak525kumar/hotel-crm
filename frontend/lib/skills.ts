import type { SkillTag } from "@/lib/types";

/**
 * Shared display metadata for `SkillTag` (backend `prisma/schema.prisma`'s
 * fixed 4-value enum). Previously inlined only inside
 * `WorkerOnboardingCard.tsx`'s edit modal — a single source now, same
 * reasoning as `lib/employmentStatus.ts`, so a worker's own read-only view
 * and a manager's edit view can't drift out of sync on the label text.
 *
 * These are i18n KEYS, not copy. Holding literal English here is what kept
 * the already-authored `skills.*` catalogue entries unused while every
 * surface rendered "Kitchen / Dishwasher" in all six locales. Resolve with
 * `t(SKILL_LABEL_KEY[tag])` at the point of render.
 *
 * The drift this module exists to prevent had already started: three call
 * sites carried their own copies, disagreeing on both "Public Service" vs
 * "Public service" and "Kitchen / Dishwasher" vs "Kitchen dishwasher". All
 * of them now read from here.
 */
export const SKILL_OPTIONS: { value: SkillTag; labelKey: string }[] = [
  { value: "CLEANER", labelKey: "skills.CLEANER" },
  { value: "PUBLIC_SERVICE", labelKey: "skills.PUBLIC_SERVICE" },
  { value: "KITCHEN_DISHWASHER", labelKey: "skills.KITCHEN_DISHWASHER" },
  { value: "WAITER", labelKey: "skills.WAITER" },
];

export const SKILL_LABEL_KEY: Record<SkillTag, string> = SKILL_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.labelKey }),
  {} as Record<SkillTag, string>,
);
