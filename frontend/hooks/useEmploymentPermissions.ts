import { useAuthStore } from "@/stores/auth";

/**
 * Named employment-lifecycle capabilities for the current viewer, so UI
 * code never hardcodes a role string (`role === "admin"`) inline.
 *
 * Mirrors employee-management/routes.ts's actual route gates (ADR-030 §3
 * C-16 amendment, 2026-08-06):
 *  - create/delete/restore: Admin only.
 *  - submit-for-review/approve/reject/deactivate/reactivate/rehire: Admin,
 *    or a scoped manager/regional_manager (their own hotel group).
 *
 * This hook expresses the ROLE half only — the same boundary
 * `WorkerOnboardingGate`'s own note documents: `AuthUser` carries no
 * `hotel_group_id`/scope claim client-side, so a manager/RM capability here
 * means "may attempt, pending the backend's own group-scope check," not
 * "definitely may act on this specific record." Do not read a `true` here
 * as a full authorization decision for a specific employee.
 */
export function useEmploymentPermissions() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "admin";
  const isScopedManager = role === "manager" || role === "regional_manager";

  return {
    canCreateEmployment: isAdmin,
    canDeleteEmployment: isAdmin,
    canRestoreEmployment: isAdmin,
    canSubmitForReview: isAdmin || isScopedManager,
    canApproveEmployment: isAdmin || isScopedManager,
    canRejectEmployment: isAdmin || isScopedManager,
    canDeactivateEmployment: isAdmin || isScopedManager,
    canReactivateEmployment: isAdmin || isScopedManager,
    canRehireEmployment: isAdmin || isScopedManager,
  };
}
