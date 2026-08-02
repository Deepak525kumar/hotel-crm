"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useUser } from "@/hooks/useUsers";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAvailability } from "@/hooks/useCalendar";
import { usersApi } from "@/lib/api";
import { DocumentsGate, HrPayrollGate, RoleGate, UserDeactivateGate } from "@/components/auth/RoleGate";
import { RoleBadge } from "@/components/users/RoleBadge";
import { DocumentsCard } from "@/components/documents/DocumentsCard";
import { PayslipRequestsCard } from "@/components/hr/PayslipRequestsCard";
import { ContractCard } from "@/components/hr/ContractCard";
import { AvailabilityBadge } from "@/components/calendar/AvailabilityBadge";
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
  FormError,
  Modal,
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";

function UserDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user: currentUser } = useAuth();

  const { data: user, isLoading, error } = useUser(id);
  // Availability (SPEC-CALENDAR-001 REQ-CAL-T06) is a worker-only concept —
  // only fetched once the account's role is known to be "worker", so an
  // admin/manager/checker account never shows a meaningless badge for a
  // read-model that doesn't apply to them.
  const { data: availability } = useAvailability(user?.role === "worker" ? id : null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const deactivate = useAsyncAction();

  const isSelf = currentUser?.id === id;

  const onDeactivate = () =>
    deactivate.run(
      async () => {
        await usersApi.remove(id);
        await Promise.all([
          globalMutate(["user", id]),
          globalMutate((key) => Array.isArray(key) && key[0] === "users"),
        ]);
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          router.push("/users");
        },
      },
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <TextLink href="/users" className="text-sm">
        ← Back to users
      </TextLink>

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
              // The edit page itself remains admin-only (frontend-side,
              // out of scope for this change) — hidden here for other
              // roles so widening this page's own view gate doesn't leave
              // a dead-end link to a page that will only show a fallback.
              <RoleGate allow={["admin"]}>
                <Link href={`/users/${id}/edit`}>
                  <Button variant="outline">Edit</Button>
                </Link>
              </RoleGate>
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
                {user.role === "worker" && availability && (
                  <DataRow
                    label="Availability"
                    value={<AvailabilityBadge available={availability.available} />}
                  />
                )}
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

          <DocumentsGate>
            <DocumentsCard workerId={id} />
          </DocumentsGate>

          {user.role === "worker" && (
            <HrPayrollGate>
              <ContractCard workerId={id} />
              <PayslipRequestsCard workerId={id} />
            </HrPayrollGate>
          )}

          <UserDeactivateGate>
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
          </UserDeactivateGate>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !deactivate.pending && setConfirmOpen(false)}
        title="Deactivate account"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deactivate.pending}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={onDeactivate} loading={deactivate.pending}>
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
        <FormError className="mt-3">{deactivate.error}</FormError>
      </Modal>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <RoleGate
      allow={["admin", "manager"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500">
            Only admins and managers can view user accounts.
          </CardContent>
        </Card>
      }
    >
      <UserDetail />
    </RoleGate>
  );
}
