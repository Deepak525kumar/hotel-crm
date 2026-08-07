"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useUser } from "@/hooks/useUsers";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAvailability } from "@/hooks/useCalendar";
import { authApi, usersApi } from "@/lib/api";
import {
  DocumentsGate,
  HrPayrollGate,
  RoleGate,
  UserDeactivateGate,
  WorkerOnboardingGate,
} from "@/components/auth/RoleGate";
import { RoleBadge } from "@/components/users/RoleBadge";
import { DocumentsCard } from "@/components/documents/DocumentsCard";
import { PayslipRequestsCard } from "@/components/hr/PayslipRequestsCard";
import { ContractCard } from "@/components/hr/ContractCard";
import { WorkerOnboardingCard } from "@/components/employees/WorkerOnboardingCard";
import { AssignmentCard } from "@/components/users/AssignmentCard";
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

  const [passwordResetSentAt, setPasswordResetSentAt] = useState<Date | null>(null);
  const passwordReset = useAsyncAction();
  // Guarded rather than `user!`: this component renders its loading/error
  // states inline instead of returning early, so `user` is genuinely
  // nullable at hook scope. The button only exists once the card renders
  // (which implies a loaded user), but a no-op beats a runtime crash if that
  // ever stops being true.
  const sendPasswordReset = () => {
    if (!user) return;
    passwordReset.run(() => authApi.requestPasswordReset(user.email), {
      onSuccess: () => setPasswordResetSentAt(new Date()),
      errorMessage: "Could not send a reset link. Please try again.",
    });
  };

  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [sessionsRevokedAt, setSessionsRevokedAt] = useState<Date | null>(null);
  const revokeSessions = useAsyncAction();

  const isSelf = currentUser?.id === id;

  const onRevokeSessions = () =>
    revokeSessions.run(() => usersApi.revokeSessions(id), {
      onSuccess: () => {
        setSessionsRevokedAt(new Date());
        setRevokeConfirmOpen(false);
      },
    });

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
              // Edit now admits in-scope manager/RM too (2026-08-06 scope
              // fix to updateUser) -- but the backend only ever permits a
              // manager/RM to edit a worker/checker target or themselves,
              // never a fellow manager/admin. Hide the button rather than
              // linking to a page that will 403 on submit (or, for a
              // non-worker/checker target, on load).
              currentUser?.role === "admin" ||
              isSelf ||
              user.role === "worker" ||
              user.role === "checker" ? (
                <RoleGate allow={["admin", "manager", "regional_manager"]}>
                  <Link href={`/users/${id}/edit`}>
                    <Button variant="outline">Edit</Button>
                  </Link>
                </RoleGate>
              ) : null
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

          {/* Person-centric assignment (2026-08-07): organizational
              assignment originates here, from the person. Admin-gated because
              the underlying endpoint (PUT /users/:id/role) is admin-only. */}
          <RoleGate allow={["admin"]}>
            <AssignmentCard user={user} />
          </RoleGate>

          {user.role === "worker" && (
            <WorkerOnboardingGate>
              <WorkerOnboardingCard userId={id} />
            </WorkerOnboardingGate>
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

          {/* Admin-triggered password reset. The reset flow itself already
              existed (POST /auth/password-reset) but was reachable only from
              the logged-OUT login screen, so an admin had no way to help a
              user who could not get in. Sends to the account's own email; the
              admin never sees or sets the password. */}
          <RoleGate allow={["admin"]}>
            <Card>
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Reset password
                  </p>
                  <p className="text-sm text-gray-500">
                    {passwordResetSentAt
                      ? `Reset link sent at ${formatDateTime(passwordResetSentAt.toISOString())}.`
                      : `Emails a password reset link to ${user.email}. Their current password keeps working until they complete the reset.`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={sendPasswordReset}
                  loading={passwordReset.pending}
                  className="shrink-0"
                >
                  Send reset link
                </Button>
              </CardContent>
              <FormError className="px-6 pb-4">{passwordReset.error}</FormError>
            </Card>
          </RoleGate>

          <RoleGate allow={["admin"]}>
            <Card>
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Revoke all sessions
                  </p>
                  <p className="text-sm text-gray-500">
                    {sessionsRevokedAt
                      ? `All sessions revoked at ${formatDateTime(sessionsRevokedAt.toISOString())}.`
                      : isSelf
                        ? "This will also sign you out — every access/refresh token for this account stops working immediately."
                        : "Signs the account out everywhere by invalidating every existing access/refresh token. Does not deactivate the account."}
                  </p>
                </div>
                <Button
                  variant="danger"
                  onClick={() => setRevokeConfirmOpen(true)}
                  className="shrink-0"
                >
                  Revoke sessions
                </Button>
              </CardContent>
            </Card>
          </RoleGate>

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

      <Modal
        open={revokeConfirmOpen}
        onClose={() => !revokeSessions.pending && setRevokeConfirmOpen(false)}
        title="Revoke all sessions"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRevokeConfirmOpen(false)}
              disabled={revokeSessions.pending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={onRevokeSessions}
              loading={revokeSessions.pending}
            >
              Revoke sessions
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {isSelf ? (
            "This will sign you out immediately, along with every other active session for your account."
          ) : (
            <>
              This immediately signs out{" "}
              <span className="font-medium">
                {user?.first_name} {user?.last_name}
              </span>{" "}
              everywhere. Their account stays active — they can sign back in right away.
            </>
          )}
        </p>
        <FormError className="mt-3">{revokeSessions.error}</FormError>
      </Modal>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <RoleGate
      allow={["admin", "manager", "regional_manager"]}
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
