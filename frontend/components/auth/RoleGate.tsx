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
