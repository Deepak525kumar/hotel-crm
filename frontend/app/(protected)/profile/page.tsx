"use client";

import { useAuth, useMe } from "@/hooks/useAuth";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import { RoleBadge } from "@/components/users/RoleBadge";
import { AbsencesCard } from "@/components/calendar/AbsencesCard";
import { PayslipRequestsCard } from "@/components/hr/PayslipRequestsCard";

import { ConsentCard } from "@/components/consent/ConsentCard";
import { ExportMyDataCard } from "@/components/compliance/ExportMyDataCard";
import { EditProfileCard } from "@/components/profile/EditProfileCard";
import { formatDateTime } from "@/lib/format";
import { EMPLOYMENT_STATUS_TONE, EMPLOYMENT_STATUS_LABEL } from "@/lib/employmentStatus";
import { SKILL_LABEL } from "@/lib/skills";
import {
  ActiveBadge,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  PageHeader,
  Skeleton,
} from "@/components/ui";

export default function ProfilePage() {
  const { user } = useAuth();
  // Revalidate /auth/me so the view reflects any server-side changes.
  const { isLoading } = useMe();
  // Skills live on EmploymentRecord, not on AuthUser — /auth/me's payload has
  // no skills field, so they're not otherwise reachable from this page.
  // getByUserId() is self-scoped for a worker caller (assertVisibility(),
  // employee-management/service.ts), same access a worker already has to
  // their own record elsewhere (WorkerOnboardingCard, for a manager viewing
  // them) — this is the first place a worker can read it about themselves.
  const { data: employmentRecord } = useEmploymentRecord(
    user?.role === "worker" ? user.id : null,
  );

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Profile" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {user.first_name} {user.last_name}
            {/* 2026-08-13 fix (reported live: this page showed a green
                "Active" badge for a Manager still mid-onboarding, PENDING).
                `is_active` is the account/sign-in flag and is true from the
                moment the account exists -- it says nothing about
                onboarding. Same fix already applied to the admin-facing
                /users/:id page (see that page's identical note); this one,
                which every signed-in person's OWN "My Profile" uses, was
                missed. Falls back to the account flag only when no
                EmploymentRecord exists at all (an admin, or a pre-ADR-065
                account). */}
            {user.employment_status ? (
              <Badge tone={EMPLOYMENT_STATUS_TONE[user.employment_status]}>
                {EMPLOYMENT_STATUS_LABEL[user.employment_status]}
              </Badge>
            ) : (
              <ActiveBadge active={user.is_active} />
            )}
          </span>
        }
        description={user.email}
      />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Email" value={user.email} />
            <DataRow label="Phone" value={user.phone || "—"} />
            <DataRow label="Role" value={<RoleBadge role={user.role} />} />
            {/* Read-only: a worker views their own skills here but does not
                edit them -- setting them is a manager/RM/admin decision
                (employee-management/service.ts's updateEmployee is gated
                requireRole(['admin','manager','regional_manager']), not
                self-service), the same asymmetry submit-for-review has in
                the other direction. Edited from WorkerOnboardingCard on the
                admin-facing /users/:id page instead. */}
            {user.role === "worker" && (
              <DataRow
                label="Skills"
                value={
                  employmentRecord?.skills && employmentRecord.skills.length > 0
                    ? employmentRecord.skills.map((s) => SKILL_LABEL[s] ?? s).join(", ")
                    : "None set"
                }
              />
            )}
            <DataRow label="Member since" value={formatDateTime(user.created_at)} />
          </DataList>
        </CardContent>
      </Card>

      <EditProfileCard user={user} />





      {user.role === "worker" && (
        <>
          <AbsencesCard />
          <PayslipRequestsCard workerId={user.id} />
        </>
      )}

      <ConsentCard />

      <ExportMyDataCard />

      {isLoading && (
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">Refreshing…</p>
      )}
    </div>
  );
}
