import { useAuthStore } from "@/stores/auth";

/**
 * Named employment-lifecycle capabilities for the current viewer, so UI
 * code never hardcodes a role string (`role === "admin"`) inline.
 *
 * Mirrors employee-management's actual enforcement:
 *  - EmploymentRecord CREATION is no longer a user-facing action at all
 *    (ADR-065, Universal Onboarding Gate) — the record is auto-created the
 *    moment an account exists (users/service.ts#createUser), so there is no
 *    `canCreateEmployment` flag here; delete/restore remain Admin only.
 *  - submit-for-review: SELF-SERVICE ONLY (RULE B) — the applicant and nobody
 *    else, admin included. Requires `subjectUserId`.
 *  - approve/reject/deactivate/reactivate/rehire: Admin, or a scoped
 *    manager/regional_manager (their own hotel group). NOT self-service.
 *
 * This hook expresses the ROLE half only — the same boundary
 * `WorkerOnboardingGate`'s own note documents: `AuthUser` carries no
 * `hotel_group_id`/scope claim client-side, so a manager/RM capability here
 * means "may attempt, pending the backend's own group-scope check," not
 * "definitely may act on this specific record." Do not read a `true` here
 * as a full authorization decision for a specific employee.
 */
export function useEmploymentPermissions(opts: { subjectUserId?: string } = {}) {
  const role = useAuthStore((s) => s.user?.role);
  const viewerId = useAuthStore((s) => s.user?.id);
  const isAdmin = role === "admin";
  const isScopedManager = role === "manager" || role === "regional_manager";

  // RULE B (project-owner decision, 2026-08-12): "nobody may perform another
  // user's onboarding." submit-for-review is SELF-SERVICE ONLY, for every role
  // including admin. So this capability is no longer role-derived at all — it
  // is an identity comparison.
  //
  // `subjectUserId` is the user whose record is being acted on. When it is not
  // supplied the answer is `false`, NOT "assume self": a caller that forgot to
  // pass it must lose the button rather than silently get an admin-style
  // always-true, which is the failure mode RULE B exists to prevent. Callers
  // rendering a self-service page pass the viewer's own id explicitly.
  //
  // Document upload is governed the same way, but has no capability flag here:
  // the upload UI takes a `workerId` and is only ever rendered with the
  // viewer's own id (app/(protected)/onboarding/page.tsx), with the
  // review-queue view passing `disabled`.
  const canSubmitForReview =
    !!viewerId && !!opts.subjectUserId && viewerId === opts.subjectUserId;

  return {
    canDeleteEmployment: isAdmin,
    canRestoreEmployment: isAdmin,
    canSubmitForReview,
    // Unchanged and deliberately NOT self-service: a review decision belongs to
    // the hierarchy above the applicant (a Manager's application is approved by
    // an RM or Admin). RULE B covers upload and submit only — do not narrow
    // these to self, and do not narrow them to 1-level-down either (that is
    // RULE A, which governs CREATE only).
    canApproveEmployment: isAdmin || isScopedManager,
    canRejectEmployment: isAdmin || isScopedManager,
    canDeactivateEmployment: isAdmin || isScopedManager,
    canReactivateEmployment: isAdmin || isScopedManager,
    canRehireEmployment: isAdmin || isScopedManager,
  };
}
