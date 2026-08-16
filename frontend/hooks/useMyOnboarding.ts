"use client";

import { useTranslation } from "react-i18next";

import { useAuth } from "@/hooks/useAuth";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import type { EmploymentRecord } from "@/lib/types";

/**
 * The SINGLE source of truth for "where is the signed-in user in their own
 * onboarding, and what should we call that state" (ADR-065 §6 items 7-9;
 * owner decision 2026-08-12 to surface onboarding in the sidebar and on the
 * dashboard).
 *
 * Why this hook exists rather than each surface deriving its own booleans:
 * `/onboarding` already derived `isSubmitted`/`isRejected`/`isActive` inline,
 * and the owner requirement for the new nav + dashboard entry points is
 * explicitly that they "reuse that logic/source of truth rather than
 * duplicating a second status vocabulary." Three surfaces computing
 * `!!record.submitted_for_review_at` independently is exactly how the copy on
 * one drifts from the badge on another — the same drift
 * `lib/employmentStatus.ts` was created to stop for `EmploymentStatus` display
 * metadata (which this hook composes with rather than replaces).
 *
 * SCOPE NOTE (the bug class this must not reintroduce): a Manager or
 * Regional Manager applicant has NO hotel/hotel_group scope before assignment
 * — `hotel_group_id` and `primary_hotel_id` are written only on activation.
 * Two separate visibility guards in this codebase have broken by assuming a
 * scope exists for a manager-grade role. This hook therefore keys ONLY on the
 * user's own id and the record's own fields, and never consults
 * `scope_hotel_id`/`scope_hotel_group_id`. The backend read it depends on
 * (`GET /employees/by-user/:user_id`) is correspondingly self-first: its
 * `assertVisibility` returns early on `record.user_id === actor.userId`
 * BEFORE the group-scope branch, precisely so an unassigned Manager/RM
 * applicant can load their own record. Do not add a scope condition here.
 */

/** The distinct states the onboarding entry points render. */
export type OnboardingPhase =
  /** Still resolving — render nothing rather than a wrong state. */
  | "loading"
  /** No EmploymentRecord exists for this user (e.g. admin, or not yet created). */
  | "none"
  /** PENDING, not yet submitted — the applicant still has work to do. */
  | "documents"
  /** PENDING and submitted — waiting on the approver. */
  | "review"
  /** REJECTED — needs attention. */
  | "rejected"
  /** ACTIVE — onboarding complete. */
  | "active"
  /** DEACTIVATED/DELETED — not an onboarding state to nag about. */
  | "inactive";

export interface MyOnboarding {
  phase: OnboardingPhase;
  record: EmploymentRecord | null | undefined;
  /** Short label for a badge/nav pill. */
  label: string;
  /** One-sentence explanation of what this state means for the user. */
  description: string;
  /** Badge tone matching this repo's `Badge` `tone` vocabulary. */
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  /**
   * Whether onboarding still needs the user's attention. Drives whether the
   * dashboard call-to-action and the sidebar's status pill appear at all.
   * False once ACTIVE, so an active employee is never nagged (owner
   * requirement), and false for `none`/`inactive` — neither is a state the
   * user can act on from the onboarding page.
   */
  needsAttention: boolean;
  /** True once submitted for review; the CTA hides itself past this point. */
  isSubmitted: boolean;
  isActive: boolean;
  isRejected: boolean;
}

/**
 * Per-phase display metadata.
 *
 * `label`/`description` are i18n KEYS, not copy. They are resolved through
 * `t()` in the hook body so that all three surfaces reading this vocabulary
 * (the sidebar status pill, the dashboard callout, and `/onboarding`) render
 * in the user's own language from one definition. Holding literal English
 * here is what previously leaked "Pending Documents" into every locale.
 *
 * `tone` stays a literal: it is a `Badge` tone token, not user-visible text.
 */
const PHASE_COPY: Record<
  Exclude<OnboardingPhase, "loading" | "none">,
  { labelKey: string; descriptionKey: string; tone: MyOnboarding["tone"] }
> = {
  documents: {
    labelKey: "onboarding.phase.documents.label",
    descriptionKey: "onboarding.phase.documents.description",
    tone: "warning",
  },
  review: {
    labelKey: "onboarding.phase.review.label",
    descriptionKey: "onboarding.phase.review.description",
    tone: "info",
  },
  rejected: {
    labelKey: "onboarding.phase.rejected.label",
    descriptionKey: "onboarding.phase.rejected.description",
    tone: "danger",
  },
  active: {
    labelKey: "onboarding.phase.active.label",
    descriptionKey: "onboarding.phase.active.description",
    tone: "success",
  },
  inactive: {
    labelKey: "onboarding.phase.inactive.label",
    descriptionKey: "onboarding.phase.inactive.description",
    tone: "neutral",
  },
};

/**
 * Resolves the signed-in user's own onboarding phase.
 *
 * Returns `phase: "none"` (not an error) when the user has no EmploymentRecord
 * — the expected state for an Admin, and for a user whose record hasn't been
 * created yet. The underlying endpoint returns `null` rather than 404 for
 * exactly this reason, so "no record" and "failed to load" stay
 * distinguishable: a genuine failure also lands on `"none"` here, which is the
 * safe direction (surface no onboarding prompt rather than a false one).
 */
export function useMyOnboarding(): MyOnboarding {
  const { user } = useAuth();
  const { data: record, isLoading } = useEmploymentRecord(user?.id);
  // Called before the early returns below: hooks must run unconditionally.
  const { t } = useTranslation();

  const base = { record, isSubmitted: false, isActive: false, isRejected: false };

  if (!user || isLoading) {
    return {
      ...base,
      phase: "loading",
      label: "",
      description: "",
      tone: "neutral",
      needsAttention: false,
    };
  }

  if (!record) {
    return {
      ...base,
      phase: "none",
      label: "",
      description: "",
      tone: "neutral",
      needsAttention: false,
    };
  }

  const isSubmitted = !!record.submitted_for_review_at;
  const isActive = record.status === "ACTIVE";
  const isRejected = record.status === "REJECTED";

  const phase: Exclude<OnboardingPhase, "loading" | "none"> = isActive
    ? "active"
    : isRejected
      ? "rejected"
      : record.status === "PENDING"
        ? isSubmitted
          ? "review"
          : "documents"
        : "inactive";

  const copy = PHASE_COPY[phase];

  return {
    record,
    phase,
    label: t(copy.labelKey),
    description: t(copy.descriptionKey),
    tone: copy.tone,
    // Only the two PENDING sub-states and REJECTED are actionable by the user.
    needsAttention: phase === "documents" || phase === "review" || phase === "rejected",
    isSubmitted,
    isActive,
    isRejected,
  };
}
