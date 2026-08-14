"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import { ApiError, usersApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { UserForm } from "@/components/users/UserForm";
import type { UserFormSubmitValues } from "@/components/users/UserForm";
import { Card, CardContent, PageHeader, TextLink } from "@/components/ui";
import type { CreateUserInput } from "@/lib/types";

function NewUser() {
  const router = useRouter();
  const { hotels } = useHotels({ limit: 100 });
  const { groups: hotelGroups } = useHotelGroups({ limit: 100 });
  
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
      // ADR-065 (Universal Onboarding Gate): required for every non-admin
      // role — UserForm's own validation (`valid`) already blocks submit
      // without these, so `values.role === "admin"` is the only case they're
      // legitimately blank.
      ...(values.job_title ? { job_title: values.job_title } : {}),
      ...(values.start_date ? { start_date: values.start_date } : {}),
      ...(values.employment_type ? { employment_type: values.employment_type } : {}),
      // Always sent (not conditionally): `false` is a real, meaningful value
      // here, and omitting it is exactly how the requirement got silently
      // disabled for everyone.
      ...(values.role !== "admin" ? { work_permit_required: values.work_permit_required } : {}),
    };
    try {
      const created = await usersApi.create(payload);
      
      // If a hotel/group was selected, we must call updateRole to apply the assignment,
      // as creation alone does not handle assignments.
      if ((values.role === 'manager' && values.hotel_id) || (values.role === 'regional_manager' && values.hotel_group_id)) {
        await usersApi.updateRole(created.id, { 
          role: values.role, 
          hotel_id: values.hotel_id || undefined, 
          hotel_group_id: values.hotel_group_id || undefined 
        });
      }
      
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
          description="Create an account and set an initial role. Their onboarding starts automatically."
        />
      </div>
      <UserForm
        mode="create"
        hotels={hotels}
        hotelGroups={hotelGroups}
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
    // RULE A (project-owner decision, 2026-08-12): create is 1-level-down, so
    // manager and regional_manager may now create users too — each restricted
    // to its own one-level-down target role, which UserForm's selector enforces
    // (and users/service.ts enforces authoritatively). worker/checker may
    // create nobody and still get the fallback.
    <RoleGate
      allow={["admin", "regional_manager", "manager"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              You do not have permission to create users.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewUser />
    </RoleGate>
  );
}
