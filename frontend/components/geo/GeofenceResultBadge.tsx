"use client";

// "use client" added with i18n extraction (2026-08-16): this component now
// calls the useTranslation hook. It was already rendered exclusively from
// client components and has no server-only dependency, so the directive
// makes explicit what was already true rather than moving a boundary.
import { Badge } from "@/components/ui";
import { useTranslation } from "react-i18next";

/**
 * Pass/fail result of a geofence distance check (SPEC-GEO-001, GD-14).
 * `inside_radius` is the only pass/fail signal the backend ever returns —
 * never a raw distance threshold or coordinates (RULE-GEO-003/OD-GEO-005).
 */
export function GeofenceResultBadge({ insideRadius }: { insideRadius: boolean }) {
  const { t } = useTranslation();
  return insideRadius ? (
    <Badge tone="success">{t("assignments.insideGeofence")}</Badge>
  ) : (
    <Badge tone="danger">{t("assignments.outsideGeofence")}</Badge>
  );
}
