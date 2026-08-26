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

/**
 * `null` on a `JobRequestSkillSlot` means "no specific skill required" — the
 * slot is open to every roster-eligible, free worker regardless of which (if
 * any) skills they hold (2026-08-26). Distinct from `SKILL_OPTIONS`
 * deliberately: that list enumerates a WORKER's actual assignable skill
 * tags (WorkerOnboardingCard's edit modal, UserForm) and must never gain a
 * "None" entry there — a worker cannot have "no skill" as one of their own
 * skills. This key exists only for a broadcast SKILL SLOT, where "no skill
 * required" is a real, selectable option.
 */
export const NO_SKILL_LABEL_KEY = "requests.anySkill";

/** Renders a skill-slot's `skill` for display, including the `null` ("no specific skill required") case. `t` is react-i18next's translate function. */
export function skillSlotLabel(t: (key: string) => string, skill: SkillTag | null): string {
  if (skill === null) return t(NO_SKILL_LABEL_KEY);
  return t(SKILL_LABEL_KEY[skill]) || skill;
}
