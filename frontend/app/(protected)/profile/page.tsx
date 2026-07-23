"use client";

import { useAuth, useMe } from "@/hooks/useAuth";
import { RoleBadge } from "@/components/users/RoleBadge";
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

      {user.permissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {user.permissions.map((p) => (
                <li
                  key={p}
                  className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700"
                >
                  {p}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <p className="text-center text-xs text-gray-500">Refreshing…</p>
      )}
    </div>
  );
}
