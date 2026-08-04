"use client";

import type { ReactNode } from "react";
import { useAuthStore } from "@/stores/auth";
import type { Role } from "@/lib/types";

export interface RoleGateProps {
  /** Roles permitted to see the children. */
  allow: Role[];
  /** Rendered when the current user's role is not permitted. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Conditionally renders children based on the current user's role.
 * Note: this is a UX affordance only — the backend remains the
 * authoritative enforcement point for every protected operation.
 */
export function RoleGate({ allow, fallback = null, children }: RoleGateProps) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role || !allow.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
}

/**
 * ADR-030 PR-6: capability-named gates replace the old generic
 * `ManagerAdminGate`, which conflated two capabilities with different
 * owners — hotel create/edit is MASTER data (Admin-only, D-2/D-3) while
 * work-request/analytics actions are OPS data (scoped-role capable, D-2).
 * Collapsing them into one gate meant widening one always widened the
 * other; splitting by capability is what let PR-5's backend narrowing
 * (hotel writes → Admin-only) and this frontend gating agree with each
 * other instead of drifting apart.
 */

/** C-01/C-02 (hotel create/edit) — MASTER data, Admin-only per D-2/D-3. */
export function HotelWriteGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * C-23/C-24/C-31 (work requests, assignments, analytics) — OPS data,
 * scoped-role capable per D-2. `regional_manager` included per D-5: RM
 * holds Manager's full operational capability set at group scope.
 */
export function StaffingWriteGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["manager", "regional_manager", "admin"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * User account deactivation (`DELETE /users/:id`) — Admin-only backend-side
 * (users/routes.ts:39, `requireRole('admin')`), narrower than the worker
 * detail page's own view gate (which now also admits Manager for the
 * Documents section, GD-16). Split out so widening view access doesn't
 * silently also expose an action the backend would 403.
 */
export function UserDeactivateGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16): worker document upload/view.
 * GD-16's actor model is self-upload (worker) + manager-upload only. Unlike
 * `regional_manager` INCLUDED per an explicit project-owner decision
 * (2026-08-04, Regional Manager V1 scoping) that reverses `OD-DOC-007`/`GD-16`
 * ("broader Regional-Manager access explicitly not adopted") in favour of
 * ADR-030 D-5 / PDD §5.4. The backend now admits it at every layer:
 * `documents/routes.ts`'s five role gates, and `resolveWorkerScope()`
 * (middleware/permissions.ts) special-cases `regional_manager` alongside
 * `manager` via `isScopedManagerRole()`. See documents/routes.ts's governance
 * note; `OD-DOC-007` still needs a superseding Decision Record (tracked for
 * the documentation-synchronization PR) — this comment is the authority trail
 * until that record exists, not a substitute for it.
 */
export function DocumentsGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin", "manager", "regional_manager"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * SPEC-HR-001 (REVIEW @0.2.9): payslip-request list/fulfil view. Matches
 * `hr/routes.ts`'s own role split — `/hr/payroll` and
 * `/hr/payroll/:request_id/fulfil` now both include `regional_manager`
 * (ADR-030 §3 C-29/C-30), with `resolveWorkerScope()` (middleware/
 * permissions.ts) special-casing it alongside `manager` via
 * `isScopedManagerRole()`. `GeoCheckinsGate` below remains admin/manager-only
 * by contrast — SPEC-GEO-001/GD-14 named only those two roles, unlike HR.
 */
export function HrPayrollGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin", "manager", "regional_manager"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * SPEC-GEO-001 @0.1.2 FROZEN (GD-14): geo check-ins list/detail view.
 * `regional_manager` INCLUDED per Regional Manager V1 Decision 3 (grant at
 * group scope): `geo/service.ts` now special-cases it alongside `manager` via
 * `isScopedManagerRole()`/`isSelfScopedRole()` — previously an RM was
 * silently misclassified as a worker there (self-scoped to its own
 * check-ins, a 200 with the wrong data, not a 403). There is no route-level
 * gate in `geo/routes.ts`; authorization is entirely service-layer.
 */
export function GeoCheckinsGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin", "manager", "regional_manager"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * SPEC-EMP-001 (REQ-EMP-005/RULE-EMP-07): blocklisting an employee at a
 * hotel. Matches `employee-management/routes.ts`'s POST blocklist route,
 * which now includes `regional_manager` (ADR-030 §3 C-22 — `employees:write`
 * grants RM `✓ᶜ`, and `checkHotelAccess()` is already group-aware for it).
 * Reading the blocklist is far broader (`employees:read`, held by every role)
 * and is intentionally NOT gated — only the write action needs this.
 */
export function BlocklistWriteGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin", "manager", "regional_manager"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * Job Dispatch Phase 2 broadcast raise/close (Epic 9 PRs 9.7/9.10,
 * `FEATURE_JOBDISPATCH_PHASE2`). Matches `job-requests/routes.ts`'s
 * `POST /work-requests/broadcasts` and `POST /work-requests/broadcasts/:id/close`
 * RBAC, which now includes `regional_manager` (ADR-030 §3 C-23 —
 * `staffing:write`), consistent with `StaffingWriteGate` below and the
 * calendar-entries route this module also owns.
 */
export function JobDispatchPhase2WriteGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin", "manager", "regional_manager"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * Worker onboarding (create EmploymentRecord + drive its lifecycle signal to
 * Active). Matches `employee-management/routes.ts`'s create/lifecycle-signal
 * routes exactly (`requireRole('admin')`) — narrower than `DocumentsGate`/
 * `HrPayrollGate`: `manager` is deliberately EXCLUDED here, unlike those
 * gates, because this module's write routes never admit it (OD-EMP-08
 * restricts creation/bulk-import/lifecycle-signal to Admin only). The
 * read-side lookup (`getByUserId`) uses the broader `employees:read`
 * permission, but this gate stays Admin-only since every *action* the card
 * behind it exposes (create, submit-for-review, approve, reject) is
 * Admin-only at the route.
 */
export function WorkerOnboardingGate({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={["admin"]} fallback={fallback}>
      {children}
    </RoleGate>
  );
}
