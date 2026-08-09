"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useUser } from "@/hooks/useUsers";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, usersApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { UserForm } from "@/components/users/UserForm";
import type { UserFormSubmitValues } from "@/components/users/UserForm";
import { Card, CardContent, PageHeader, Skeleton, TextLink } from "@/components/ui";
import type { UpdateUserInput } from "@/lib/types";

function EditUser() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: user, isLoading, error } = useUser(id);
  const { user: actor } = useAuth();
  const canEditRole = actor?.role === "admin";

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: UserFormSubmitValues) => {
    setSubmitError(null);
    setSubmitting(true);
    const payload: UpdateUserInput = {
      first_name: values.first_name,
      last_name: values.last_name,
      phone: values.phone,
      is_active: values.is_active,
    };
    try {
      // Two separate requests, not one: PUT /users/:id is the profile-only
      // route (ADR-030 D-4a) — sending `role` there is rejected at the schema
      // boundary once FEATURE_GD02_MATRIX is on, and the legacy schema it
      // falls back to when the flag is off doesn't accept `regional_manager`
      // at all. The dedicated PUT /users/:id/role is Admin-only -- this page
      // now also admits in-scope manager/RM (2026-08-06 scope fix), so only
      // attempt the role call when the actor is actually an admin; the Role
      // selector is disabled for everyone else, but a submit shouldn't hit a
      // route that would just 403.
      let updated = await usersApi.update(id, payload);
      if (canEditRole && values.role !== user?.role) {
        updated = await usersApi.updateRole(id, { role: values.role });
      }
      await Promise.all([
        globalMutate(["user", id], updated, false),
        globalMutate((key) => Array.isArray(key) && key[0] === "users"),
      ]);
      router.replace(`/users/${id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink
          href={`/users/${id}`}
          className="text-sm"
        >
          ← Back to user
        </TextLink>
        <PageHeader className="mt-2" title="Edit user" />
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load this user.
          </CardContent>
        </Card>
      ) : isLoading || !user ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </CardContent>
        </Card>
      ) : (
        <UserForm
          mode="edit"
          user={user}
          canEditRole={canEditRole}
          submitting={submitting}
          error={submitError}
          onSubmit={onSubmit}
          onCancel={() => router.push(`/users/${id}`)}
        />
      )}
    </div>
  );
}

export default function EditUserPage() {
  return (
    <RoleGate
      allow={["admin", "manager", "regional_manager"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              Only admins and managers can edit users.
            </CardContent>
          </Card>
        </div>
      }
    >
      <EditUser />
    </RoleGate>
  );
}
