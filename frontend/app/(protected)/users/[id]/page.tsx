"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useUser } from "@/hooks/useUsers";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, usersApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { RoleBadge } from "@/components/users/RoleBadge";
import { formatDateTime } from "@/lib/format";
import {
  ActiveBadge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  Modal,
  PageHeader,
  Skeleton,
} from "@/components/ui";

function UserDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user: currentUser } = useAuth();

  const { data: user, isLoading, error } = useUser(id);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const isSelf = currentUser?.id === id;

  const deactivate = async () => {
    setActionError(null);
    setDeactivating(true);
    try {
      await usersApi.remove(id);
      await Promise.all([
        globalMutate(["user", id]),
        globalMutate((key) => Array.isArray(key) && key[0] === "users"),
      ]);
      setConfirmOpen(false);
      router.push("/users");
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setDeactivating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/users" className="text-sm text-blue-700 hover:underline">
        ← Back to users
      </Link>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Failed to load this user. They may have been removed.
          </CardContent>
        </Card>
      ) : isLoading || !user ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex items-center gap-3">
                {user.first_name} {user.last_name}
                <ActiveBadge active={user.is_active} />
              </span>
            }
            description={user.email}
            actions={
              <Link href={`/users/${id}/edit`}>
                <Button variant="outline">Edit</Button>
              </Link>
            }
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
                <DataRow label="Created" value={formatDateTime(user.created_at)} />
                <DataRow label="Updated" value={formatDateTime(user.updated_at)} />
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

          {user.is_active && (
            <Card className="border-red-100">
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Deactivate account
                  </p>
                  <p className="text-sm text-gray-500">
                    {isSelf
                      ? "You cannot deactivate your own account."
                      : "Revokes sign-in access. The account can be reactivated later."}
                  </p>
                </div>
                <Button
                  variant="danger"
                  disabled={isSelf}
                  onClick={() => setConfirmOpen(true)}
                >
                  Deactivate
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !deactivating && setConfirmOpen(false)}
        title="Deactivate account"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deactivating}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={deactivate} loading={deactivating}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          This revokes access for{" "}
          <span className="font-medium">
            {user?.first_name} {user?.last_name}
          </span>
          . You can reactivate the account from the edit screen.
        </p>
        {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
      </Modal>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500">
            Only admins can view user accounts.
          </CardContent>
        </Card>
      }
    >
      <UserDetail />
    </RoleGate>
  );
}
