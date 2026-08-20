"use client";

import { useTranslation } from "react-i18next";
import type { RatingTier } from "@/lib/types";

/**
 * TREQ-003 / TRULE-003: the tier label shown alongside a worker's 0-100 score.
 *
 * The colour ramp deliberately follows the same boundaries the system already
 * acts on (70 = PASSED and the first warning, 50 = the severe warning, 40 =
 * FAILED), so the badge cannot look reassuring to a worker who is being sent
 * rework -- see backend/src/modules/quality/rating-tiers.ts.
 *
 * `null` renders nothing rather than a grey "unrated" chip: an unrated worker
 * is a new starter, and a badge in the standing column invites reading it as a
 * standing.
 */
const TIER_CLASSES: Record<RatingTier, string> = {
  ELITE:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  HIGH: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  STANDARD: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  LOW: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  PROBATION: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export function RatingTierBadge({ tier }: { tier: RatingTier | null }) {
  const { t } = useTranslation();
  if (!tier) return null;

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TIER_CLASSES[tier]}`}
    >
      {t(`ratingTier.${tier}`)}
    </span>
  );
}
