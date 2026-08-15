import type { SkillTag } from "@/lib/types";

/**
 * Shared display metadata for `SkillTag` (backend `prisma/schema.prisma`'s
 * fixed 4-value enum). Previously inlined only inside
 * `WorkerOnboardingCard.tsx`'s edit modal — a single source now, same
 * reasoning as `lib/employmentStatus.ts`, so a worker's own read-only view
 * and a manager's edit view can't drift out of sync on the label text.
 */
export const SKILL_OPTIONS: { value: SkillTag; label: string }[] = [
  { value: "CLEANER", label: "Cleaner" },
  { value: "PUBLIC_SERVICE", label: "Public Service" },
  { value: "KITCHEN_DISHWASHER", label: "Kitchen / Dishwasher" },
  { value: "WAITER", label: "Waiter" },
];

export const SKILL_LABEL: Record<SkillTag, string> = SKILL_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
  {} as Record<SkillTag, string>,
);
