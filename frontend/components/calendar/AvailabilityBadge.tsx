"use client";

// "use client" added with i18n extraction (2026-08-16): this component now
// calls the useTranslation hook. It was already rendered exclusively from
// client components and has no server-only dependency, so the directive
// makes explicit what was already true rather than moving a boundary.
import { Badge } from "@/components/ui";
import { useTranslation } from "react-i18next";

/**
 * Today-only red/green availability signal (SPEC-CALENDAR-001 REQ-CAL-T06,
 * RULE-CAL-08). Never implies anything about any other day — the backend
 * itself has no `day` concept for this read.
 */
export function AvailabilityBadge({ available }: { available: boolean }) {
  const { t } = useTranslation();
  return available ? (
    <Badge tone="success">{t("calendar.freeToday")}</Badge>
  ) : (
    <Badge tone="warning">{t("calendar.assignedOrOnLeave")}</Badge>
  );
}
