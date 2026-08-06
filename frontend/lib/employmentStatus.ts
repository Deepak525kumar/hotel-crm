import type { EmploymentStatus } from "@/lib/types";

/**
 * Shared display metadata for `EmploymentStatus` (REQ-EMP-002 rework,
 * 2026-08-06). Previously copy-pasted verbatim between
 * `WorkerOnboardingCard.tsx` and `org-chart/page.tsx` — a single source now,
 * so the two surfaces can't drift out of sync the way they did before.
 */
export const EMPLOYMENT_STATUS_TONE: Record<
  EmploymentStatus,
  "warning" | "success" | "neutral" | "danger"
> = {
  PENDING: "warning",
  ACTIVE: "success",
  DEACTIVATED: "neutral",
  REJECTED: "danger",
  DELETED: "danger",
};

export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
  REJECTED: "Rejected",
  DELETED: "Deleted",
};
