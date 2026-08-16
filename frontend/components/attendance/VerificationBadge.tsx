"use client";

// "use client" added with i18n extraction (2026-08-16): this component now
// calls the useTranslation hook. It was already rendered exclusively from
// client components and has no server-only dependency, so the directive
// makes explicit what was already true rather than moving a boundary.
import { Badge } from "@/components/ui";
import { useTranslation } from "react-i18next";

/** Shows whether an attendance record has been verified by a manager/checker. */
export function VerificationBadge({ verified }: { verified: boolean }) {
  const { t } = useTranslation();
  return verified ? (
    <Badge tone="success">{t("status.verified")}</Badge>
  ) : (
    <Badge tone="neutral">{t("status.unverified")}</Badge>
  );
}
