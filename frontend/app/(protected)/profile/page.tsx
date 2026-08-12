"use client";

import { useAuth, useMe } from "@/hooks/useAuth";
import { RoleBadge } from "@/components/users/RoleBadge";
import { AbsencesCard } from "@/components/calendar/AbsencesCard";
import { MyStatsCard } from "@/components/analytics/MyStatsCard";
import { ConsentCard } from "@/components/consent/ConsentCard";
import { ExportMyDataCard } from "@/components/compliance/ExportMyDataCard";
import { EditProfileCard } from "@/components/profile/EditProfileCard";
import { formatDateTime } from "@/lib/format";
import {
  ActiveBadge,
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
            <ActiveBadge active={user.is_active} />
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
            <DataRow label="Member since" value={formatDateTime(user.created_at)} />
          </DataList>
        </CardContent>
      </Card>

      <EditProfileCard user={user} />




      {user.role === "worker" && <MyStatsCard />}

      {user.role === "worker" && <AbsencesCard />}

      <ConsentCard />

      <ExportMyDataCard />

      {isLoading && (
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">Refreshing…</p>
      )}
    </div>
  );
}
