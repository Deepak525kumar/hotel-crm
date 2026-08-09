"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, usersApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { UserForm } from "@/components/users/UserForm";
import type { UserFormSubmitValues } from "@/components/users/UserForm";
import { Card, CardContent, PageHeader, TextLink } from "@/components/ui";
import type { CreateUserInput } from "@/lib/types";

function NewUser() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: UserFormSubmitValues) => {
    setError(null);
    setSubmitting(true);
    const payload: CreateUserInput = {
      email: values.email,
      password: values.password,
      first_name: values.first_name,
      last_name: values.last_name,
      role: values.role,
      ...(values.phone ? { phone: values.phone } : {}),
    };
    try {
      const created = await usersApi.create(payload);
      await mutate((key) => Array.isArray(key) && key[0] === "users");
      router.replace(`/users/${created.id}`);
    } catch (err) {
      setError(
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
        <TextLink href="/users" className="text-sm">
          ← Back to users
        </TextLink>
        <PageHeader
          className="mt-2"
          title="New user"
          description="Create an account and set an initial role."
        />
      </div>
      <UserForm
        mode="create"
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
        onCancel={() => router.push("/users")}
      />
    </div>
  );
}

export default function NewUserPage() {
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              Only admins can create users.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewUser />
    </RoleGate>
  );
}
