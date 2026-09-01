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
import { UserAvatar } from "@/components/users/UserAvatar";
import { DocumentsCard } from "@/components/documents/DocumentsCard";
import { PayslipRequestsCard } from "@/components/hr/PayslipRequestsCard";
import { ContractCard } from "@/components/hr/ContractCard";
import { WorkerOnboardingCard } from "@/components/employees/WorkerOnboardingCard";
import { AssignmentCard } from "@/components/users/AssignmentCard";
import { AvailabilityBadge } from "@/components/calendar/AvailabilityBadge";
import { formatDateTime } from "@/lib/format";
import { EMPLOYMENT_STATUS_TONE, EMPLOYMENT_STATUS_LABEL } from "@/lib/employmentStatus";
import { Trans, useTranslation } from "react-i18next";
import {
  ActiveBadge,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  Input,
  Modal,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";

function UserDetail() {
  const { t } = useTranslation();
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
  const reactivate = useAsyncAction();
  const deleteUser = useAsyncAction();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const changeEmail = useAsyncAction();
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");

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

  // The deactivate card was rendered only while `is_active` was true, so the
  // moment an account was deactivated the whole card vanished and nothing
  // anywhere offered the inverse -- despite the card's own copy promising
  // "The account can be reactivated later."
  const onReactivate = () =>
    reactivate.run(() => usersApi.update(id, { is_active: true }), {
      onSuccess: () => globalMutate(["user", id]),
    });

  const onDelete = () =>
    deleteUser.run(
      async () => {
        await usersApi.remove(id);
        await globalMutate((key) => Array.isArray(key) && key[0] === "users");
      },
      {
        onSuccess: () => {
          setDeleteConfirmOpen(false);
          router.push("/users");
        },
      }
    );

  // A dedicated endpoint, not a field on update(): PUT /users/:id also admits a
  // hotel-scoped manager, and email is the sign-in identifier. The server
  // revokes the user's sessions and notifies both the old and new address.
  const onChangeEmail = () =>
    changeEmail.run(
      async () => {
        await usersApi.updateEmail(id, emailDraft.trim());
        await Promise.all([
          globalMutate(["user", id]),
          globalMutate((key) => Array.isArray(key) && key[0] === "users"),
        ]);
      },
      {
        onSuccess: () => {
          setEmailOpen(false);
          setEmailDraft("");
        },
      },
    );

  const onDeactivate = () =>
    deactivate.run(
      async () => {
        await usersApi.update(id, { is_active: false });
        await Promise.all([
          globalMutate(["user", id]),
          globalMutate((key) => Array.isArray(key) && key[0] === "users"),
        ]);
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
        },
      },
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink href="/users" className="text-sm" labelKey="common.backTo.users" />

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {t("users.loadOneFailedRemoved")}
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
          <div className="flex items-center gap-4">
            <UserAvatar
              userId={user.id}
              name={`${user.first_name} ${user.last_name}`}
              hasPhoto={user.has_profile_photo}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <PageHeader
                title={
                  <span className="flex items-center gap-3">
                    {user.first_name} {user.last_name}
                    {/* Employment status is what a reviewer reads this badge as.
                        `is_active` is the account/sign-in flag and is true from
                        creation, so on its own it showed "Active" for someone who
                        has not onboarded. Only falls back to the account flag for
                        accounts with no employment record (admins, pre-ADR-065). */}
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
                        <Button variant="outline">{t("common.edit")}</Button>
                      </Link>
                    </RoleGate>
                  ) : null
                }
              />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("nav.account")}</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <DataList>
                <DataRow
                  label={t("fields.email")}
                  value={
                    <span className="flex items-center gap-2">
                      {user.email}
                      <RoleGate allow={["admin", "regional_manager"]}>
                        <button
                          type="button"
                          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                          onClick={() => {
                            setEmailDraft(user.email);
                            setEmailOpen(true);
                          }}
                        >
                          {t("common.change")}
                        </button>
                      </RoleGate>
                    </span>
                  }
                />
                <DataRow label={t("fields.phone")} value={user.phone || "—"} />
                <DataRow label={t("fields.role")} value={<RoleBadge role={user.role} />} />
                {user.role === "worker" && availability && (
                  <DataRow
                    label={t("users.availability")}
                    value={<AvailabilityBadge available={availability.available} />}
                  />
                )}
                <DataRow label={t("fields.created")} value={formatDateTime(user.created_at)} />
                <DataRow label={t("fields.updated")} value={formatDateTime(user.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          {user.permissions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("common.permissions")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-2">
                  {user.permissions.map((p) => (
                    <li
                      key={p}
                      className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
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

          {/* 2026-08-13 fix (found during live QA of the onboarding flow):
              this was `user.role === "worker"`, so the entire employment
              lifecycle -- Employment status, Confirm/Approve/Reject,
              Deactivate/Reactivate, Delete/Restore (re-onboarding), Contract,
              Payslip requests -- was invisible on this page for every
              Checker, Manager, and Regional Manager account. ADR-065 gives
              every non-admin role an EmploymentRecord and the identical
              onboarding lifecycle; none of these cards are worker-specific
              (WorkerOnboardingCard/ContractCard/PayslipRequestsCard all take
              a plain userId/workerId and the backend's lifecycle endpoints
              are role-agnostic, gated only by the ACTOR's role via
              assertLifecycleAuthority -- see employee-management/service.ts).
              Admin has no EmploymentRecord and is excluded, matching the
              WorkerOnboardingCard's own "No employment record found" empty
              state for that case. */}
          {user.role !== "admin" && (
            <WorkerOnboardingGate>
              <WorkerOnboardingCard userId={id} />
            </WorkerOnboardingGate>
          )}

          <DocumentsGate>
            <DocumentsCard workerId={id} />
          </DocumentsGate>

          {user.role !== "admin" && (
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
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t("profile.resetPasswordTitle")}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
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
                  {t("auth.sendResetLinkAction")}
                </Button>
              </CardContent>
              <FormError className="px-6 pb-4">{passwordReset.error}</FormError>
            </Card>
          </RoleGate>

          <RoleGate allow={["admin"]}>
            <Card>
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t("users.revokeSessionsTitle")}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
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
                  {t("users.revokeSessionsAction")}
                </Button>
              </CardContent>
            </Card>
          </RoleGate>

          <UserDeactivateGate>
            {!user.is_active && (
              <Card>
                <CardContent className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t("users.reactivateAccountTitle")}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t("users.reactivateAccountBody")}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    disabled={reactivate.pending}
                    onClick={onReactivate}
                  >
                    {reactivate.pending
                      ? t("common.saving")
                      : t("users.reactivateAction")}
                  </Button>
                </CardContent>
              </Card>
            )}

            {user.is_active && (
              <Card className="border-red-100 dark:border-red-900/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t("users.deactivateAccountTitle")}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
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
                    {t("employees.deactivateAction")}
                  </Button>
                </CardContent>
              </Card>
            )}
          </UserDeactivateGate>

          <RoleGate allow={["admin"]}>
            <Card className="border-red-100 dark:border-red-900/50">
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Delete account
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {isSelf
                      ? "You cannot delete your own account."
                      : "Permanently soft-deletes this account and its employment record."}
                  </p>
                </div>
                <Button
                  variant="danger"
                  disabled={isSelf}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Delete
                </Button>
              </CardContent>
            </Card>
          </RoleGate>
        </>
      )}

      {user && (
      <Modal
        open={emailOpen}
        onClose={() => !changeEmail.pending && setEmailOpen(false)}
        title={t("users.changeEmailTitle")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setEmailOpen(false)}
              disabled={changeEmail.pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={onChangeEmail}
              loading={changeEmail.pending}
              disabled={!emailDraft.trim() || emailDraft.trim() === user.email}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("users.changeEmailBody")}
          </p>
          <Input
            type="email"
            autoComplete="off"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            placeholder={user.email}
          />
          {changeEmail.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{changeEmail.error}</p>
          )}
        </div>
      </Modal>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !deactivate.pending && setConfirmOpen(false)}
        title={t("users.deactivateAccountTitle")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deactivate.pending}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={onDeactivate} loading={deactivate.pending}>
              {t("employees.deactivateAction")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {/* <Trans> rather than t(): the name is emphasised mid-sentence, and
              where that emphasis falls varies by language. */}
          <Trans
            i18nKey="users.revokeAccessFor"
            values={{ name: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() }}
            components={{ name: <span className="font-medium" /> }}
          />
        </p>
        <FormError className="mt-3">{deactivate.error}</FormError>
      </Modal>

      <Modal
        open={revokeConfirmOpen}
        onClose={() => !revokeSessions.pending && setRevokeConfirmOpen(false)}
        title={t("users.revokeSessionsTitle")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRevokeConfirmOpen(false)}
              disabled={revokeSessions.pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={onRevokeSessions}
              loading={revokeSessions.pending}
            >
              {t("users.revokeSessionsAction")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
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

      <Modal
        open={deleteConfirmOpen}
        onClose={() => !deleteUser.pending && setDeleteConfirmOpen(false)}
        title="Delete Account"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteUser.pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={onDelete}
              loading={deleteUser.pending}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Are you sure you want to delete{" "}
          <span className="font-medium">
            {user?.first_name} {user?.last_name}
          </span>
          ? This action will permanently remove their access and employment record.
        </p>
        <FormError className="mt-3">{deleteUser.error}</FormError>
      </Modal>
    </div>
  );
}

export default function UserDetailPage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["admin", "manager", "regional_manager"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            {t("users.viewNoPermission")}
          </CardContent>
        </Card>
      }
    >
      <UserDetail />
    </RoleGate>
  );
}
