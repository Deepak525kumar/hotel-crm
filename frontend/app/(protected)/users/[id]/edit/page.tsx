"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useUser } from "@/hooks/useUsers";
import { ApiError, usersApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { UserForm } from "@/components/users/UserForm";
import type { UserFormValues } from "@/components/users/UserForm";
import { Card, CardContent, PageHeader, Skeleton } from "@/components/ui";
import type { UpdateUserInput } from "@/lib/types";

function EditUser() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: user, isLoading, error } = useUser(id);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: UserFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    const payload: UpdateUserInput = {
      first_name: values.first_name,
      last_name: values.last_name,
      phone: values.phone,
      role: values.role,
      is_active: values.is_active,
    };
    try {
      const updated = await usersApi.update(id, payload);
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
        <Link
          href={`/users/${id}`}
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to user
        </Link>
        <PageHeader className="mt-2" title="Edit user" />
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
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
      allow={["admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only admins can edit users.
            </CardContent>
          </Card>
        </div>
      }
    >
      <EditUser />
    </RoleGate>
  );
}
