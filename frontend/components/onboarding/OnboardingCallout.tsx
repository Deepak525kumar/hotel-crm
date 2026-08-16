"use client";

import Link from "next/link";
import { AlertCircle, ClipboardList, Clock } from "lucide-react";
import { Badge, Card, CardContent } from "@/components/ui";
import { useMyOnboarding } from "@/hooks/useMyOnboarding";
import { useTranslation } from "react-i18next";

/**
 * Dashboard call-to-action pointing an applicant at their own `/onboarding`
 * page (owner decision, 2026-08-12: onboarding must be discoverable from BOTH
 * the sidebar and a prominent dashboard banner — typing the URL was previously
 * the only way to find it).
 *
 * Renders nothing unless the signed-in user's own onboarding still needs
 * attention, which means:
 *   - ACTIVE            -> nothing (the owner's "don't nag an active employee")
 *   - no record / admin  -> nothing
 *   - DEACTIVATED/DELETED-> nothing (not a state the user can act on here)
 *
 * Status copy and tone come from `useMyOnboarding`, the same source
 * `/onboarding` itself and the sidebar entry use — deliberately NOT a second
 * status vocabulary maintained in parallel.
 *
 * Works for every applicant role including an unassigned Manager/RM: the hook
 * keys on the user's own id and never on a hotel/group scope claim, which a
 * pre-assignment Manager/RM does not have.
 */
export function OnboardingCallout() {
  const { t } = useTranslation();
  const { phase, label, description, tone, needsAttention, isSubmitted } = useMyOnboarding();

  if (!needsAttention) return null;

  const Icon = phase === "rejected" ? AlertCircle : isSubmitted ? Clock : ClipboardList;

  // Rejected is the one state that should read as a problem rather than a task.
  const accent =
    phase === "rejected"
      ? "border-red-300 dark:border-red-900"
      : phase === "review"
        ? "border-blue-300 dark:border-blue-900"
        : "border-amber-300 dark:border-amber-900";

  return (
    <Card className={`border ${accent}`}>
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("onboarding.completeOnboardingAction")}
              </span>
              <Badge tone={tone}>{label}</Badge>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
          </div>
        </div>
        {/* A plain Link styled as a button rather than <Button asChild>: this
            repo's Button renders a real <button> and has no polymorphic `as`
            prop, and wrapping a Button in a Link nests interactive elements. */}
        <Link
          href="/onboarding"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {isSubmitted ? "View my onboarding" : "Continue onboarding"}
        </Link>
      </CardContent>
    </Card>
  );
}
